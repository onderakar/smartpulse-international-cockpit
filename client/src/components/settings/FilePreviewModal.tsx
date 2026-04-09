import { useState } from 'react';
import { useLocale } from '../../context/LocaleContext';
import { fileApi } from '../../api/file.api';
import toast from 'react-hot-toast';

interface Props {
  sourceKey: string;
  rawContent: string;
  fileType: string;
  sizeBytes: number;
  filename: string;
  onClose: () => void;
}

export function FilePreviewModal({ sourceKey, rawContent, fileType, sizeBytes, filename, onClose }: Props) {
  const { t } = useLocale();
  const [saving, setSaving] = useState(false);

  const handleSaveBack = async () => {
    setSaving(true);
    try {
      await fileApi.saveBack(sourceKey, rawContent);
      toast.success(t('fileIngestion.savedBack'));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-[#1c1c28] border border-[#2a2a3e] rounded-xl w-full max-w-4xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#2a2a3e]">
          <div className="flex items-center gap-3">
            <i className="ri-file-text-line text-primary-400" />
            <span className="text-sm font-medium text-white">{filename}</span>
            <span className="text-[10px] text-gray-500 bg-[#12121c] px-2 py-0.5 rounded">{fileType.toUpperCase()}</span>
            <span className="text-[10px] text-gray-600">{formatSize(sizeBytes)}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {fileType === 'csv' ? (
            <CsvTableViewer content={rawContent} />
          ) : fileType === 'json' ? (
            <JsonViewer content={rawContent} />
          ) : fileType === 'xml' ? (
            <XmlViewer content={rawContent} />
          ) : (
            <RawTextViewer content={rawContent} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#2a2a3e]">
          <button
            onClick={handleSaveBack}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className="ri-upload-2-line text-sm" />
            {saving ? 'Saving...' : t('fileIngestion.saveBack')}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-white bg-[#12121c] border border-[#2a2a3e] rounded-md px-4 py-1.5 transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-viewers ──

function CsvTableViewer({ content }: { content: string }) {
  const rows = content.split('\n').filter(l => l.trim()).map(line => {
    // Handle both comma and semicolon separators
    return line.split(/[,;]/).map(cell => cell.trim());
  });

  if (rows.length === 0) return <p className="text-gray-500 text-xs">Empty</p>;

  const header = rows[0];
  const body = rows.slice(1);

  return (
    <div className="overflow-auto rounded border border-[#2a2a3e]">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th key={i} className="bg-[#191930] text-left px-3 py-1.5 text-gray-400 font-semibold border-b border-r border-[#2a2a3e] whitespace-nowrap">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} className="hover:bg-[#1e1e42]">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1 text-gray-300 border-b border-r border-[#2a2a3e] whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JsonViewer({ content }: { content: string }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }
  return (
    <pre className="text-[11px] text-green-300/80 bg-[#12121c] rounded p-4 overflow-auto font-mono leading-relaxed">
      {formatted}
    </pre>
  );
}

function XmlViewer({ content }: { content: string }) {
  return (
    <pre className="text-[11px] text-blue-300/80 bg-[#12121c] rounded p-4 overflow-auto font-mono leading-relaxed">
      {content}
    </pre>
  );
}

function RawTextViewer({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <pre className="text-[11px] text-gray-300 bg-[#12121c] rounded p-4 overflow-auto font-mono leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className="flex">
          <span className="text-gray-600 select-none w-10 text-right mr-3 shrink-0">{i + 1}</span>
          <span>{line}</span>
        </div>
      ))}
    </pre>
  );
}
