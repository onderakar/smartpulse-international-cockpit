import { ComponentType } from '@smartpulse-intl/shared'

// ── Direction patterns ──────────────────────────────────────────────────────
// Word-boundary + case-insensitive. Stateful /g flag requires lastIndex reset.
const DIR_GEN = /\b(gen|generation)\b/gi
const DIR_CON = /\b(con|consumption)\b/gi

// ── Component type patterns (priority order — BESS before PV/SOLAR) ─────────
const TYPE_PATTERNS: Array<{ pattern: RegExp; type: ComponentType }> = [
  { pattern: /\bBESS\w*/gi,   type: 'BESS'    },
  { pattern: /\bPV\b/gi,      type: 'SOLAR'   },
  { pattern: /\bsolar\b/gi,   type: 'SOLAR'   },
  { pattern: /\bwind\b/gi,    type: 'WIND'    },
  { pattern: /\bhydro\b/gi,   type: 'HYDRO'   },
  { pattern: /\bthermal\b/gi, type: 'THERMAL' },
]

function resetRegex(...regexes: RegExp[]) {
  regexes.forEach(r => { r.lastIndex = 0 })
}

/** Returns the direction keyword found in the name.
 *  'gen'       → gen/generation keyword found
 *  'con'       → con/consumption keyword found
 *  'none'      → no direction keyword (direct component-level mapping)
 *  'ambiguous' → both gen and con found in same name (warning case)
 */
export function extractDirectionFromName(name: string): 'gen' | 'con' | 'none' | 'ambiguous' {
  resetRegex(DIR_GEN, DIR_CON)
  const hasGen = DIR_GEN.test(name)
  resetRegex(DIR_GEN, DIR_CON)
  const hasCon = DIR_CON.test(name)
  resetRegex(DIR_GEN, DIR_CON)
  if (hasGen && hasCon) return 'ambiguous'
  if (hasGen) return 'gen'
  if (hasCon) return 'con'
  return 'none'
}

/** Returns the dominant component type keyword found in the name, or null. */
export function extractComponentType(name: string): ComponentType | null {
  for (const { pattern, type } of TYPE_PATTERNS) {
    pattern.lastIndex = 0
    const found = pattern.test(name)
    pattern.lastIndex = 0
    if (found) return type
  }
  return null
}

function stripDirectionKeywords(name: string): string {
  resetRegex(DIR_GEN, DIR_CON)
  const result = name.replace(DIR_GEN, '').replace(DIR_CON, '')
  resetRegex(DIR_GEN, DIR_CON)
  return result.replace(/\s+/g, ' ').trim()
}

function stripTypeKeywords(name: string): string {
  let s = name
  for (const { pattern } of TYPE_PATTERNS) {
    pattern.lastIndex = 0
    s = s.replace(pattern, '')
    pattern.lastIndex = 0
  }
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * GCP root key — strips BOTH direction AND type keywords, lowercases,
 * normalises hyphens to spaces.
 * Example: "Bagrentsi BESS Gen" → "bagrentsi"
 */
export function extractRootName(name: string): string {
  return stripTypeKeywords(stripDirectionKeywords(name))
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Component group key — strips direction only (keeps type keyword), lowercases.
 * Example: "Bagrentsi BESS Gen" → "bagrentsi bess"
 *          "Bagrentsi BESS Con" → "bagrentsi bess"  ← same key = same component
 */
export function extractComponentGroupKey(name: string): string {
  return stripDirectionKeywords(name)
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Grouping structures ──────────────────────────────────────────────────────

export interface PortalPlantEntry {
  plantId: number
  plantName: string
  installedPowerMw: number
  companyId: number
  companyName: string
}

export interface PlantSubComponentEntry {
  plant: PortalPlantEntry
  /** Direction inferred from plant name keywords */
  direction: 'gen' | 'con' | 'none' | 'ambiguous'
}

export interface ComponentGroup {
  componentKey: string
  componentType: ComponentType | null
  plants: PlantSubComponentEntry[]
}

export interface PlantGroup {
  gcpRootName: string
  /** Display name derived from the Generation-side plant name (preferred) */
  gcpDisplayName: string
  components: Map<string, ComponentGroup>
}

/**
 * Groups portal plants into a Map keyed by GCP root name.
 * Within each GCP group, plants are further grouped into ComponentGroups
 * by their component group key (type keyword retained, direction stripped).
 */
export function groupPlantsByGcp(plants: PortalPlantEntry[]): Map<string, PlantGroup> {
  const gcpGroups = new Map<string, PlantGroup>()

  for (const plant of plants) {
    const gcpRoot   = extractRootName(plant.plantName)
    const compKey   = extractComponentGroupKey(plant.plantName)
    const direction = extractDirectionFromName(plant.plantName)
    const compType  = extractComponentType(plant.plantName)

    if (!gcpGroups.has(gcpRoot)) {
      gcpGroups.set(gcpRoot, {
        gcpRootName: gcpRoot,
        gcpDisplayName: gcpRoot,   // updated in post-processing below
        components: new Map(),
      })
    }
    const gcpGroup = gcpGroups.get(gcpRoot)!

    if (!gcpGroup.components.has(compKey)) {
      gcpGroup.components.set(compKey, { componentKey: compKey, componentType: compType, plants: [] })
    }
    gcpGroup.components.get(compKey)!.plants.push({ plant, direction })
  }

  // Post-process: set gcpDisplayName from gen-side plant name (preferred),
  // falling back to 'none'-direction (direct-mapped) plants
  for (const gcpGroup of gcpGroups.values()) {
    let found = false
    // Prefer gen-side
    outer: for (const compGroup of gcpGroup.components.values()) {
      for (const entry of compGroup.plants) {
        if (entry.direction === 'gen') {
          const locationName = stripTypeKeywords(stripDirectionKeywords(entry.plant.plantName)).trim()
          if (locationName) { gcpGroup.gcpDisplayName = locationName; found = true }
          break outer
        }
      }
    }
    // Fallback: use direct-mapped ('none') plant name
    if (!found) {
      outer2: for (const compGroup of gcpGroup.components.values()) {
        for (const entry of compGroup.plants) {
          if (entry.direction === 'none') {
            const locationName = stripTypeKeywords(entry.plant.plantName).trim()
            if (locationName) { gcpGroup.gcpDisplayName = locationName }
            break outer2
          }
        }
      }
    }
  }

  return gcpGroups
}
