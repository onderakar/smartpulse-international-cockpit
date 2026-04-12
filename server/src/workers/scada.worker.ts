import { PrismaClient } from '@prisma/client';
import { envConfig } from '../config/env';
import { ConfigStoreService } from '../services/configStore.service';
import { MonitoringService } from '../services/monitoring.service';
import { eventBus, EVENTS } from '../eventBus';
import axios from 'axios';

const prisma = new PrismaClient();
const monitoringService = new MonitoringService();
const configStore = new ConfigStoreService(); // Prisma-backed, no init() needed

export class ScadaWorker {
    private isRunning = false;
    private timer: NodeJS.Timeout | null = null;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private static knownEmptyGaps = new Set<string>();

    private static readonly HEALTH_CHECK_INTERVAL_MS = 10 * 60 * 1000;
    private static readonly HEALTH_CHECK_LOOKBACK_MS = 26 * 60 * 60 * 1000;
    private static readonly MIN_POINTS_PER_HOUR = 30;

    constructor(private intervalMs: number = 30000) { }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[ScadaWorker] Started with interval ${this.intervalMs}ms`);

        const loop = async () => {
            try {
                await this.pollData();
            } catch (err) {
                console.error('[ScadaWorker] Error in poll loop:', err);
            } finally {
                if (this.isRunning) {
                    this.timer = setTimeout(loop, this.intervalMs);
                }
            }
        };

        loop();
        setTimeout(() => this.startHealthCheckLoop(), 60_000);
    }

    stop() {
        this.isRunning = false;
        if (this.timer) clearTimeout(this.timer);
        if (this.healthCheckTimer) clearTimeout(this.healthCheckTimer);
        console.log('[ScadaWorker] Stopped');
    }

    // ---------------------------------------------------------------------------
    // Health Check — detect and repair gaps in recent data
    // ---------------------------------------------------------------------------
    private startHealthCheckLoop() {
        if (!this.isRunning) return;

        const loop = async () => {
            try {
                await this.runHealthCheck();
            } catch (err) {
                console.error('[ScadaWorker HealthCheck] Error:', err);
            } finally {
                if (this.isRunning) {
                    this.healthCheckTimer = setTimeout(loop, ScadaWorker.HEALTH_CHECK_INTERVAL_MS);
                }
            }
        };

        loop();
    }

    private async runHealthCheck() {
        const now = Date.now();
        const lookbackStart = now - ScadaWorker.HEALTH_CHECK_LOOKBACK_MS;

        let assets: any[];
        try {
            assets = await prisma.asset.findMany();
        } catch (err) {
            console.error('[ScadaWorker HealthCheck] Cannot read assets:', err);
            return;
        }

        if (assets.length === 0) return;

        const profiles = await configStore.loadAllGroupProfiles();

        for (const asset of assets) {
            try {
                const metrics = await prisma.timeSeriesData.findMany({
                    where: {
                        assetId: asset.id,
                        effectiveTime: {
                            gte: new Date(lookbackStart),
                            lte: new Date(now)
                        }
                    },
                    select: { effectiveTime: true }
                });

                const gaps = ScadaWorker.detectHourlyGaps(
                    metrics.map(m => m.effectiveTime.getTime()),
                    lookbackStart,
                    now
                );

                if (gaps.length === 0) continue;

                const totalGapHours = gaps.reduce((sum, g) => sum + (g.end - g.start) / 3600_000, 0);
                console.log(`[ScadaWorker HealthCheck] Asset ${asset.name}: ${gaps.length} gap(s) detected (${totalGapHours.toFixed(1)}h total)`);

                const match = this.findProfileForAsset(asset, profiles);
                if (!match) {
                    console.warn(`[ScadaWorker HealthCheck] No profile/credentials found for ${asset.name}, skipping backfill`);
                    continue;
                }

                for (const gap of gaps) {
                    const gapKey = `${asset.name}:${gap.start}:${gap.end}`;
                    if (ScadaWorker.knownEmptyGaps.has(gapKey)) continue;

                    try {
                        console.log(`[ScadaWorker HealthCheck] Backfilling ${asset.name}: ${new Date(gap.start).toISOString()} → ${new Date(gap.end).toISOString()}`);

                        const beforeCount = await prisma.timeSeriesData.count({
                            where: {
                                assetId: asset.id,
                                effectiveTime: { gte: new Date(gap.start), lte: new Date(gap.end) }
                            }
                        });

                        await ScadaWorker.fetchAndIngestAdhoc({
                            gcpId: match.gcpId,
                            companyId: match.companyId,
                            start: new Date(gap.start).toISOString(),
                            end: new Date(gap.end).toISOString(),
                            profile: match.profile
                        });

                        const afterCount = await prisma.timeSeriesData.count({
                            where: {
                                assetId: asset.id,
                                effectiveTime: { gte: new Date(gap.start), lte: new Date(gap.end) }
                            }
                        });

                        if (afterCount <= beforeCount) {
                            console.log(`[ScadaWorker HealthCheck] No data available from API for ${asset.name} gap. Skipping in future.`);
                            ScadaWorker.knownEmptyGaps.add(gapKey);
                        }
                    } catch (err: any) {
                        console.error(`[ScadaWorker HealthCheck] Backfill failed for ${asset.name} gap:`, err.message);
                    }
                }
            } catch (err: any) {
                console.error(`[ScadaWorker HealthCheck] Error checking asset ${asset.name}:`, err.message);
            }
        }
    }

    public static detectHourlyGaps(
        timestampsMs: number[],
        rangeStartMs: number,
        rangeEndMs: number,
    ): { start: number; end: number }[] {
        const HOUR_MS = 3600_000;
        const hourlyCounts = new Map<number, number>();
        for (const ts of timestampsMs) {
            const bucket = Math.floor(ts / HOUR_MS) * HOUR_MS;
            hourlyCounts.set(bucket, (hourlyCounts.get(bucket) || 0) + 1);
        }

        const gaps: { start: number; end: number }[] = [];
        let gapStart: number | null = null;

        const firstBucket = Math.floor(rangeStartMs / HOUR_MS) * HOUR_MS;
        const lastBucket = Math.floor(rangeEndMs / HOUR_MS) * HOUR_MS;

        for (let bucket = firstBucket; bucket <= lastBucket; bucket += HOUR_MS) {
            const count = hourlyCounts.get(bucket) || 0;
            if (count < ScadaWorker.MIN_POINTS_PER_HOUR) {
                if (gapStart === null) gapStart = bucket;
            } else {
                if (gapStart !== null) {
                    gaps.push({ start: gapStart, end: bucket });
                    gapStart = null;
                }
            }
        }
        if (gapStart !== null) {
            gaps.push({ start: gapStart, end: Math.min(lastBucket + HOUR_MS, rangeEndMs) });
        }

        return gaps;
    }

    /**
     * Find the group profile + company + GCP mapping for a given database asset.
     * Asset name format: GCP_{gcpId}
     */
    private findProfileForAsset(asset: any, profiles: Record<string, any>): {
        profile: any; gcpId: string; companyId: number;
    } | null {
        // Asset name format: GCP_{gcpId}
        const gcpId = asset.name?.replace('GCP_', '');
        if (!gcpId) return null;

        for (const groupId of Object.keys(profiles)) {
            const p = profiles[groupId];
            if (!p.monitoringCredentials || !p.assetMapping?.companies) continue;

            for (const company of p.assetMapping.companies) {
                for (const gcp of company.gridConnectionPoints || []) {
                    if (String(gcp.id) === gcpId) {
                        const hasMonitoring = gcp.components?.some((c: any) => c.monitoring?.metrics?.length > 0);
                        if (hasMonitoring) {
                            return {
                                profile: p,
                                gcpId: gcpId,
                                companyId: company.companyId || (company as any).id
                            };
                        }
                    }
                }
            }
        }
        return null;
    }

    public static async fetchAndIngestAdhoc(params: {
        gcpId: string;
        companyId: number;
        start: string;
        end: string;
        profile: any;
    }) {
        const { gcpId, companyId, start, end, profile } = params;
        const worker = new ScadaWorker();

        const targets = new Map<string, any>();

        const companyMatch = profile.assetMapping?.companies?.find((c: any) =>
            c.companyId === companyId || (c as any).id === companyId
        );
        if (!companyMatch) {
            console.warn(`[ScadaWorker Adhoc] No company match for companyId=${companyId}`);
            return;
        }

        const gcp = companyMatch.gridConnectionPoints?.find((g: any) =>
            String(g.id) === gcpId
        );
        if (!gcp) {
            console.warn(`[ScadaWorker Adhoc] No GCP match for gcpId=${gcpId} in company ${companyMatch.companyName}`);
            return;
        }

        const extractedMasternode = gcp.components?.[0]?.monitoring?.masternode;

        console.log(`[ScadaWorker Adhoc] Found GCP "${gcp.name}" with ${gcp.components?.length || 0} components`);

        if (Array.isArray(gcp.components)) {
            for (const comp of gcp.components) {
                if (comp.monitoring && Array.isArray(comp.monitoring.metrics)) {
                    for (const metric of comp.monitoring.metrics) {
                        if (metric.nodeidentity || metric.nodeidentity === 0) {
                            const masternode = comp.monitoring.masternode || extractedMasternode;
                            if (!masternode) {
                                console.warn(`[ScadaWorker Adhoc] Skipping metric ${metric.tag} for ${gcp.name}/${comp.componentId}: no masternode`);
                                continue;
                            }
                            const key = `${companyMatch.companyName}-${gcp.name}-${comp.componentId}-${metric.tag}`;
                            targets.set(key, {
                                assetName: gcp.name,
                                gcpId: gcpId,
                                companyId: companyId,
                                masternode,
                                node: metric.node,
                                nodeidentity: metric.nodeidentity,
                                tag: metric.tag,
                                start,
                                end,
                                credentials: profile.monitoringCredentials
                            });
                        }
                    }
                }
            }
        }

        if (targets.size === 0) {
            console.warn(`[ScadaWorker Adhoc] No targets found for GCP "${gcp.name}".`);
            return;
        }
        console.log(`[ScadaWorker Adhoc] ${targets.size} target(s) to refetch`);

        const scadaSource = await prisma.dataSource.upsert({
            where: { name: 'SCADA_API' },
            update: {},
            create: { name: 'SCADA_API', description: 'SmartPulse Monitoring API' }
        });

        const mTypes = await prisma.metricType.findMany();
        const mTypesMap = new Map<string, number>();
        mTypes.forEach(t => mTypesMap.set(t.name, t.id));

        const CHUNK_MS = 100 * 60 * 1000; // 100 minutes

        for (const [key, t] of Array.from(targets.entries())) {
            try {
                const token = await worker.getValidToken(t.credentials);
                const rangeStart = new Date(t.start).getTime();
                const rangeEnd = new Date(t.end).getTime();

                let chunkStart = rangeStart;
                while (chunkStart < rangeEnd) {
                    const chunkEnd = Math.min(chunkStart + CHUNK_MS, rangeEnd);
                    console.log(`[ScadaWorker Adhoc] Fetching chunk ${new Date(chunkStart).toISOString()} → ${new Date(chunkEnd).toISOString()} for ${key}`);
                    const data = await monitoringService.getMetrics(token, {
                        masternode: t.masternode, node: t.node, nodeidentity: t.nodeidentity,
                        start: new Date(chunkStart).toISOString(),
                        end: new Date(chunkEnd).toISOString()
                    });
                    await worker.ingestData(data, t, mTypesMap, scadaSource.id);
                    chunkStart = chunkEnd;
                }
            } catch (err: any) {
                console.error(`[ScadaWorker Adhoc] Error fetching ${key}:`, err.message);
            }
        }
    }

    private tokenCache = new Map<string, { token: string, expiresAt: number }>();

    private async getValidToken(credentials: any): Promise<string> {
        if (!credentials?.username || !credentials?.password) {
            throw new Error('Monitoring Credentials missing in Profile.');
        }

        const cacheKey = `${credentials.username}:${credentials.password}`;
        const cached = this.tokenCache.get(cacheKey);

        if (cached && Date.now() < cached.expiresAt - 60000) {
            return cached.token;
        }

        try {
            console.log(`[ScadaWorker] Attempting Monitoring API login for ${credentials.username}...`);
            const response = await axios.post(`${envConfig.MONITORING_BASE_URL}/api/v1/auth/login`, {
                username: credentials.username,
                password: credentials.password,
            });

            this.tokenCache.set(cacheKey, {
                token: response.data.access_token,
                expiresAt: Date.now() + (response.data.expires_in * 1000)
            });
            return response.data.access_token;
        } catch (err: any) {
            console.error(`[ScadaWorker] Failed to authenticate with Monitoring API for ${credentials.username}`, err.message);
            throw err;
        }
    }

    private async pollData() {
        const groups = await configStore.loadAllGroupProfiles();
        console.log(`[ScadaWorker] Discovered ${Object.keys(groups).length} group profile(s).`);

        const targetsToPoll = new Map<string, any>();

        for (const groupId of Object.keys(groups)) {
            const g = groups[groupId];
            const mapping = g.assetMapping;
            if (!mapping || !mapping.companies) {
                console.log(`[ScadaWorker] Group '${groupId}' has no AssetMapping or Companies. Skipping.`);
                continue;
            }

            if (!g.monitoringCredentials?.username || !g.monitoringCredentials?.password) {
                console.log(`[ScadaWorker] Group '${groupId}' has no Monitoring Credentials. Skipping.`);
                continue;
            }

            for (const company of mapping.companies) {
                for (const gcp of (company.gridConnectionPoints || [])) {
                    const gcpIdStr = String(gcp.id);
                    if (!gcp.name || !gcpIdStr) continue;

                    let extractedMasternode = company.companyName; // fallback
                    let customMetrics: any[] = [];
                    for (const comp of gcp.components || []) {
                        if (comp.monitoring?.masternode) {
                            extractedMasternode = comp.monitoring.masternode;
                        }
                        if (comp.monitoring?.metrics && Array.isArray(comp.monitoring.metrics)) {
                            customMetrics.push(...comp.monitoring.metrics);
                        }
                    }

                    if (customMetrics.length > 0) {
                        for (const metric of customMetrics) {
                            const targetKey = `${company.companyName}-${gcp.name}-${metric.node}-${metric.nodeidentity}`;
                            if (!targetsToPoll.has(targetKey)) {
                                targetsToPoll.set(targetKey, {
                                    assetName: gcp.name,
                                    gcpId: gcpIdStr,
                                    companyId: company.companyId || (company as any).id,
                                    masternode: extractedMasternode,
                                    node: metric.node,
                                    nodeidentity: metric.nodeidentity,
                                    tag: metric.tag,
                                    start: new Date(Date.now() - 3600000).toISOString(),
                                    end: new Date().toISOString(),
                                    credentials: g.monitoringCredentials
                                });
                            }
                        }
                    } else {
                        // No explicit metrics — try generic fallback
                        const targetKey = `${company.companyName}-${gcp.name}-${gcpIdStr}`;
                        if (!targetsToPoll.has(targetKey)) {
                            targetsToPoll.set(targetKey, {
                                assetName: gcp.name,
                                gcpId: gcpIdStr,
                                companyId: company.companyId || (company as any).id,
                                masternode: extractedMasternode,
                                node: gcp.name,
                                nodeidentity: parseInt(gcpIdStr, 10) || 0,
                                tag: 'GENERIC',
                                start: new Date(Date.now() - 3600000).toISOString(),
                                end: new Date().toISOString(),
                                credentials: g.monitoringCredentials
                            });
                        }
                    }
                }
            }
        }

        if (targetsToPoll.size === 0) {
            console.log('[ScadaWorker] targetsToPoll is EMPTY. Exiting poll loop early.');
            return;
        }

        console.log(`[ScadaWorker] Assembled ${targetsToPoll.size} target(s) to poll.`);

        let metricTypesRaw, scadaSource;
        try {
            metricTypesRaw = await prisma.metricType.findMany();
            scadaSource = await prisma.dataSource.upsert({
                where: { name: 'SCADA_API' },
                update: {},
                create: { name: 'SCADA_API', description: 'Real-time telemetry' }
            });
        } catch (dbErr) {
            console.error('[ScadaWorker] CRITICAL: Prisma Database failed during initialization phase:', dbErr);
            return;
        }

        const metricTypes = new Map(metricTypesRaw.map(m => [m.name, m.id]));

        for (const target of targetsToPoll.values()) {
            try {
                const token = await this.getValidToken(target.credentials);

                const data = await monitoringService.getMetrics(token, {
                    masternode: target.masternode,
                    node: target.node,
                    nodeidentity: target.nodeidentity,
                    start: target.start,
                    end: target.end
                });

                console.log(`[ScadaWorker] Data received for ${target.assetName}. Keys: ${Object.keys(data || {}).join(',')}`);
                await this.ingestData(data, target, metricTypes, scadaSource.id);
            } catch (err: any) {
                console.error(`[ScadaWorker] Failed to fetch data for ${target.assetName}:`, err?.response?.data || err.message);
            }
        }
    }

    private async ingestData(payload: any, target: any, metricTypes: Map<string, number>, sourceId: number) {
        if (!payload) {
            console.log(`[ScadaWorker] Ignoring null payload from ${target.assetName}.`);
            return;
        }

        console.log(`[ScadaWorker] Raw Payload Snapshot for ${target.assetName}:`, JSON.stringify(payload).substring(0, 800));

        if (!payload.values && !payload.data && !payload.soc) {
            console.log(`[ScadaWorker] Empty/Invalid payload keys from ${target.assetName}.`);
            return;
        }

        // Ensure Asset exists — use GCP_{gcpId} naming
        const asset = await (prisma.asset as any).upsert({
            where: { name: `GCP_${target.gcpId}` },
            update: {
                portalCompanyId: target.companyId || null
            },
            create: {
                name: `GCP_${target.gcpId}`,
                type: 'GCP',
                portalCompanyId: target.companyId || null
            }
        });

        const now = new Date();
        const recordsToInsert: any[] = [];

        const getMetricTypeId = async (name: string, unit: string) => {
            if (metricTypes.has(name)) return metricTypes.get(name)!;
            const created = await prisma.metricType.upsert({
                where: { name },
                update: {},
                create: { name, unit }
            });
            metricTypes.set(name, created.id);
            return created.id;
        };

        const bapTypeId = await getMetricTypeId('BAP', 'MW');
        const socTypeId = await getMetricTypeId('SOC', 'MWh');

        // ── FORMAT 2: payload.values = [{ timestamp, value }] ──
        const valuesArray = Array.isArray(payload.values) ? payload.values : [];
        if (valuesArray.length > 0 && target.tag && target.tag !== 'GENERIC') {
            const tagUpper = target.tag.toUpperCase();
            for (const point of valuesArray) {
                const tMs = typeof point.timestamp === 'number'
                    ? point.timestamp
                    : new Date(point.timestamp || point.time || '').getTime();
                if (isNaN(tMs)) continue;
                const val = typeof point.value === 'number' ? point.value : parseFloat(point.value);
                if (isNaN(val)) continue;
                const timeStr = new Date(tMs);

                if (tagUpper.includes('SOC')) {
                    recordsToInsert.push({ effectiveTime: timeStr, recordedTime: now, assetId: asset.id, metricTypeId: socTypeId, dataSourceId: sourceId, value: val });
                } else if (tagUpper === 'ACTIVEPOWER' || tagUpper === 'BAP') {
                    recordsToInsert.push({ effectiveTime: timeStr, recordedTime: now, assetId: asset.id, metricTypeId: bapTypeId, dataSourceId: sourceId, value: val });
                } else if (tagUpper.includes('POWER')) {
                    const powerMetricName = target.nodeidentity ? `${tagUpper}_${target.nodeidentity}` : tagUpper;
                    const dynPwrTypeId = await getMetricTypeId(powerMetricName, 'MW');
                    recordsToInsert.push({ effectiveTime: timeStr, recordedTime: now, assetId: asset.id, metricTypeId: dynPwrTypeId, dataSourceId: sourceId, value: val });
                }
            }
        }

        // ── FORMAT 1: payload.data = [{ time, data: { p, soc, q } }] ──
        const dataArray = Array.isArray(payload.data) ? payload.data : [];
        if (dataArray.length > 0) {
            for (const point of dataArray) {
                const tStr = point.time || point.timestamp || point.t;
                if (!tStr) continue;

                const tMs = new Date(tStr).getTime();
                if (isNaN(tMs)) continue;
                const timeStr = new Date(tMs);
                const innerData = point.data || point || {};

                if (target.tag && target.tag !== 'GENERIC') {
                    const tagUpper = target.tag.toUpperCase();
                    const val = typeof point.value === 'number' ? point.value : undefined;

                    if (tagUpper.includes('SOC')) {
                        const socVal = typeof val === 'number' ? val
                            : (typeof innerData.soc === 'number' ? innerData.soc
                                : (typeof innerData.capacity === 'number' ? innerData.capacity : undefined));
                        if (typeof socVal === 'number') {
                            recordsToInsert.push({
                                effectiveTime: timeStr, recordedTime: now,
                                assetId: asset.id, metricTypeId: socTypeId, dataSourceId: sourceId,
                                value: socVal
                            });
                        }
                        // BESS nodes combine SOC + BAP in the same payload
                        const bapVal = typeof innerData.p === 'number' ? innerData.p : innerData.bap;
                        if (typeof bapVal === 'number') {
                            recordsToInsert.push({
                                effectiveTime: timeStr, recordedTime: now,
                                assetId: asset.id, metricTypeId: bapTypeId, dataSourceId: sourceId,
                                value: bapVal
                            });
                        }
                    } else if (tagUpper === 'ACTIVEPOWER' || tagUpper === 'BAP') {
                        const bapVal = typeof val === 'number' ? val
                            : (typeof innerData.p === 'number' ? innerData.p : innerData.bap);
                        if (typeof bapVal === 'number') {
                            recordsToInsert.push({
                                effectiveTime: timeStr, recordedTime: now,
                                assetId: asset.id, metricTypeId: bapTypeId, dataSourceId: sourceId,
                                value: bapVal
                            });
                        }
                    } else if (tagUpper.includes('POWER')) {
                        const pwrVal = typeof val === 'number' ? val
                            : (typeof innerData.p === 'number' ? innerData.p : undefined);
                        if (typeof pwrVal === 'number') {
                            const powerMetricName = target.nodeidentity ? `${tagUpper}_${target.nodeidentity}` : tagUpper;
                            const dynPwrTypeId = await getMetricTypeId(powerMetricName, 'MW');
                            recordsToInsert.push({
                                effectiveTime: timeStr, recordedTime: now,
                                assetId: asset.id, metricTypeId: dynPwrTypeId, dataSourceId: sourceId,
                                value: pwrVal
                            });
                        }
                    }
                } else {
                    // Fallback generic mapping
                    const bapValue = typeof innerData.p === 'number' ? innerData.p : innerData.bap;
                    if (typeof bapValue === 'number') {
                        recordsToInsert.push({
                            effectiveTime: timeStr, recordedTime: now,
                            assetId: asset.id, metricTypeId: bapTypeId, dataSourceId: sourceId,
                            value: bapValue
                        });
                    }

                    const socValue = typeof innerData.soc === 'number' ? innerData.soc : innerData.capacity;
                    if (typeof socValue === 'number') {
                        recordsToInsert.push({
                            effectiveTime: timeStr, recordedTime: now,
                            assetId: asset.id, metricTypeId: socTypeId, dataSourceId: sourceId,
                            value: socValue
                        });
                    }
                }
            }
        }

        console.log(`[ScadaWorker] ingestData for ${target.assetName}: ${recordsToInsert.length} records prepared.`);

        if (recordsToInsert.length > 0) {
            try {
                const minTime = recordsToInsert.reduce((min, r) => r.effectiveTime < min ? r.effectiveTime : min, recordsToInsert[0].effectiveTime);
                const maxTime = recordsToInsert.reduce((max, r) => r.effectiveTime > max ? r.effectiveTime : max, recordsToInsert[0].effectiveTime);

                const existingRecords = await prisma.timeSeriesData.findMany({
                    where: {
                        assetId: asset.id,
                        effectiveTime: { gte: minTime, lte: maxTime }
                    },
                    select: { effectiveTime: true, metricTypeId: true }
                });

                const existingSet = new Set(existingRecords.map(r => `${r.effectiveTime.getTime()}_${r.metricTypeId}`));
                const filteredRecords = recordsToInsert.filter(r => !existingSet.has(`${r.effectiveTime.getTime()}_${r.metricTypeId}`));

                if (filteredRecords.length > 0) {
                    const result = await prisma.timeSeriesData.createMany({
                        data: filteredRecords,
                        skipDuplicates: true
                    });
                    console.log(`[ScadaWorker] Inserted ${result.count} NEW metrics out of ${recordsToInsert.length} for ${target.assetName}.`);
                    eventBus.emit(EVENTS.METRICS_INGESTED, { assetId: target.gcpId });
                } else {
                    console.log(`[ScadaWorker] All ${recordsToInsert.length} metrics for ${target.assetName} already exist (deduplicated).`);
                }
            } catch (err: any) {
                console.error(`[ScadaWorker] DB Insert failed for ${target.assetName}:`, err.message);
            }
        } else {
            console.log(`[ScadaWorker] No valid metrics extracted for ${target.assetName}.`);
        }
    }
}
