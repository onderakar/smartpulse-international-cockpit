import { useState } from 'react'
import { useLocale } from '../../context/LocaleContext'
import { CompanyMapping } from '@shared/types/assetMapping.types'
import { useAutoMapping } from '../../hooks/useAutoMapping'
import { AutoMappingModal } from './AutoMappingModal'

interface Props {
  companies: CompanyMapping[]
  onMappingComplete: () => void
}

export function AutoMappingButton({ companies, onMappingComplete }: Props) {
  const { t } = useLocale()
  const [showConfirm, setShowConfirm] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const mappingState = useAutoMapping(() => {
    // completion handled in handleModalClose
  })

  const totalGcps = companies.reduce((n, c) => n + c.gridConnectionPoints.length, 0)
  const totalComponents = companies.reduce(
    (n, c) => n + c.gridConnectionPoints.reduce((m, g) => m + g.components.length, 0),
    0,
  )
  const hasExisting = companies.length > 0

  const handleButtonClick = () => {
    if (hasExisting) {
      setShowConfirm(true)
    } else {
      startMapping()
    }
  }

  const startMapping = () => {
    setShowConfirm(false)
    setShowModal(true)
    mappingState.run()
  }

  const handleModalClose = () => {
    setShowModal(false)
    mappingState.reset()
    if (mappingState.report) {
      onMappingComplete()
    }
  }

  return (
    <>
      <button
        onClick={handleButtonClick}
        className="px-3 py-1.5 rounded border border-blue-500 text-blue-400 hover:bg-blue-500/10 text-sm font-medium transition-colors"
      >
        ⚡ {t('autoMapping.button')}
      </button>

      {/* Confirm Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 w-96 shadow-2xl">
            <div className="text-sm font-semibold text-slate-100 mb-2">
              ⚠ {t('autoMapping.confirmTitle')}
            </div>
            <div className="text-xs text-slate-400 mb-4 leading-relaxed">
              {t('autoMapping.confirmBody')
                .replace('{gcpCount}', String(totalGcps))
                .replace('{componentCount}', String(totalComponents))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1.5 rounded border border-slate-600 text-slate-400 hover:bg-slate-700 text-xs"
              >
                {t('autoMapping.cancel')}
              </button>
              <button
                onClick={startMapping}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
              >
                {t('autoMapping.confirmProceed')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Modal */}
      {showModal && (
        <AutoMappingModal
          state={mappingState}
          onClose={handleModalClose}
        />
      )}
    </>
  )
}
