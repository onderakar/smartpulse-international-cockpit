/**
 * Syncs extension attributes from Technical_Parameters.csv data
 * onto the existing AssetMapping (GCP + Component attributes).
 *
 * This is extracted from autoMapping.service.ts so it can be called
 * independently from the BatteryParamsPage without re-running the full mapping.
 */
import { AssetMapping, GridConnectionPoint, GcpComponent } from '@smartpulse-intl/shared'
import { BatteryColumn } from '../utils/autoMappingParser'
import type { ExtensionAttributes } from '@smartpulse-intl/shared'

export interface AttributeSyncResult {
  gcpsUpdated: number
  componentsUpdated: number
  skipped: number
}

/**
 * Given parsed CSV batteries and existing asset mapping, update attributes
 * on GCPs and their components by matching Asset_ID → GCP id.
 */
export function syncAttributesFromCsv(
  mapping: AssetMapping,
  batteries: BatteryColumn[],
): AttributeSyncResult {
  const result: AttributeSyncResult = { gcpsUpdated: 0, componentsUpdated: 0, skipped: 0 }

  // Build a lookup: Asset_ID → BatteryColumn
  const batteryByAssetId = new Map<number, BatteryColumn>()
  for (const bat of batteries) {
    if (bat.assetId != null) batteryByAssetId.set(bat.assetId, bat)
  }

  for (const company of mapping.companies) {
    for (const gcp of company.gridConnectionPoints) {
      const battery = batteryByAssetId.get(gcp.id)
      if (!battery) {
        result.skipped++
        continue
      }

      // Update GCP attributes
      const gcpAttrs: ExtensionAttributes = { ...gcp.attributes }
      let gcpChanged = false
      if (battery.gcpAttributes && Object.keys(battery.gcpAttributes).length > 0) {
        Object.assign(gcpAttrs, battery.gcpAttributes)
        gcpChanged = true
      }
      // Also sync static GCP fields
      if (battery.maxInjectionMw != null) { gcp.maxInjectionMw = battery.maxInjectionMw; gcpChanged = true }
      if (battery.maxConsumptionMw != null) { gcp.maxConsumptionMw = battery.maxConsumptionMw; gcpChanged = true }
      if (battery.damPortfolioId != null) { gcp.damPortfolioId = battery.damPortfolioId; gcpChanged = true }
      if (gcpChanged) {
        gcp.attributes = Object.keys(gcpAttrs).length > 0 ? gcpAttrs : undefined
        result.gcpsUpdated++
      }

      // Update component attributes
      for (const comp of gcp.components) {
        let compChanged = false
        const compAttrs: ExtensionAttributes = { ...comp.attributes }

        if (comp.type === 'BESS') {
          // BESS: sync bessParams + BESS-scoped extension attributes
          if (battery.componentAttributes && Object.keys(battery.componentAttributes).length > 0) {
            Object.assign(compAttrs, battery.componentAttributes)
            compChanged = true
          }
          // Sync static bessParams
          const bp = battery.bessParams
          if (Object.values(bp).some(v => v !== undefined)) {
            comp.bessParams = bp as any
            compChanged = true
          }
          if (bp.maxDischargePowerMw != null) {
            comp.installedCapacityMw = bp.maxDischargePowerMw
          }
        } else {
          // Non-BESS (companion PV/WIND): installed capacity from CSV PV rows
          if (battery.pvCapacityAcMw != null) {
            compAttrs['comp_installed_capacity_ac_mw'] = battery.pvCapacityAcMw
            comp.installedCapacityAcMw = battery.pvCapacityAcMw
            compChanged = true
          }
          if (battery.pvCapacityDcMwp != null) {
            compAttrs['comp_installed_capacity_dc_mw'] = battery.pvCapacityDcMwp
            comp.installedCapacityDcMwp = battery.pvCapacityDcMwp
            compChanged = true
          }
        }

        if (compChanged) {
          comp.attributes = Object.keys(compAttrs).length > 0 ? compAttrs : undefined
          result.componentsUpdated++
        }
      }
    }
  }

  return result
}
