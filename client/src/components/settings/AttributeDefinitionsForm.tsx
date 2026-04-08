import { useState } from 'react';
import { useProfile } from '../../context/ProfileContext';
import { useLocale } from '../../context/LocaleContext';
import { AttributeDefinition, EntityScope } from '@shared/types/attributes.types';
import { ComponentType } from '@shared/types/assetMapping.types';
import { ATTRIBUTE_DEFINITIONS } from '@shared/constants/attributeDefinitions';

const ENTITY_SCOPES: EntityScope[] = ['GCP', 'COMPONENT', 'SUBCOMPONENT'];
const COMPONENT_TYPES: ComponentType[] = ['BESS', 'SOLAR', 'WIND', 'HYDRO', 'THERMAL', 'LOAD', 'CONSUMPTION', 'OTHER'];
const DATA_TYPES = ['number', 'string', 'boolean', 'enum', 'date'] as const;
const GROUPS = ['electrical', 'capacity', 'identification', 'mechanical', 'admin'] as const;

function newEmptyDef(): AttributeDefinition {
  return {
    key: '',
    labelKey: '',
    dataType: 'number',
    unit: '',
    entityScopes: ['COMPONENT'],
    required: false,
    group: 'electrical',
    source: 'admin',
  };
}

export function AttributeDefinitionsForm() {
  const { profile, updateProfile } = useProfile();
  const { t } = useLocale();

  const systemDefs = [...ATTRIBUTE_DEFINITIONS] as AttributeDefinition[];
  const [customDefs, setCustomDefs] = useState<AttributeDefinition[]>(
    profile?.customAttributeDefinitions ?? []
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDef, setNewDef] = useState<AttributeDefinition>(newEmptyDef());
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = () => {
    updateProfile({ customAttributeDefinitions: customDefs.length > 0 ? customDefs : undefined });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const handleAddDef = () => {
    if (!newDef.key.trim()) return;
    // Auto-generate labelKey if empty
    const def: AttributeDefinition = {
      ...newDef,
      key: newDef.key.trim().toLowerCase().replace(/\s+/g, '_'),
      labelKey: newDef.labelKey || `attr.${newDef.key.trim().toLowerCase().replace(/\s+/g, '_')}`,
      source: 'admin',
    };
    setCustomDefs([...customDefs, def]);
    setNewDef(newEmptyDef());
    setShowAddForm(false);
  };

  const handleRemoveCustom = (key: string) => {
    setCustomDefs(customDefs.filter(d => d.key !== key));
  };

  const handleUpdateCustom = (key: string, patch: Partial<AttributeDefinition>) => {
    setCustomDefs(customDefs.map(d => d.key === key ? { ...d, ...patch } : d));
  };

  const allDefs = [...systemDefs, ...customDefs];
  const usedKeys = new Set(allDefs.map(d => d.key));

  return (
    <section className="bg-dark-800 border border-gray-700 rounded-lg p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-medium text-white">{t('settings.attributeDefinitions')}</h3>
        <div className="flex items-center gap-2">
          {isSaved && <span className="text-xs text-green-400">Saved!</span>}
          <button
            onClick={handleSave}
            className="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-4">{t('settings.attributeDefinitionsDesc')}</p>

      {/* Table header */}
      <div className="grid grid-cols-[1fr_1fr_80px_60px_100px_120px_90px_1fr_40px] gap-2 mb-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold px-2">
        <span>{t('settings.attrKey')}</span>
        <span>{t('settings.attrLabel')}</span>
        <span>{t('settings.attrDataType')}</span>
        <span>{t('settings.attrUnit')}</span>
        <span>{t('settings.attrScopes')}</span>
        <span>{t('settings.attrCompTypes')}</span>
        <span>{t('settings.attrGroup')}</span>
        <span>{t('settings.attrCsvAliases')}</span>
        <span></span>
      </div>

      {/* System definitions (read-only) */}
      {systemDefs.map(def => (
        <div key={def.key} className="grid grid-cols-[1fr_1fr_80px_60px_100px_120px_90px_1fr_40px] gap-2 items-center px-2 py-1.5 bg-dark-900 rounded mb-1 opacity-70">
          <span className="text-xs text-gray-300 truncate" title={def.key}>{def.key}</span>
          <span className="text-xs text-gray-400 truncate">{t(def.labelKey as any)}</span>
          <span className="text-[10px] text-gray-500">{def.dataType}</span>
          <span className="text-[10px] text-gray-500">{def.unit || '—'}</span>
          <span className="text-[10px] text-gray-500">{def.entityScopes.join(', ')}</span>
          <span className="text-[10px] text-gray-500 truncate">{def.componentTypes?.join(', ') || 'All'}</span>
          <span className="text-[10px] text-gray-500">{def.group}</span>
          <span className="text-[10px] text-gray-500 truncate">{def.csvColumnAliases?.join(', ') || '—'}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400 text-center">{t('settings.systemAttribute')}</span>
        </div>
      ))}

      {/* Custom definitions (editable) */}
      {customDefs.map(def => (
        <div key={def.key} className="grid grid-cols-[1fr_1fr_80px_60px_100px_120px_90px_1fr_40px] gap-2 items-center px-2 py-1.5 bg-dark-700 rounded mb-1 border border-gray-600">
          <span className="text-xs text-white truncate" title={def.key}>{def.key}</span>
          <input
            value={def.labelKey}
            onChange={(e) => handleUpdateCustom(def.key, { labelKey: e.target.value })}
            className="bg-dark-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-full"
            placeholder="Label key"
          />
          <select
            value={def.dataType}
            onChange={(e) => handleUpdateCustom(def.key, { dataType: e.target.value as any })}
            className="bg-dark-900 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-white"
          >
            {DATA_TYPES.map(dt => <option key={dt} value={dt}>{dt}</option>)}
          </select>
          <input
            value={def.unit || ''}
            onChange={(e) => handleUpdateCustom(def.key, { unit: e.target.value || undefined })}
            className="bg-dark-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-full"
            placeholder="MW"
          />
          <ScopeMultiSelect
            value={def.entityScopes}
            onChange={(scopes) => handleUpdateCustom(def.key, { entityScopes: scopes })}
          />
          <CompTypeMultiSelect
            value={def.componentTypes}
            onChange={(types) => handleUpdateCustom(def.key, { componentTypes: types?.length ? types : undefined })}
          />
          <select
            value={def.group}
            onChange={(e) => handleUpdateCustom(def.key, { group: e.target.value })}
            className="bg-dark-900 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-white"
          >
            {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <input
            value={def.csvColumnAliases?.join(', ') || ''}
            onChange={(e) => handleUpdateCustom(def.key, {
              csvColumnAliases: e.target.value ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : undefined
            })}
            className="bg-dark-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-full"
            placeholder="col1, col2"
          />
          <button
            onClick={() => handleRemoveCustom(def.key)}
            className="text-gray-500 hover:text-red-400 text-sm text-center"
            title="Remove"
          >&#x2715;</button>
        </div>
      ))}

      {/* Add new attribute form */}
      {showAddForm ? (
        <div className="grid grid-cols-[1fr_1fr_80px_60px_100px_120px_90px_1fr_40px] gap-2 items-center px-2 py-1.5 bg-dark-600 rounded mb-1 border border-primary-600">
          <input
            value={newDef.key}
            onChange={(e) => setNewDef({ ...newDef, key: e.target.value })}
            className="bg-dark-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-full"
            placeholder="my_attr_key"
            autoFocus
          />
          <input
            value={newDef.labelKey}
            onChange={(e) => setNewDef({ ...newDef, labelKey: e.target.value })}
            className="bg-dark-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-full"
            placeholder="Display Label"
          />
          <select
            value={newDef.dataType}
            onChange={(e) => setNewDef({ ...newDef, dataType: e.target.value as any })}
            className="bg-dark-900 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-white"
          >
            {DATA_TYPES.map(dt => <option key={dt} value={dt}>{dt}</option>)}
          </select>
          <input
            value={newDef.unit || ''}
            onChange={(e) => setNewDef({ ...newDef, unit: e.target.value || undefined })}
            className="bg-dark-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-full"
            placeholder="MW"
          />
          <ScopeMultiSelect
            value={newDef.entityScopes}
            onChange={(scopes) => setNewDef({ ...newDef, entityScopes: scopes })}
          />
          <CompTypeMultiSelect
            value={newDef.componentTypes}
            onChange={(types) => setNewDef({ ...newDef, componentTypes: types?.length ? types : undefined })}
          />
          <select
            value={newDef.group}
            onChange={(e) => setNewDef({ ...newDef, group: e.target.value })}
            className="bg-dark-900 border border-gray-600 rounded px-1 py-0.5 text-[10px] text-white"
          >
            {GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <input
            value={newDef.csvColumnAliases?.join(', ') || ''}
            onChange={(e) => setNewDef({ ...newDef, csvColumnAliases: e.target.value ? e.target.value.split(',').map(s => s.trim()).filter(Boolean) : undefined })}
            className="bg-dark-900 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white w-full"
            placeholder="csv_col"
          />
          <div className="flex gap-1">
            <button
              onClick={handleAddDef}
              disabled={!newDef.key.trim() || usedKeys.has(newDef.key.trim().toLowerCase().replace(/\s+/g, '_'))}
              className="text-green-400 hover:text-green-300 text-sm disabled:opacity-30"
              title="Add"
            >&#x2713;</button>
            <button
              onClick={() => { setShowAddForm(false); setNewDef(newEmptyDef()); }}
              className="text-gray-500 hover:text-red-400 text-sm"
              title="Cancel"
            >&#x2715;</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="mt-2 bg-dark-700 hover:bg-dark-600 text-primary-400 text-xs font-medium px-4 py-2 rounded-lg border border-gray-600 transition-colors"
        >
          + {t('settings.addAttribute')}
        </button>
      )}
    </section>
  );
}

/** Multi-select checkboxes for entity scopes */
function ScopeMultiSelect({ value, onChange }: { value: EntityScope[]; onChange: (v: EntityScope[]) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {ENTITY_SCOPES.map(scope => (
        <label key={scope} className="flex items-center gap-0.5 text-[10px] text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={value.includes(scope)}
            onChange={(e) => {
              if (e.target.checked) onChange([...value, scope]);
              else onChange(value.filter(s => s !== scope));
            }}
            className="w-3 h-3"
          />
          {scope === 'COMPONENT' ? 'COMP' : scope === 'SUBCOMPONENT' ? 'SUB' : scope}
        </label>
      ))}
    </div>
  );
}

/** Multi-select checkboxes for component types (optional) */
function CompTypeMultiSelect({ value, onChange }: { value?: ComponentType[]; onChange: (v: ComponentType[]) => void }) {
  const selected = value ?? [];
  return (
    <div className="flex gap-1 flex-wrap">
      {COMPONENT_TYPES.slice(0, 4).map(ct => (
        <label key={ct} className="flex items-center gap-0.5 text-[10px] text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(ct)}
            onChange={(e) => {
              if (e.target.checked) onChange([...selected, ct]);
              else onChange(selected.filter(s => s !== ct));
            }}
            className="w-3 h-3"
          />
          {ct}
        </label>
      ))}
    </div>
  );
}
