import crypto from 'node:crypto'
import axios from 'axios'
import {
  GridConnectionPoint,
  GcpComponent,
  CompanyMapping,
  AssetMapping,
  BessParams,
  AutoMappingEvent,
  AutoMappingReport,
  AutoMappingWarning,
  GroupProfile,
  DashboardProfile,
} from '@smartpulse-intl/shared'
import { UserSession } from '../store/sessions'
import { FtpService } from './ftp.service'
import { ConfigStoreService } from './configStore.service'
import { parseAutoMappingCsv } from '../utils/autoMappingParser'
import { PORTAL_BASE_URLS } from '../config/env'

const DEFAULT_FORECAST_PREFERENCE = { sourceName: 'FinalForecast', beforeMinutes: 60 }

function generateId(): string {
  return crypto.randomUUID()
}

function resolveGroupTimezone(session: UserSession): string {
  return session.groups.find(g => g.id === session.groupId)?.timezone ?? 'UTC'
}

function sanitizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, '_')
}

function resolveNameConflict(base: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base }
  let i = 2
  while (used.has(`${base}_${i}`)) i++
  const name = `${base}_${i}`
  used.add(name)
  return name
}

function fallbackCompany(session: UserSession): { CompanyId: number; CompanyName: string } {
  const first = session.companies?.[0]
  return first
    ? { CompanyId: first.id, CompanyName: first.name }
    : { CompanyId: 0, CompanyName: 'Auto Mapped' }
}

interface PortalCompanyConfig {
  CompanyId: number
  CompanyName: string
  PowerPlantLimits: Array<{
    PowerPlantId: number
    PowerPlantName: string
    InstalledPowerMW: number
  }>
}

export async function fetchCompanyPowerPlants(
  cookies: string[],
  env: string,
  accessToken: string,
): Promise<PortalCompanyConfig[]> {
  const baseUrl = PORTAL_BASE_URLS[env] ?? PORTAL_BASE_URLS['prod']
  const response = await axios.post(
    `${baseUrl}/Configuration/GetCompanyPowerPlantConfigurations`,
    {},
    {
      headers: {
        Cookie: cookies.join('; '),
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  )
  return response.data as PortalCompanyConfig[]
}

export async function runAutoMapping(
  session: UserSession,
  profile: GroupProfile,
  ftpService: FtpService,
  configStore: ConfigStoreService,
  emit: (event: AutoMappingEvent) => void,
): Promise<void> {
  const timezone = resolveGroupTimezone(session)
  const assetMapping = profile.assetMapping as AssetMapping | undefined
  const ftpDirection = assetMapping?.ftpDirection ?? 'incoming'
  const ftpFilename = assetMapping?.ftpFilename ?? 'Technical_Parameters.csv'
  const allWarnings: AutoMappingWarning[] = []

  // === PHASE 1: CSV ===
  let csvContent: string
  try {
    csvContent = await ftpService.readFile(session.portalCookies, session.env, ftpDirection, ftpFilename)
  } catch {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.csvFailed' })
    return
  }

  const parsed = parseAutoMappingCsv(csvContent)
  for (const w of parsed.warnings) {
    allWarnings.push(w)
    emit({ step: 'warning', warnType: w.type, i18nKey: `autoMapping.warn.${w.type}`, params: { column: w.column ?? '' } })
  }
  emit({ step: 'csv_read', status: 'ok', batteriesFound: parsed.batteries.length })

  const batteryAssetIds = new Set<number>()
  const pvAssetIds = new Set<number>()
  const seenPlantIds = new Set<number>()
  const usedNames = new Set<string>()
  const phase1Gcps: GridConnectionPoint[] = []
  const idBase = Date.now()
  let bessCount = 0
  let solarCount = 0

  for (let index = 0; index < parsed.batteries.length; index++) {
    const battery = parsed.batteries[index]
    if (battery.assetId === null) continue

    if (seenPlantIds.has(battery.assetId)) {
      const warn: AutoMappingWarning = {
        type: 'duplicate_plant_id',
        message: `Duplicate asset ID: ${battery.assetId} (${battery.name})`,
        column: battery.name,
      }
      allWarnings.push(warn)
      emit({ step: 'warning', warnType: 'duplicate_plant_id', i18nKey: 'autoMapping.warn.duplicate_plant_id', params: { column: battery.name } })
      continue
    }

    seenPlantIds.add(battery.assetId)
    batteryAssetIds.add(battery.assetId)

    const bp = battery.bessParams

    const bessComponent: GcpComponent = {
      componentId: generateId(),
      type: 'BESS',
      displayName: battery.name,
      portalPlantId: battery.assetId,
      forecastPreference: { ...DEFAULT_FORECAST_PREFERENCE },
      monitoring: battery.masternode ? { masternode: battery.masternode, metrics: [] } : undefined,
      bessParams: Object.values(bp).some(v => v !== undefined) ? bp as BessParams : undefined,
      installedCapacityMw: bp.maxDischargePowerMw ?? undefined,
    }
    bessCount++

    const components: GcpComponent[] = [bessComponent]

    if (battery.pvAssetId !== null && !seenPlantIds.has(battery.pvAssetId)) {
      seenPlantIds.add(battery.pvAssetId)
      pvAssetIds.add(battery.pvAssetId)
      const solarComponent: GcpComponent = {
        componentId: generateId(),
        type: 'SOLAR',
        displayName: battery.name + '_PV',
        portalPlantId: battery.pvAssetId,
        forecastPreference: { ...DEFAULT_FORECAST_PREFERENCE },
        monitoring: battery.masternode ? { masternode: battery.masternode, metrics: [] } : undefined,
        installedCapacityAcMw: battery.pvCapacityAcMw ?? undefined,
        installedCapacityDcMwp: battery.pvCapacityDcMwp ?? undefined,
      }
      components.push(solarComponent)
      solarCount++
    }

    let gcpName = sanitizeName(battery.name) + '_GCP'
    gcpName = resolveNameConflict(gcpName, usedNames)

    const gcp: GridConnectionPoint = {
      id: idBase + index,
      name: gcpName,
      timezone,
      resolutionMinutes: 15,
      components,
      maxInjectionMw: battery.maxInjectionMw ?? undefined,
      maxConsumptionMw: battery.maxConsumptionMw ?? undefined,
      damPortfolioId: battery.damPortfolioId ?? undefined,
    }

    phase1Gcps.push(gcp)
    emit({ step: 'gcp_phase1', status: 'ok', name: gcpName, bessPlantId: battery.assetId, pvPlantId: battery.pvAssetId ?? undefined })
  }

  emit({ step: 'phase1_done', status: 'ok', gcps: phase1Gcps.length, bess: bessCount, solar: solarCount })

  // === PHASE 2: Portal ===
  let portalConfigs: PortalCompanyConfig[] = []
  const plantIdToCompany = new Map<number, { CompanyId: number; CompanyName: string }>()
  let phase2Success = false
  const phase2Gcps: GridConnectionPoint[] = []
  const excludedIds = new Set<number>([...batteryAssetIds, ...pvAssetIds])

  try {
    portalConfigs = await fetchCompanyPowerPlants(session.portalCookies, session.env, session.portalAccessToken)
    let totalPlants = 0
    for (const config of portalConfigs) {
      for (const plant of config.PowerPlantLimits) {
        plantIdToCompany.set(plant.PowerPlantId, { CompanyId: config.CompanyId, CompanyName: config.CompanyName })
        totalPlants++
      }
    }
    emit({ step: 'portal_fetch', status: 'ok', plantsFound: totalPlants })
    phase2Success = true
  } catch {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.portalFailed' })
    emit({ step: 'phase2_done', status: 'ok', unmappedGcps: 0 })
  }

  if (phase2Success) {
    for (const config of portalConfigs) {
      for (const plant of config.PowerPlantLimits) {
        if (plant.PowerPlantId <= 0 || excludedIds.has(plant.PowerPlantId) || seenPlantIds.has(plant.PowerPlantId)) {
          continue
        }
        seenPlantIds.add(plant.PowerPlantId)

        let gcpName = sanitizeName(plant.PowerPlantName) + '_GCP'
        gcpName = resolveNameConflict(gcpName, usedNames)

        const gcp: GridConnectionPoint = {
          id: idBase + phase1Gcps.length + phase2Gcps.length,
          name: gcpName,
          timezone,
          resolutionMinutes: 15,
          components: [{
            componentId: generateId(),
            type: 'SOLAR',
            displayName: plant.PowerPlantName,
            portalPlantId: plant.PowerPlantId,
            installedCapacityMw: plant.InstalledPowerMW > 0 ? plant.InstalledPowerMW : undefined,
            forecastPreference: { ...DEFAULT_FORECAST_PREFERENCE },
          }],
        }

        phase2Gcps.push(gcp)
        emit({ step: 'gcp_phase2', status: 'ok', name: gcpName, plantId: plant.PowerPlantId })
      }
    }

    emit({ step: 'phase2_done', status: 'ok', unmappedGcps: phase2Gcps.length })
  }

  // === COMPANY ASSIGNMENT ===
  const companyMap = new Map<number, CompanyMapping>()

  const getOrCreateCompany = (info: { CompanyId: number; CompanyName: string }): CompanyMapping => {
    if (!companyMap.has(info.CompanyId)) {
      companyMap.set(info.CompanyId, {
        companyId: info.CompanyId,
        companyName: info.CompanyName,
        timezone,
        gridConnectionPoints: [],
      })
    }
    return companyMap.get(info.CompanyId)!
  }

  for (const gcp of phase1Gcps) {
    const bessComp = gcp.components.find(c => c.type === 'BESS')
    const bessPlantId = bessComp?.portalPlantId
    const companyInfo = (bessPlantId != null && plantIdToCompany.has(bessPlantId))
      ? plantIdToCompany.get(bessPlantId)!
      : fallbackCompany(session)
    getOrCreateCompany(companyInfo).gridConnectionPoints.push(gcp)
  }

  if (phase2Success) {
    for (const gcp of phase2Gcps) {
      const gcpPlantId = gcp.components[0]?.portalPlantId
      const companyInfo = (gcpPlantId != null && plantIdToCompany.has(gcpPlantId))
        ? plantIdToCompany.get(gcpPlantId)!
        : fallbackCompany(session)
      getOrCreateCompany(companyInfo).gridConnectionPoints.push(gcp)
    }
  }

  const newMapping: AssetMapping = {
    companies: [...companyMap.values()],
    ftpDirection: assetMapping?.ftpDirection ?? 'incoming',
    ftpFilename: assetMapping?.ftpFilename ?? 'Technical_Parameters.csv',
  }

  await configStore.saveProfile(
    session.username,
    { ...profile, assetMapping: newMapping } as unknown as DashboardProfile,
    String(session.groupId),
  )
  emit({ step: 'saved', status: 'ok' })

  const gcpsCreated = phase1Gcps.length + phase2Gcps.length
  emit({
    step: 'done',
    status: 'ok',
    report: {
      gcpsCreated,
      bessCreated: bessCount,
      solarCreated: solarCount,
      unmappedGcpsCreated: phase2Gcps.length,
      warnings: allWarnings,
      skipped: [],
      overallStatus: phase2Success ? 'success' : 'partial',
    } satisfies AutoMappingReport,
  })
}
