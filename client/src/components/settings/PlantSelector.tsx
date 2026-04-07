import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import { PortalPlant } from '@shared/types/auth.types';

interface PlantSelectorProps {
  selectedPlantId: number | null;
  onSelect: (plant: PortalPlant) => void;
  filterPlantIds?: number[];
  excludePlantIds?: number[];
  label?: string;
  onClear?: () => void;   // new: deselect/clear the current plant
}

export function PlantSelector({
  selectedPlantId, onSelect, filterPlantIds, excludePlantIds, label, onClear,
}: PlantSelectorProps) {
  const { plants } = useAuth();
  const { t } = useLocale();

  const resolvedLabel = label ?? t('assetMapping.portalPlant');

  let filtered = filterPlantIds
    ? plants.filter(p => filterPlantIds.includes(p.id))
    : plants;

  if (excludePlantIds?.length) {
    filtered = filtered.filter(p => !excludePlantIds.includes(p.id));
  }

  return (
    <div>
      {resolvedLabel && <label className="block text-sm text-gray-400 mb-1">{resolvedLabel}</label>}
      <select
        value={selectedPlantId ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            onClear?.();
            return;
          }
          const id = parseInt(e.target.value, 10);
          const plant = filtered.find(p => p.id === id);
          if (plant) onSelect(plant);
        }}
        className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <option value="" disabled={!onClear}>{onClear ? '— None —' : t('assetMapping.selectPlant')}</option>
        {filtered.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} (ID: {p.id})
          </option>
        ))}
      </select>
    </div>
  );
}
