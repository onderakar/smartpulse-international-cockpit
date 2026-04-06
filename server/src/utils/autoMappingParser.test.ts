import { describe, it, expect } from 'vitest'
import { parseAutoMappingCsv } from './autoMappingParser'

const MINIMAL_CSV = `#,Variable,BatteryA,BatteryB
1,Asset_ID,1943,1944
2,PV_Asset_ID,3022,-
3,Masternode,SP01010860,SP01010829
4,Total_Grid_Capacity_Generation_MW,50,100
5,Total_Grid_Capacity_Consumption_MW,50,100
6,Porfolio_ID_DAM_GEN,PORTF_1,PORTF_2
7,Max_Battery_Discharge_Power_MW,50,100
8,Max_Battery_Charge_Power_MW,50,100
9,Battery_Capacity_MWh,100,200
10,Charge_Efficiency_Percentage,95,95
11,Discharge_Efficiency_Percentage,95,95
12,Min_SOC_Percentage,10,10
13,Max_SOC_Percentage,90,90
14,PV_Capacity_MW_ac,30,-
15,PV_Capacity_MWp,35,-`

describe('parseAutoMappingCsv', () => {
  it('returns one BatteryColumn per battery column', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries).toHaveLength(2)
    expect(result.batteries[0].name).toBe('BatteryA')
    expect(result.batteries[1].name).toBe('BatteryB')
  })

  it('parses Asset_ID as number', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].assetId).toBe(1943)
    expect(result.batteries[1].assetId).toBe(1944)
  })

  it('parses PV_Asset_ID; returns null for dash', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].pvAssetId).toBe(3022)
    expect(result.batteries[1].pvAssetId).toBeNull()
  })

  it('parses Masternode', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].masternode).toBe('SP01010860')
  })

  it('parses GCP attributes', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].maxInjectionMw).toBe(50)
    expect(result.batteries[0].maxConsumptionMw).toBe(50)
    expect(result.batteries[0].damPortfolioId).toBe('PORTF_1')
  })

  it('handles typo Porfolio_ID_DAM_GEN as alias for Portfolio_ID_DAM_GEN', () => {
    // The minimal CSV already uses the typo variant — verified above
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].damPortfolioId).toBe('PORTF_1')
  })

  it('parses bessParams', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].bessParams.maxDischargePowerMw).toBe(50)
    expect(result.batteries[0].bessParams.capacityMwh).toBe(100)
    expect(result.batteries[0].bessParams.chargeEfficiency).toBe(95)
  })

  it('parses PV capacity fields; returns null when dash', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.batteries[0].pvCapacityAcMw).toBe(30)
    expect(result.batteries[0].pvCapacityDcMwp).toBe(35)
    expect(result.batteries[1].pvCapacityAcMw).toBeNull()
    expect(result.batteries[1].pvCapacityDcMwp).toBeNull()
  })

  it('is case-insensitive on row keys', () => {
    const csv = `#,Variable,BatteryA\n1,asset_id,1943`
    const result = parseAutoMappingCsv(csv)
    expect(result.batteries[0].assetId).toBe(1943)
  })

  it('trims whitespace in values', () => {
    const csv = `#,Variable,BatteryA\n1,Asset_ID, 1943 `
    const result = parseAutoMappingCsv(csv)
    expect(result.batteries[0].assetId).toBe(1943)
  })

  it('returns null for empty Asset_ID and emits missing_asset_id warning', () => {
    const csv = `#,Variable,BatteryA\n1,Asset_ID,`
    const result = parseAutoMappingCsv(csv)
    expect(result.batteries[0].assetId).toBeNull()
    expect(result.warnings.some(w => w.type === 'missing_asset_id')).toBe(true)
  })

  it('returns no warnings for a well-formed CSV', () => {
    const result = parseAutoMappingCsv(MINIMAL_CSV)
    expect(result.warnings).toHaveLength(0)
  })
})
