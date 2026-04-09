/**
 * Parser for DAM_GEN.csv files.
 *
 * Expected CSV format:
 *   Delivery_Start,PORTFOLIO_ID,DAM_Trade_Volume(MW),Generation Forecast(MW)
 *   2026-04-09T05:15:00.000Z,B00214-10,0.000,0.000
 */

export interface DamGenRow {
  deliveryStart: string;
  portfolioId: string;
  damTradeVolume: number;
  generationForecast: number;
}

export interface DamGenParsed {
  rows: DamGenRow[];
  distinctPortfolios: string[];
}

export function parseDamGenCsv(rawContent: string): DamGenParsed {
  const lines = rawContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return { rows: [], distinctPortfolios: [] };

  const rows: DamGenRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 4) continue;

    rows.push({
      deliveryStart: parts[0],
      portfolioId: parts[1],
      damTradeVolume: parseFloat(parts[2]) || 0,
      generationForecast: parseFloat(parts[3]) || 0,
    });
  }

  const distinctPortfolios = [...new Set(rows.map(r => r.portfolioId).filter(Boolean))].sort();

  return { rows, distinctPortfolios };
}
