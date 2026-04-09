import { useState, useEffect, useCallback } from 'react';
import { useLocale } from '../../context/LocaleContext';
import { fileApi, FileSourceDto } from '../../api/file.api';
import { FilePreviewModal } from './FilePreviewModal';
import toast from 'react-hot-toast';

export function FileSourcesManager() {
  const { t } = useLocale();
  const [sources, setSources] = useState<FileSourceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ key: string; rawContent: string; fileType: string; sizeBytes: number; filename: string } | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [readingKey, setReadingKey] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const data = await fileApi.listSources();
      setSources(data);
    } catch {
      // silent on initial load
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  const handleTest = async (source: FileSourceDto) => {
    setTestingKey(source.key);
    try {
      const result = await fileApi.test(source.key);
      setPreview({
        key: source.key,
        rawContent: result.rawContent,
        fileType: result.fileType,
        sizeBytes: result.sizeBytes,
        filename: source.filename,
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Test failed');
    } finally {
      setTestingKey(null);
    }
  };

  const handleReadNow = async (source: FileSourceDto) => {
    setReadingKey(source.key);
    try {
      const result = await fileApi.forceRead(source.key);
      if (result.created) {
        toast.success(`${source.displayName}: new version #${result.versionNo}`);
      } else {
        toast.success(`${source.displayName}: no change`);
      }
      await loadSources();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Read failed');
    } finally {
      setReadingKey(null);
    }
  };

  const handleDelete = async (source: FileSourceDto) => {
    if (!window.confirm(`Delete "${source.displayName}"?`)) return;
    try {
      await fileApi.deleteSource(source.id);
      toast.success('Deleted');
      await loadSources();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    }
  };

  const handleToggleEnabled = async (source: FileSourceDto) => {
    try {
      await fileApi.updateSource(source.id, { enabled: !source.enabled });
      await loadSources();
    } catch (err: any) {
      toast.error('Update failed');
    }
  };

  return (
    <div className="bg-[#1c1c28] border border-[#2a2a3e] rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          <i className="ri-file-list-3-line text-primary-400" />
          {t('fileIngestion.title')}
        </h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 bg-primary-900/20 border border-primary-800/40 rounded-md px-3 py-1.5 transition-colors"
        >
          <i className="ri-add-line text-sm" />
          {t('fileIngestion.addSource')}
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <AddSourceForm
          onSave={async () => { setShowAdd(false); await loadSources(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Source list */}
      {loading ? (
        <p className="text-gray-500 text-xs">{t('common.loading')}</p>
      ) : sources.length === 0 ? (
        <p className="text-gray-500 text-xs">{t('fileIngestion.noSources')}</p>
      ) : (
        <div className="space-y-3">
          {sources.map(source => (
            <SourceCard
              key={source.id}
              source={source}
              isEditing={editingId === source.id}
              isTesting={testingKey === source.key}
              isReading={readingKey === source.key}
              onTest={() => handleTest(source)}
              onReadNow={() => handleReadNow(source)}
              onEdit={() => setEditingId(editingId === source.id ? null : source.id)}
              onDelete={() => handleDelete(source)}
              onToggleEnabled={() => handleToggleEnabled(source)}
              onEditSave={async () => { setEditingId(null); await loadSources(); }}
            />
          ))}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <FilePreviewModal
          sourceKey={preview.key}
          rawContent={preview.rawContent}
          fileType={preview.fileType}
          sizeBytes={preview.sizeBytes}
          filename={preview.filename}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

// ── Source Card ──

interface SourceCardProps {
  source: FileSourceDto;
  isEditing: boolean;
  isTesting: boolean;
  isReading: boolean;
  onTest: () => void;
  onReadNow: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
  onEditSave: () => void;
}

function SourceCard({ source, isEditing, isTesting, isReading, onTest, onReadNow, onEdit, onDelete, onToggleEnabled, onEditSave }: SourceCardProps) {
  const { t } = useLocale();
  const currentVersion = source.versions?.[0];

  return (
    <div className={`bg-[#12121c] border rounded-lg p-4 ${source.enabled ? 'border-[#2a2a3e]' : 'border-[#2a2a3e]/50 opacity-60'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <i className={`ri-file-text-line text-lg ${source.enabled ? 'text-emerald-400' : 'text-gray-600'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{source.displayName}</span>
              <span className="text-[10px] text-gray-500 bg-[#1c1c28] px-1.5 py-0.5 rounded">{source.key}</span>
            </div>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[10px] text-gray-500">
                <i className="ri-folder-line mr-0.5" />
                {source.direction === 'incoming' ? 'Incoming' : 'Outgoing'} / {source.filename}
              </span>
              <span className="text-[10px] text-gray-600">
                <i className="ri-time-line mr-0.5" />
                {source.intervalMinutes} min
              </span>
              {currentVersion && (
                <span className="text-[10px] text-gray-600">
                  v#{currentVersion.versionNo} · {new Date(currentVersion.fetchedAt).toLocaleString()}
                </span>
              )}
              {source.lastError && (
                <span className="text-[10px] text-red-400" title={source.lastError}>
                  <i className="ri-error-warning-line mr-0.5" />
                  Error
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Enable/disable toggle */}
          <button
            onClick={onToggleEnabled}
            className={`w-8 h-4 rounded-full transition-colors relative ${source.enabled ? 'bg-emerald-600' : 'bg-gray-700'}`}
            title={source.enabled ? 'Disable' : 'Enable'}
          >
            <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${source.enabled ? 'translate-x-4' : ''}`} />
          </button>

          <button
            onClick={onTest}
            disabled={isTesting}
            className="text-[10px] text-gray-400 hover:text-white bg-[#1c1c28] border border-[#2a2a3e] rounded px-2 py-1 transition-colors disabled:opacity-40"
            title={t('fileIngestion.test')}
          >
            {isTesting ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-search-eye-line" />}
          </button>

          <button
            onClick={onReadNow}
            disabled={isReading}
            className="text-[10px] text-gray-400 hover:text-white bg-[#1c1c28] border border-[#2a2a3e] rounded px-2 py-1 transition-colors disabled:opacity-40"
            title={t('fileIngestion.readNow')}
          >
            {isReading ? <i className="ri-loader-4-line animate-spin" /> : <i className="ri-refresh-line" />}
          </button>

          <button
            onClick={onEdit}
            className="text-[10px] text-gray-400 hover:text-white bg-[#1c1c28] border border-[#2a2a3e] rounded px-2 py-1 transition-colors"
            title="Edit"
          >
            <i className="ri-edit-line" />
          </button>

          <button
            onClick={onDelete}
            className="text-[10px] text-gray-400 hover:text-red-400 bg-[#1c1c28] border border-[#2a2a3e] rounded px-2 py-1 transition-colors"
            title="Delete"
          >
            <i className="ri-delete-bin-line" />
          </button>
        </div>
      </div>

      {/* Inline edit form */}
      {isEditing && (
        <EditSourceForm source={source} onSave={onEditSave} onCancel={onEdit} />
      )}
    </div>
  );
}

// ── Add Source Form ──

function AddSourceForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const { t } = useLocale();
  const [key, setKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [filename, setFilename] = useState('');
  const [direction, setDirection] = useState('incoming');
  const [intervalMinutes, setIntervalMinutes] = useState(10);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!key.trim() || !filename.trim()) {
      toast.error('Key and filename are required');
      return;
    }
    setSaving(true);
    try {
      await fileApi.createSource({ key: key.trim(), displayName: displayName.trim() || key.trim(), filename: filename.trim(), direction, intervalMinutes, enabled: true });
      toast.success('Source created');
      onSave();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#12121c] border border-[#2a2a3e] rounded-lg p-4 mb-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Key (slug)</label>
          <input value={key} onChange={e => setKey(e.target.value)} placeholder="dam-gen" className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Display Name</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="DAM Generation" className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{t('fileIngestion.direction')}</label>
          <select value={direction} onChange={e => setDirection(e.target.value)} className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5">
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Filename</label>
          <input value={filename} onChange={e => setFilename(e.target.value)} placeholder="DAM_GEN.csv" className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{t('fileIngestion.interval')}</label>
          <input type="number" min={1} value={intervalMinutes} onChange={e => setIntervalMinutes(Number(e.target.value))} className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded transition-colors">{t('common.cancel')}</button>
        <button onClick={handleSubmit} disabled={saving} className="text-xs text-white bg-primary-600 hover:bg-primary-700 rounded px-4 py-1.5 transition-colors disabled:opacity-40">
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ── Edit Source Form ──

function EditSourceForm({ source, onSave, onCancel }: { source: FileSourceDto; onSave: () => void; onCancel: () => void }) {
  const { t } = useLocale();
  const [displayName, setDisplayName] = useState(source.displayName);
  const [filename, setFilename] = useState(source.filename);
  const [direction, setDirection] = useState(source.direction);
  const [intervalMinutes, setIntervalMinutes] = useState(source.intervalMinutes);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await fileApi.updateSource(source.id, { displayName, filename, direction, intervalMinutes });
      toast.success('Updated');
      onSave();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-[#2a2a3e]">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Display Name</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Filename</label>
          <input value={filename} onChange={e => setFilename(e.target.value)} className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{t('fileIngestion.direction')}</label>
          <select value={direction} onChange={e => setDirection(e.target.value)} className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5">
            <option value="incoming">Incoming</option>
            <option value="outgoing">Outgoing</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">{t('fileIngestion.interval')}</label>
          <input type="number" min={1} value={intervalMinutes} onChange={e => setIntervalMinutes(Number(e.target.value))} className="w-full bg-[#1c1c28] border border-[#2a2a3e] text-white text-xs rounded px-2.5 py-1.5" />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded transition-colors">{t('common.cancel')}</button>
        <button onClick={handleSubmit} disabled={saving} className="text-xs text-white bg-primary-600 hover:bg-primary-700 rounded px-4 py-1.5 transition-colors disabled:opacity-40">
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  );
}
