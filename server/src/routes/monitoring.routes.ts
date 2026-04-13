import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { MonitoringAuthService } from '../services/monitoringAuth.service';
import { MonitoringService } from '../services/monitoring.service';
import { sessionAuth } from '../middleware/sessionAuth';
import { lttbDownsample } from '../utils/lttb';
import { detectGapsAndBackfill } from '../services/gapDetection.service';
import { ConfigStoreService } from '../services/configStore.service';

const prisma = new PrismaClient();

export function createMonitoringRoutes(
  monitoringAuth: MonitoringAuthService,
  monitoringService: MonitoringService,
): Router {
  const router = Router();

  // GET /api/monitoring/v2/metrics
  router.get('/v2/metrics', sessionAuth, async (req, res, next) => {
    try {
      const { gcpId, companyId, start, end, maxPoints: maxPointsStr, mode } = req.query;
      if (!gcpId || !companyId || !start || !end) {
        return res.status(400).json({ message: 'gcpId, companyId, start, end required' });
      }

      const maxPoints = maxPointsStr ? parseInt(maxPointsStr as string, 10) : 500;
      const isIncremental = mode === 'incremental';

      const asset = await prisma.asset.findUnique({ where: { name: `GCP_${gcpId}` } });
      if (!asset) {
        return res.status(404).json({ message: `Asset GCP_${gcpId} not found` });
      }

      // Pre-load metric types (small table, avoids JOIN on large result set)
      const metricTypes = await prisma.metricType.findMany();
      const metricTypeMap = new Map(metricTypes.map(mt => [mt.id, mt.name.toUpperCase()]));

      const metrics = await prisma.timeSeriesData.findMany({
        where: {
          assetId: asset.id,
          effectiveTime: isIncremental
            ? { gt: new Date(start as string), lte: new Date(end as string) }
            : { gte: new Date(start as string), lte: new Date(end as string) },
        },
        select: { effectiveTime: true, metricTypeId: true, value: true },
        orderBy: { effectiveTime: 'asc' },
      });

      let result = metrics.map((m: any) => ({
        timestamp: m.effectiveTime.getTime(),
        type: metricTypeMap.get(m.metricTypeId) || 'UNKNOWN',
        value: m.value,
      }));

      // Apply LTTB in full mode when maxPoints > 0
      if (!isIncremental && maxPoints > 0 && result.length > maxPoints) {
        // Group by metric type
        const groups = new Map<string, typeof result>();
        for (const pt of result) {
          if (!groups.has(pt.type)) groups.set(pt.type, []);
          groups.get(pt.type)!.push(pt);
        }

        // LTTB per group
        const downsampled: typeof result = [];
        for (const [type, points] of groups) {
          if (points.length > maxPoints) {
            const lttbInput = points.map(p => ({ timestamp: p.timestamp, value: p.value }));
            const sampled = lttbDownsample(lttbInput, maxPoints);
            const sampledSet = new Set(sampled.map((s: any) => s.timestamp));
            downsampled.push(...points.filter(p => sampledSet.has(p.timestamp)));
          } else {
            downsampled.push(...points);
          }
        }

        result = downsampled.sort((a, b) => a.timestamp - b.timestamp);
      }

      res.json(result);

      // Fire-and-forget gap detection (only for full mode)
      if (!isIncremental && asset) {
        const groupId = String(req.session?.portalSession?.groupId);
        const store = new ConfigStoreService();

        store.loadGroupProfile(groupId).then((profile: any) => {
          if (!profile?.monitoringCredentials) return;

          // Resolve timezone from asset mapping
          let timezone = 'UTC';
          const mapping = profile.assetMapping;
          if (mapping?.companies) {
            for (const co of mapping.companies) {
              const gcp = co.gridConnectionPoints?.find((g: any) => String(g.id) === String(gcpId));
              if (gcp) { timezone = gcp.timezone || co.timezone || 'UTC'; break; }
            }
          }

          detectGapsAndBackfill({
            assetName: `GCP_${gcpId}`,
            assetId: asset.id,
            gcpId: String(gcpId),
            companyId: parseInt(companyId as string, 10),
            start: start as string,
            end: end as string,
            timezone,
            profile,
          }).catch(err => console.error('[Monitoring Route] Gap detection error:', err.message));
        }).catch(() => {});
      }
    } catch (err) {
      next(err);
    }
  });

  // POST /api/monitoring/v2/refetch
  router.post('/v2/refetch', sessionAuth, async (req, res, next) => {
    try {
      const { gcpId, companyId, start, end } = req.body;
      if (!gcpId || !companyId || !start || !end) {
        return res.status(400).json({ message: 'gcpId, companyId, start, end required' });
      }

      const username = req.session?.portalSession?.username;
      if (!username) return res.status(401).json({ message: 'Unauthorized' });

      const parsedCompanyId = parseInt(companyId, 10);
      const gcpIdStr = String(gcpId);

      const asset = await prisma.asset.findUnique({ where: { name: `GCP_${gcpIdStr}` } });
      if (!asset) {
        return res.status(404).json({ message: `Asset GCP_${gcpIdStr} not found` });
      }

      // Find children of this asset to wipe their data too
      const childAssets = await prisma.asset.findMany({ where: { parentId: asset.id } });
      const allAssetIds = [asset.id, ...childAssets.map((a: any) => a.id)];

      const deleted = await prisma.timeSeriesData.deleteMany({
        where: {
          assetId: { in: allAssetIds },
          effectiveTime: { gte: new Date(start), lte: new Date(end) }
        }
      });
      console.log(`[Monitoring Routes] Wiped ${deleted.count} records for GCP ${gcpIdStr} from ${start} to ${end}.`);

      const { ConfigStoreService } = require('../services/configStore.service');
      const store = new ConfigStoreService();

      const groupId = String(req.session.portalSession!.groupId);
      const profile = await store.loadGroupProfile(groupId);

      if (!profile || !profile.monitoringCredentials) {
        return res.status(400).json({ message: 'Monitoring credentials missing' });
      }

      // Respond immediately, refetch in background
      res.json({ success: true, message: 'Data wiped. Refetch started in background.' });

      const { ScadaWorker } = require('../workers/scada.worker');
      ScadaWorker.fetchAndIngestAdhoc({
        gcpId: gcpIdStr,
        companyId: parsedCompanyId,
        start,
        end,
        profile
      }).then(() => {
        console.log(`[Monitoring Routes] Background refetch completed for GCP ${gcpIdStr}`);
      }).catch((err: any) => {
        console.error(`[Monitoring Routes] Background refetch failed for GCP ${gcpIdStr}:`, err.message);
      });
    } catch (err: any) {
      console.error('Refetch error:', err);
      res.status(500).json({ success: false, message: err.message || 'Refetch failed' });
    }
  });

  // POST /api/monitoring/v2/test-metric
  router.post('/v2/test-metric', sessionAuth, async (req, res, next) => {
    try {
      const { masternode, node, nodeidentity } = req.body;
      if (!masternode || !node || nodeidentity === undefined) {
        return res.status(400).json({ message: 'masternode, node, and nodeidentity required' });
      }

      const username = req.session?.portalSession?.username;
      if (!username) return res.status(401).json({ message: 'Unauthorized' });

      const groupId = String(req.session.portalSession!.groupId);
      const { ConfigStoreService } = require('../services/configStore.service');
      const store = new ConfigStoreService();
      const profile = await store.loadGroupProfile(groupId);

      if (!profile || !profile.monitoringCredentials) {
        return res.status(400).json({ message: 'Monitoring credentials not configured in settings.' });
      }

      const { username: credUsername, password } = profile.monitoringCredentials;
      const entry = await monitoringAuth.login(credUsername, password, req.sessionID);
      const token = entry.accessToken;

      const start = new Date(Date.now() - 60000).toISOString();
      const end = new Date().toISOString();

      const response = await monitoringService.getMetrics(token, {
        masternode,
        node,
        nodeidentity: parseInt(nodeidentity, 10),
        start,
        end
      });

      const count = Array.isArray(response.data) ? response.data.length : 0;
      let sample = null;
      if (count > 0) sample = response.data[0];

      res.json({ success: true, count, sample });
    } catch (err: any) {
      console.error('Test metric error:', err?.message || err);
      res.status(500).json({ success: false, message: err?.response?.data?.message || err?.message || 'Failed to fetch' });
    }
  });

  // POST /api/monitoring/login — test monitoring credentials
  router.post('/login', sessionAuth, async (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: 'username and password required' });
      }

      const entry = await monitoringAuth.login(username, password, req.sessionID);
      res.json({ success: true, expiresAt: entry.expiresAt });
    } catch (err: any) {
      res.status(401).json({ success: false, message: err?.response?.data?.message || err?.message || 'Login failed' });
    }
  });

  return router;
}
