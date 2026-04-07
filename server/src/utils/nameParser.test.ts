import {
  extractDirectionFromName,
  extractComponentType,
  extractRootName,
  extractComponentGroupKey,
  groupPlantsByGcp,
  type PortalPlantEntry,
} from './nameParser'

describe('extractDirectionFromName', () => {
  test.each([
    ['Bagrentsi BESS Gen', 'gen'],
    ['Bagrentsi BESS Gen ', 'gen'],
    ['Bagrentsi BESS Generation', 'gen'],
    ['Bagrentsi BESS GEN', 'gen'],
    ['Bagrentsi BESS Con', 'con'],
    ['Bagrentsi BESS Consumption', 'con'],
    ['Bagrentsi BESS CON', 'con'],
    ['Bagrentsi BESS', 'none'],      // no direction keyword → direct mapping
    ['Bagrentsi Asset', 'none'],     // no direction keyword → direct mapping
  ])('"%s" → %s', (name, expected) => {
    expect(extractDirectionFromName(name)).toBe(expected)
  })

  test('returns "ambiguous" when both gen and con are present', () => {
    expect(extractDirectionFromName('BESS Gen Con')).toBe('ambiguous')
  })
})

describe('extractComponentType', () => {
  test.each([
    ['Bagrentsi BESS Gen', 'BESS'],
    ['Bagrentsi PV Gen', 'SOLAR'],
    ['Bagrentsi Solar', 'SOLAR'],
    ['Bagrentsi Wind Farm', 'WIND'],
    ['Bagrentsi Hydro', 'HYDRO'],
    ['Bagrentsi Thermal', 'THERMAL'],
    ['Bagrentsi Asset', null],
  ])('"%s" → %s', (name, expected) => {
    expect(extractComponentType(name)).toBe(expected)
  })
})

describe('extractRootName', () => {
  test.each([
    ['Bagrentsi BESS Gen', 'bagrentsi'],
    ['Bagrentsi PV Generation', 'bagrentsi'],
    ['Bagrentsi BESS Con', 'bagrentsi'],
    ['Site-A BESS Gen', 'site a'],   // hyphen normalised to space
    ['Site A BESS Gen', 'site a'],
  ])('"%s" → "%s"', (name, expected) => {
    expect(extractRootName(name)).toBe(expected)
  })
})

describe('extractComponentGroupKey', () => {
  test('same key for gen and con of same component', () => {
    expect(extractComponentGroupKey('Bagrentsi BESS Gen')).toBe(extractComponentGroupKey('Bagrentsi BESS Con'))
  })
  test('different key for different type', () => {
    expect(extractComponentGroupKey('Bagrentsi BESS Gen')).not.toBe(extractComponentGroupKey('Bagrentsi PV Gen'))
  })
})

describe('groupPlantsByGcp', () => {
  const plants: PortalPlantEntry[] = [
    { plantId: 101, plantName: 'Bagrentsi BESS Gen', installedPowerMw: 10, companyId: 1, companyName: 'C1' },
    { plantId: 102, plantName: 'Bagrentsi BESS Con', installedPowerMw: 10, companyId: 1, companyName: 'C1' },
    { plantId: 103, plantName: 'Bagrentsi PV Gen',   installedPowerMw: 5,  companyId: 1, companyName: 'C1' },
  ]

  test('groups all three plants under one GCP root', () => {
    const groups = groupPlantsByGcp(plants)
    expect(groups.size).toBe(1)
  })

  test('creates two component groups: BESS and SOLAR/PV', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = [...groups.values()][0]
    expect(gcpGroup.components.size).toBe(2)
  })

  test('BESS component has gen=101 and con=102', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = [...groups.values()][0]
    const components = [...gcpGroup.components.values()]
    const bess = components.find(c => c.componentType === 'BESS')!
    expect(bess.plants.find(p => p.direction === 'gen')?.plant.plantId).toBe(101)
    expect(bess.plants.find(p => p.direction === 'con')?.plant.plantId).toBe(102)
  })

  test('PV component has gen=103 and no con', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = [...groups.values()][0]
    const components = [...gcpGroup.components.values()]
    const pv = components.find(c => c.componentType === 'SOLAR')!
    expect(pv.plants.find(p => p.direction === 'gen')?.plant.plantId).toBe(103)
    expect(pv.plants.find(p => p.direction === 'con')).toBeUndefined()
  })

  test('gcpDisplayName is derived from gen-side plant name (stripped)', () => {
    const groups = groupPlantsByGcp(plants)
    const gcpGroup = [...groups.values()][0]
    expect(gcpGroup.gcpDisplayName.toLowerCase()).toContain('bagrentsi')
  })

  test('standalone plant without direction keyword gets direction "none"', () => {
    const standalone: PortalPlantEntry[] = [
      { plantId: 200, plantName: 'Meridian BESS', installedPowerMw: 8, companyId: 1, companyName: 'C1' },
    ]
    const groups = groupPlantsByGcp(standalone)
    const gcpGroup = [...groups.values()][0]
    const compGroup = [...gcpGroup.components.values()][0]
    expect(compGroup.plants[0].direction).toBe('none')
  })

  test('gcpDisplayName is derived from plant name even when no direction keyword (direct mapping)', () => {
    const standalone: PortalPlantEntry[] = [
      { plantId: 200, plantName: 'Meridian BESS', installedPowerMw: 8, companyId: 1, companyName: 'C1' },
    ]
    const groups = groupPlantsByGcp(standalone)
    const gcpGroup = [...groups.values()][0]
    expect(gcpGroup.gcpDisplayName.toLowerCase()).toContain('meridian')
  })

  test('two BESS units at same site create two component groups', () => {
    const multiUnit: PortalPlantEntry[] = [
      { plantId: 501, plantName: 'Konya BESS1 Gen', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
      { plantId: 502, plantName: 'Konya BESS1 Con', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
      { plantId: 503, plantName: 'Konya BESS2 Gen', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
      { plantId: 504, plantName: 'Konya BESS2 Con', installedPowerMw: 5, companyId: 1, companyName: 'C1' },
    ]
    const groups = groupPlantsByGcp(multiUnit)
    expect(groups.size).toBe(1)
    const gcpGroup = [...groups.values()][0]
    expect(gcpGroup.components.size).toBe(2)
  })
})
