import crypto from 'node:crypto'
import axios from 'axios'
import {
  GridConnectionPoint,
  GcpComponent,
  GcpSubComponent,
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
import { parseAutoMappingCsv, BatteryColumn } from '../utils/autoMappingParser'
import { mergeDefinitions } from '@smartpulse-intl/shared'
import { PORTAL_BASE_URLS } from '../config/env'
import {
  groupPlantsByGcp,
  extractRootName,
  PortalPlantEntry,
  ComponentGroup,
} from '../utils/nameParser'

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

/**
 * Build a GcpComponent from a ComponentGroup (one physical component's plant entries).
 * Assigns gen/con sub-components based on direction keywords in plant names.
 * @param csvBattery  BatteryColumn from CSV — only provided for BESS components in Phase 1
 * @param masternode  Masternode string from CSV, or null
 * @param emitWarn    Callback to emit a warning event
 */
function buildComponent(
  compGroup: ComponentGroup,
  csvBattery: BatteryColumn | null,
  masternode: string | null,
  emitWarn: (type: AutoMappingWarning['type'], i18nKey: string, params?: Record<string, string | number>) => void,
): GcpComponent {
  let generation: GcpSubComponent | undefined
  let consumption: GcpSubComponent | undefined
  let directPortalPlantId: number | undefined
  let directInstalledPowerMw: number | undefined

  for (const { plant, direction } of compGroup.plants) {
    const sub: GcpSubComponent = {
      portalPlantId: plant.plantId,
      installedPowerMw: plant.installedPowerMw > 0 ? plant.installedPowerMw : undefined,
      portalPlantName: plant.plantName,
    }

    if (direction === 'none') {
      // Direct component-level mapping — no gen/con subcomponent wrapping
      if (directPortalPlantId !== undefined) {
        // Multiple direction-less plants in same component group → ambiguous
        emitWarn('ambiguous_direction', 'autoMapping.warn.ambiguous_direction', { plantName: plant.plantName })
      } else {
        directPortalPlantId = plant.plantId
        directInstalledPowerMw = plant.installedPowerMw > 0 ? plant.installedPowerMw : undefined
      }
    } else if (direction === 'gen') {
      if (generation) {
        emitWarn('duplicate_direction', 'autoMapping.warn.duplicate_direction', { plantName: plant.plantName, direction: 'gen' })
      } else {
        generation = sub
      }
    } else if (direction === 'con') {
      if (consumption) {
        emitWarn('duplicate_direction', 'autoMapping.warn.duplicate_direction', { plantName: plant.plantName, direction: 'con' })
      } else {
        consumption = sub
      }
    } else {
      // 'ambiguous': both gen+con keywords in the same plant name
      emitWarn('ambiguous_direction', 'autoMapping.warn.ambiguous_direction', { plantName: plant.plantName })
      if (!generation) generation = sub
    }
  }

  const type = compGroup.componentType ?? 'SOLAR'

  const comp: GcpComponent = {
    componentId: generateId(),
    type,
    displayName: compGroup.componentKey,
    // Direct mapping if no gen/con keywords; subcomponent mapping otherwise
    ...(directPortalPlantId !== undefined
      ? { portalPlantId: directPortalPlantId }
      : { generation, consumption }
    ),
    forecastPreference: { ...DEFAULT_FORECAST_PREFERENCE },
    monitoring: masternode ? { masternode, metrics: [] } : undefined,
  }

  if (csvBattery && type === 'BESS') {
    const bp = csvBattery.bessParams
    if (Object.values(bp).some(v => v !== undefined)) {
      comp.bessParams = bp as BessParams
    }
    // Prefer CSV max discharge power; fall back to portal InstalledPowerMW for direct-mapped components
    comp.installedCapacityMw = bp.maxDischargePowerMw ?? directInstalledPowerMw ?? undefined
    // Populate extension attributes from CSV
    if (Object.keys(csvBattery.componentAttributes).length > 0) {
      comp.attributes = csvBattery.componentAttributes
    }
  }

  // For companion (non-BESS) components: populate installed capacity from the battery CSV row
  // CSV stores PV_Capacity_MW_ac and PV_Capacity_MWp under the battery column,
  // but these values belong to the companion plant sharing the same GCP.
  if (csvBattery && type !== 'BESS') {
    const attrs: Record<string, string | number | boolean | null> = {}
    if (csvBattery.pvCapacityAcMw != null) attrs['comp_installed_capacity_ac_mw'] = csvBattery.pvCapacityAcMw
    if (csvBattery.pvCapacityDcMwp != null) attrs['comp_installed_capacity_dc_mw'] = csvBattery.pvCapacityDcMwp
    // Also set the static field for backward compatibility
    if (csvBattery.pvCapacityAcMw != null) comp.installedCapacityAcMw = csvBattery.pvCapacityAcMw
    if (csvBattery.pvCapacityDcMwp != null) comp.installedCapacityDcMwp = csvBattery.pvCapacityDcMwp
    if (Object.keys(attrs).length > 0) comp.attributes = { ...comp.attributes, ...attrs }
  }

  return comp
}

export async function runAutoMapping(
  session: UserSession,
  profile: GroupProfile,
  ftpService: FtpService,
  configStore: ConfigStoreService,
  runPhase2: boolean,
  emit: (event: AutoMappingEvent) => void,
): Promise<void> {
  const timezone = resolveGroupTimezone(session)
  const assetMapping = profile.assetMapping as AssetMapping | undefined
  const ftpDirection = assetMapping?.ftpDirection ?? 'incoming'
  const ftpFilename = assetMapping?.ftpFilename ?? 'Technical_Parameters.csv'
  const allWarnings: AutoMappingWarning[] = []

  const emitWarn = (
    type: AutoMappingWarning['type'],
    i18nKey: string,
    params?: Record<string, string | number>,
  ) => {
    const warn: AutoMappingWarning = {
      type,
      message: i18nKey,
      ...(params?.column    && { column:    String(params.column)    }),
      ...(params?.plantId   && { plantId:   Number(params.plantId)   }),
      ...(params?.plantName && { plantName: String(params.plantName) }),
    }
    allWarnings.push(warn)
    emit({ step: 'warning', warnType: type, i18nKey, params })
  }

  // === STEP 0: Fetch portal plants (required before Phase 1) ===
  let portalConfigs: PortalCompanyConfig[] = []
  const portalPlantMap = new Map<number, PortalPlantEntry>()
  const plantIdToCompany = new Map<number, { CompanyId: number; CompanyName: string }>()
  const allPortalPlants: PortalPlantEntry[] = []

  try {
    portalConfigs = await fetchCompanyPowerPlants(session.portalCookies, session.env, session.portalAccessToken)
    for (const config of portalConfigs) {
      for (const plant of config.PowerPlantLimits) {
        const entry: PortalPlantEntry = {
          plantId: plant.PowerPlantId,
          plantName: plant.PowerPlantName,
          installedPowerMw: plant.InstalledPowerMW,
          companyId: config.CompanyId,
          companyName: config.CompanyName,
        }
        portalPlantMap.set(plant.PowerPlantId, entry)
        plantIdToCompany.set(plant.PowerPlantId, { CompanyId: config.CompanyId, CompanyName: config.CompanyName })
        allPortalPlants.push(entry)
      }
    }
    emit({ step: 'portal_fetch', status: 'ok', plantsFound: allPortalPlants.length })
  } catch {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.portalFailed' })
    return
  }

  // === PHASE 1: CSV ===
  let csvContent: string
  try {
    csvContent = await ftpService.readFile(session.portalCookies, session.env, ftpDirection, ftpFilename)
  } catch {
    emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.csvFailed' })
    return
  }

  const allDefs = mergeDefinitions(profile.customAttributeDefinitions)
  const parsed = parseAutoMappingCsv(csvContent, allDefs)
  for (const w of parsed.warnings) {
    allWarnings.push(w)
    emit({ step: 'warning', warnType: w.type, i18nKey: `autoMapping.warn.${w.type}`, params: { column: w.column ?? '' } })
  }
  emit({ step: 'csv_read', status: 'ok', batteriesFound: parsed.batteries.length })

  const seenAssetIds = new Set<number>()
  const usedNames = new Set<string>()
  const phase1UsedPlantIds = new Set<number>()
  const phase1GcpRoots = new Set<string>()
  const phase1Gcps: GridConnectionPoint[] = []
  const idBase = Date.now()
  let phase1BessComponents = 0
  let phase1GenSubComponents = 0
  let phase1ConSubComponents = 0
  let phase1AmbiguousNames = 0
  let phase1NameGroupsFound = 0

  for (let index = 0; index < parsed.batteries.length; index++) {
    const battery = parsed.batteries[index]
    if (battery.assetId === null) continue

    if (seenAssetIds.has(battery.assetId)) {
      emitWarn('duplicate_plant_id', 'autoMapping.warn.duplicate_plant_id', { column: battery.name, plantId: battery.assetId })
      continue
    }
    seenAssetIds.add(battery.assetId)

    // Resolve canonical name from portal
    const refPlant = portalPlantMap.get(battery.assetId)
    if (!refPlant) {
      emitWarn('missing_portal_plant', 'autoMapping.warn.missing_portal_plant', { column: battery.name, plantId: battery.assetId })
    }

    const canonicalName = refPlant?.plantName ?? battery.name
    const gcpRoot = extractRootName(canonicalName)

    // Skip if this GCP root was already processed by a previous battery column
    if (phase1GcpRoots.has(gcpRoot)) continue
    phase1GcpRoots.add(gcpRoot)
    phase1NameGroupsFound++

    // Find all portal plants sharing this GCP root name
    const companionPlants = allPortalPlants.filter(p => extractRootName(p.plantName) === gcpRoot)

    const gcpGroups = groupPlantsByGcp(companionPlants)
    const gcpGroup = gcpGroups.get(gcpRoot)

    if (!gcpGroup) continue

    const components: GcpComponent[] = []
    let gcpGenPlantId: number | undefined
    let gcpConPlantId: number | undefined

    for (const compGroup of gcpGroup.components.values()) {
      const isBess = compGroup.componentType === 'BESS'
      const prevWarnCount = allWarnings.length

      const comp = buildComponent(
        compGroup,
        battery,
        battery.masternode,
        emitWarn,
      )
      components.push(comp)

      const newWarns = allWarnings.slice(prevWarnCount)
      if (newWarns.some(w => w.type === 'ambiguous_direction')) phase1AmbiguousNames++

      if (isBess) {
        phase1BessComponents++
        if (comp.generation) { phase1GenSubComponents++; gcpGenPlantId = comp.generation.portalPlantId }
        if (comp.consumption) { phase1ConSubComponents++; gcpConPlantId = comp.consumption.portalPlantId }
        // Direct mapping: counts as one gen equivalent for tracking
        if (comp.portalPlantId && !comp.generation && !comp.consumption) {
          phase1GenSubComponents++
          gcpGenPlantId = comp.portalPlantId
        }
      } else {
        if (comp.generation) { phase1GenSubComponents++; if (!gcpGenPlantId) gcpGenPlantId = comp.generation.portalPlantId }
        if (comp.consumption) { phase1ConSubComponents++; if (!gcpConPlantId) gcpConPlantId = comp.consumption.portalPlantId }
        if (comp.portalPlantId && !comp.generation && !comp.consumption) {
          phase1GenSubComponents++
          if (!gcpGenPlantId) gcpGenPlantId = comp.portalPlantId
        }
      }

      if (comp.generation) phase1UsedPlantIds.add(comp.generation.portalPlantId)
      if (comp.consumption) phase1UsedPlantIds.add(comp.consumption.portalPlantId)
      if (comp.portalPlantId) phase1UsedPlantIds.add(comp.portalPlantId)
    }

    let gcpName = sanitizeName(gcpGroup.gcpDisplayName)
    gcpName = resolveNameConflict(gcpName, usedNames)

    const gcp: GridConnectionPoint = {
      id: idBase + index,
      name: gcpName,
      timezone,
      components,
      maxInjectionMw: battery.maxInjectionMw ?? undefined,
      maxConsumptionMw: battery.maxConsumptionMw ?? undefined,
      damPortfolioId: battery.damPortfolioId ?? undefined,
      attributes: Object.keys(battery.gcpAttributes).length > 0 ? battery.gcpAttributes : undefined,
    }

    phase1Gcps.push(gcp)
    emit({
      step: 'gcp_phase1',
      status: 'ok',
      gcpName,
      gcpRoot,
      genPlantId: gcpGenPlantId,
      conPlantId: gcpConPlantId,
      companionComponents: components.length,
    })
  }

  emit({
    step: 'phase1_done',
    status: 'ok',
    gcps: phase1Gcps.length,
    bessComponents: phase1BessComponents,
    genSubComponents: phase1GenSubComponents,
    conSubComponents: phase1ConSubComponents,
    nameGroupsFound: phase1NameGroupsFound,
    ambiguousNames: phase1AmbiguousNames,
  })

  // === PHASE 2: Portal (optional) ===
  const phase2Gcps: GridConnectionPoint[] = []
  let phase2Standalone = 0
  let phase2Grouped = 0

  if (runPhase2) {
    const remainingPlants = allPortalPlants.filter(p =>
      p.plantId > 0 &&
      !phase1UsedPlantIds.has(p.plantId) &&
      !phase1GcpRoots.has(extractRootName(p.plantName))
    )

    emit({ step: 'phase2_scan', status: 'ok', plantsScanned: remainingPlants.length })

    const phase2Groups = groupPlantsByGcp(remainingPlants)

    for (const [, plantGroup] of phase2Groups) {
      const components: GcpComponent[] = []
      let genCount = 0
      let conCount = 0

      for (const compGroup of plantGroup.components.values()) {
        const comp = buildComponent(compGroup, null, null, emitWarn)
        components.push(comp)
        if (comp.generation) genCount++
        if (comp.consumption) conCount++
        if (comp.portalPlantId && !comp.generation && !comp.consumption) genCount++ // direct = counts as gen
      }

      // Handles both direct (portalPlantId only) and subcomponent (generation only, no consumption) cases
      const isStandalone = components.length === 1 && (
        (components[0].portalPlantId && !components[0].generation && !components[0].consumption) ||
        (components[0].generation && !components[0].consumption && !components[0].portalPlantId)
      )
      if (isStandalone) phase2Standalone++
      else phase2Grouped++

      let gcpName = sanitizeName(plantGroup.gcpDisplayName)
      gcpName = resolveNameConflict(gcpName, usedNames)

      const gcp: GridConnectionPoint = {
        id: idBase + phase1Gcps.length + phase2Gcps.length,
        name: gcpName,
        timezone,
        components,
      }

      phase2Gcps.push(gcp)
      emit({ step: 'gcp_phase2', status: 'ok', name: gcpName, plantCount: components.length, genCount, conCount })
    }

    emit({ step: 'phase2_done', status: 'ok', gcpsCreated: phase2Gcps.length, standalone: phase2Standalone, grouped: phase2Grouped })
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

  const resolveCompanyForGcp = (gcp: GridConnectionPoint): { CompanyId: number; CompanyName: string } => {
    for (const comp of gcp.components) {
      const pid = comp.generation?.portalPlantId ?? comp.consumption?.portalPlantId ?? comp.portalPlantId
      if (pid != null && plantIdToCompany.has(pid)) {
        return plantIdToCompany.get(pid)!
      }
    }
    return fallbackCompany(session)
  }

  for (const gcp of phase1Gcps) {
    getOrCreateCompany(resolveCompanyForGcp(gcp)).gridConnectionPoints.push(gcp)
  }
  for (const gcp of phase2Gcps) {
    getOrCreateCompany(resolveCompanyForGcp(gcp)).gridConnectionPoints.push(gcp)
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
      csvBatteriesFound: parsed.batteries.length,
      phase1GcpsCreated: phase1Gcps.length,
      phase1BessComponents,
      phase1GenSubComponents,
      phase1ConSubComponents,
      phase1NameGroupsFound,
      phase1AmbiguousNames,
      phase2Ran: runPhase2,
      phase2PlantsScanned: runPhase2 ? allPortalPlants.length - phase1UsedPlantIds.size : 0,
      phase2GcpsCreated: phase2Gcps.length,
      phase2StandaloneFound: phase2Standalone,
      phase2GroupedFound: phase2Grouped,
      gcpsCreated,
      warnings: allWarnings,
      skipped: [],
      overallStatus: 'success',
    } satisfies AutoMappingReport,
  })
}
