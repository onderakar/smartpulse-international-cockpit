import { AttributeDefinition } from '../types/attributes.types';

/**
 * System-shipped attribute definitions.
 * These define the known technical attributes for GCP, Component, and SubComponent entities.
 * Each definition includes csvColumnAliases for mapping from Technical_Parameters.csv.
 *
 * CSV row labels are matched case-insensitively after normalization (lowercase + alias resolution).
 */
export const ATTRIBUTE_DEFINITIONS: readonly AttributeDefinition[] = [
  // ── GCP-scoped attributes ──────────────────────────────────────────
  {
    key: 'gcp_max_injection_mw',
    labelKey: 'attr.gcp_max_injection_mw',
    dataType: 'number',
    unit: 'MW',
    entityScopes: ['GCP'],
    required: false,
    group: 'capacity',
    source: 'system',
    csvColumnAliases: ['total_grid_capacity_generation_mw'],
  },
  {
    key: 'gcp_max_consumption_mw',
    labelKey: 'attr.gcp_max_consumption_mw',
    dataType: 'number',
    unit: 'MW',
    entityScopes: ['GCP'],
    required: false,
    group: 'capacity',
    source: 'system',
    csvColumnAliases: ['total_grid_capacity_consumption_mw'],
  },
  {
    key: 'gcp_dam_portfolio_id',
    labelKey: 'attr.gcp_dam_portfolio_id',
    dataType: 'string',
    entityScopes: ['GCP'],
    required: false,
    group: 'identification',
    source: 'system',
    csvColumnAliases: ['portfolio_id_dam_gen', 'porfolio_id_dam_gen'],
  },

  // ── BESS-scoped component attributes ───────────────────────────────
  {
    key: 'bess_max_discharge_mw',
    labelKey: 'attr.bess_max_discharge_mw',
    dataType: 'number',
    unit: 'MW',
    entityScopes: ['COMPONENT'],
    componentTypes: ['BESS'],
    required: false,
    group: 'electrical',
    source: 'system',
    csvColumnAliases: ['max_battery_discharge_power_mw'],
  },
  {
    key: 'bess_max_charge_mw',
    labelKey: 'attr.bess_max_charge_mw',
    dataType: 'number',
    unit: 'MW',
    entityScopes: ['COMPONENT'],
    componentTypes: ['BESS'],
    required: false,
    group: 'electrical',
    source: 'system',
    csvColumnAliases: ['max_battery_charge_power_mw'],
  },
  {
    key: 'bess_capacity_mwh',
    labelKey: 'attr.bess_capacity_mwh',
    dataType: 'number',
    unit: 'MWh',
    entityScopes: ['COMPONENT'],
    componentTypes: ['BESS'],
    required: false,
    group: 'capacity',
    source: 'system',
    csvColumnAliases: ['battery_capacity_mwh'],
  },
  {
    key: 'bess_charge_efficiency',
    labelKey: 'attr.bess_charge_efficiency',
    dataType: 'number',
    unit: '%',
    entityScopes: ['COMPONENT'],
    componentTypes: ['BESS'],
    required: false,
    group: 'electrical',
    source: 'system',
    csvColumnAliases: ['charge_efficiency_percentage'],
  },
  {
    key: 'bess_discharge_efficiency',
    labelKey: 'attr.bess_discharge_efficiency',
    dataType: 'number',
    unit: '%',
    entityScopes: ['COMPONENT'],
    componentTypes: ['BESS'],
    required: false,
    group: 'electrical',
    source: 'system',
    csvColumnAliases: ['discharge_efficiency_percentage'],
  },
  {
    key: 'bess_min_soc_pct',
    labelKey: 'attr.bess_min_soc_pct',
    dataType: 'number',
    unit: '%',
    entityScopes: ['COMPONENT'],
    componentTypes: ['BESS'],
    required: false,
    group: 'electrical',
    source: 'system',
    csvColumnAliases: ['min_soc_percentage'],
  },
  {
    key: 'bess_max_soc_pct',
    labelKey: 'attr.bess_max_soc_pct',
    dataType: 'number',
    unit: '%',
    entityScopes: ['COMPONENT'],
    componentTypes: ['BESS'],
    required: false,
    group: 'electrical',
    source: 'system',
    csvColumnAliases: ['max_soc_percentage'],
  },

  // ── Universal component attributes ─────────────────────────────────
  {
    key: 'comp_installed_capacity_ac_mw',
    labelKey: 'attr.comp_installed_capacity_ac_mw',
    dataType: 'number',
    unit: 'MW',
    entityScopes: ['COMPONENT'],
    componentTypes: ['SOLAR', 'WIND', 'HYDRO', 'THERMAL', 'LOAD', 'CONSUMPTION', 'OTHER'],
    required: false,
    group: 'capacity',
    source: 'system',
    csvColumnAliases: ['pv_capacity_mw_ac', 'installedpowermw'],
  },
  {
    key: 'comp_installed_capacity_dc_mw',
    labelKey: 'attr.comp_installed_capacity_dc_mw',
    dataType: 'number',
    unit: 'MWp',
    entityScopes: ['COMPONENT'],
    componentTypes: ['SOLAR', 'WIND', 'HYDRO', 'THERMAL', 'LOAD', 'CONSUMPTION', 'OTHER'],
    required: false,
    group: 'capacity',
    source: 'system',
    csvColumnAliases: ['pv_capacity_mwp'],
  },
] as const;

/** Merge system seed + custom (admin-created) definitions. Custom can override seed by key. */
export function mergeDefinitions(custom?: AttributeDefinition[]): AttributeDefinition[] {
  if (!custom?.length) return [...ATTRIBUTE_DEFINITIONS];
  const merged = new Map<string, AttributeDefinition>();
  for (const def of ATTRIBUTE_DEFINITIONS) merged.set(def.key, def);
  for (const def of custom) merged.set(def.key, def);
  return Array.from(merged.values());
}

/** Lookup definitions by entity scope, optionally filtered by component type */
export function getDefinitionsForScope(
  allDefs: readonly AttributeDefinition[],
  scope: 'GCP' | 'COMPONENT' | 'SUBCOMPONENT',
  componentType?: string,
): AttributeDefinition[] {
  return allDefs.filter(def => {
    if (def.deprecated) return false;
    if (!def.entityScopes.includes(scope)) return false;
    if (def.componentTypes && componentType && !def.componentTypes.includes(componentType as any)) return false;
    return true;
  });
}
