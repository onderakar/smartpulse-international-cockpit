import { useLocale } from '../../context/LocaleContext';

interface BatteryParamsEditorProps {
  /** All raw key-value pairs from the CSV for this plant */
  rawParams: Record<string, string | number | boolean>;
  /** Ordered list of variable names (row order from CSV) */
  variableOrder: string[];
  onChange: (variableKey: string, value: string | number) => void;
}

function formatValue(val: string | number | boolean): string {
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (typeof val === 'number') return String(val);
  return String(val);
}

export function BatteryParamsEditor({ rawParams, variableOrder, onChange }: BatteryParamsEditorProps) {
  const { t } = useLocale();
  return (
    <div className="overflow-hidden rounded-lg border border-gray-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-dark-700 text-gray-400 text-xs">
            <th className="text-left px-4 py-2 font-medium">{t('batteryParams.parameter')}</th>
            <th className="text-right px-4 py-2 font-medium w-48">{t('batteryParams.value')}</th>
          </tr>
        </thead>
        <tbody>
          {variableOrder.map((key, idx) => {
            const val = rawParams[key];
            const displayVal = val !== undefined ? formatValue(val) : '';
            const isNumeric = typeof val === 'number' || (typeof val === 'string' && val !== '' && !isNaN(Number(val)));

            return (
              <tr
                key={key}
                className={`border-t border-gray-700/50 ${
                  idx % 2 === 0 ? 'bg-dark-800' : 'bg-dark-800/50'
                }`}
              >
                <td className="px-4 py-2 text-gray-300 font-mono text-xs">{key}</td>
                <td className="px-4 py-2">
                  <input
                    type={isNumeric ? 'number' : 'text'}
                    step="any"
                    lang="en"
                    value={displayVal}
                    onChange={e => {
                      const raw = e.target.value;
                      if (isNumeric) {
                        const num = parseFloat(raw);
                        if (!isNaN(num)) onChange(key, num);
                        else if (raw === '' || raw === '-') onChange(key, raw);
                      } else {
                        onChange(key, raw);
                      }
                    }}
                    className="w-full bg-dark-700 border border-gray-600 rounded px-3 py-1 text-white text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
