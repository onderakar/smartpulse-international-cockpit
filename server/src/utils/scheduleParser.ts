import { ScheduleRow, ParsedSchedule, SCHEDULE_CSV_COLUMNS } from '@smartpulse-intl/shared';

const STRING_FIELDS = new Set<string>([
  'Delivery_Start',
  'Delivery_End',
  'Schedule_ID',
  'Operation_Mode',
]);

/**
 * Parse a Battery_Schedule CSV into structured rows.
 * CSV has standard tabular format: header row + data rows (15-min slots).
 */
export function parseScheduleCsv(csvContent: string): ParsedSchedule {
  const lines = csvContent
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.length > 0);

  if (lines.length < 2) {
    return { header: [], rows: [] };
  }

  const header = lines[0].split(',').map(h => h.trim());
  const rows: ScheduleRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim());
    if (parts.length < 2) continue;

    const row: Record<string, string | number> = {};

    for (let col = 0; col < header.length; col++) {
      const key = header[col];
      const rawVal = parts[col] ?? '';

      if (STRING_FIELDS.has(key)) {
        row[key] = rawVal;
      } else {
        const num = parseFloat(rawVal);
        row[key] = isNaN(num) ? rawVal : num;
      }
    }

    rows.push(row as unknown as ScheduleRow);
  }

  return { header, rows };
}

/**
 * Serialize schedule rows back to CSV. Preserves the original header order.
 */
export function serializeScheduleCsv(header: string[], rows: ScheduleRow[]): string {
  const csvLines = [header.join(',')];

  for (const row of rows) {
    const values = header.map(col => {
      const val = (row as Record<string, string | number>)[col];
      if (val === undefined || val === null) return '';
      return String(val);
    });
    csvLines.push(values.join(','));
  }

  return csvLines.join('\r\n');
}

/**
 * djb2 hash of critical fields for a single row.
 */
export function computeRowHash(row: ScheduleRow): string {
  const critical = [
    row.Battery_Active_Power_MW,
    row.Max_Generation_MW,
    row.Max_Charge_MW,
    row.Max_Discharge_MW,
    row.Schedule_ID,
    row.Operation_Mode,
  ];
  const str = critical.map(v => String(v ?? '')).join('|');
  return djb2(str);
}

/**
 * Quick hash over entire CSV content for fast change detection.
 */
export function computeCsvHash(csvContent: string): string {
  return djb2(csvContent);
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}
