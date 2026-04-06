import { useState } from 'react';
import { ftpApi } from '../../api/ftp.api';
import { useProfile } from '../../context/ProfileContext';
import { useLocale } from '../../context/LocaleContext';
import { TechnicalParameters } from '@shared/types/techParams.types';

export function TechParamsConfig() {
  const { profile, updateProfile } = useProfile();
  const { t } = useLocale();

  const [direction, setDirection] = useState<'incoming' | 'outgoing'>(
    profile?.assetMapping?.ftpDirection ?? 'incoming'
  );
  const [filename, setFilename] = useState(
    profile?.assetMapping?.ftpFilename ?? 'Technical_Parameters.csv'
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [preview, setPreview] = useState<TechnicalParameters | null>(null);
  const [rawPreview, setRawPreview] = useState('');

  const handleTestRead = async () => {
    setStatus('loading');
    setErrorMsg('');
    setPreview(null);
    setRawPreview('');

    try {
      const result = await ftpApi.readTechParams(direction, filename);
      setPreview(result.parsed);
      setRawPreview(result.raw.substring(0, 1000)); // first 1000 chars
      setStatus('success');

      // Update profile with FTP config
      if (profile?.assetMapping) {
        updateProfile({
          assetMapping: {
            ...profile.assetMapping,
            ftpDirection: direction,
            ftpFilename: filename,
          },
        });
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.response?.data?.message || err.message || 'Failed to read file');
    }
  };

  return (
    <section className="bg-dark-800 border border-gray-700 rounded-lg p-6">
      <h3 className="text-lg font-medium text-white mb-4">{t('techParams.title')}</h3>
      <p className="text-xs text-gray-500 mb-4">
        {t('techParams.description')}
      </p>

      <div className="space-y-4">
        {/* Direction */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">{t('techParams.direction')}</label>
          <div className="flex gap-4">
            {(['incoming', 'outgoing'] as const).map(dir => (
              <label key={dir} className="flex items-center gap-2 text-sm text-gray-300">
                <input
                  type="radio"
                  name="ftp-direction"
                  value={dir}
                  checked={direction === dir}
                  onChange={() => setDirection(dir)}
                  className="text-primary-500"
                />
                {dir === 'incoming' ? t('assetMapping.incoming') : t('assetMapping.outgoing')}
              </label>
            ))}
          </div>
        </div>

        {/* Filename */}
        <div>
          <label className="block text-sm text-gray-400 mb-1">{t('techParams.filename')}</label>
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="w-full bg-dark-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Technical_Parameters.csv"
          />
        </div>

        {/* Test Read button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTestRead}
            disabled={!filename || status === 'loading'}
            className="bg-primary-600 hover:bg-primary-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {status === 'loading' ? t('techParams.reading') : t('techParams.testRead')}
          </button>

          {status === 'success' && (
            <span className="text-green-400 text-sm">{t('techParams.readSuccess')}</span>
          )}
          {status === 'error' && (
            <span className="text-red-400 text-sm">{errorMsg}</span>
          )}
        </div>

        {/* Preview: Battery Core Parameters */}
        {preview && (
          <div className="border-t border-gray-700 pt-4 mt-4">
            <h4 className="text-sm font-medium text-gray-300 mb-3">{t('techParams.parsedParams')}</h4>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(preview.battery).map(([key, value]) => (
                <div key={key} className="flex justify-between bg-dark-700 px-3 py-1.5 rounded text-xs">
                  <span className="text-gray-400">{key}</span>
                  <span className="text-white font-mono">{String(value)}</span>
                </div>
              ))}
            </div>

            {/* Raw preview */}
            <details className="mt-3">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                {t('techParams.showRaw')}
              </summary>
              <pre className="mt-2 bg-dark-900 p-3 rounded text-xs text-gray-400 overflow-x-auto max-h-40 overflow-y-auto">
                {rawPreview}
              </pre>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
