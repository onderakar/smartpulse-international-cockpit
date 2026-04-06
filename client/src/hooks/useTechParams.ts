import { useState, useEffect } from 'react';
import { ftpApi } from '../api/ftp.api';
import { TechnicalParameters } from '@shared/types/techParams.types';
import { AssetMapping } from '@shared/types/assetMapping.types';

export function useTechParams(mapping: AssetMapping | null) {
  const [params, setParams] = useState<TechnicalParameters | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapping?.ftpFilename || !mapping?.ftpDirection) {
      setParams(null);
      return;
    }

    setLoading(true);
    ftpApi.readTechParams(mapping.ftpDirection, mapping.ftpFilename)
      .then(result => {
        setParams(result.parsed);
        setError(null);
      })
      .catch(err => {
        setError(err.response?.data?.message || err.message || 'Failed to load tech params');
        setParams(null);
      })
      .finally(() => setLoading(false));
  }, [mapping?.ftpFilename, mapping?.ftpDirection]);

  return { params, loading, error };
}
