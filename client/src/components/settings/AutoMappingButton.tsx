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

  const mappingState = useAutoMapping(() => {
    // completion handled in handleModalClose
  })

  const handleModalClose = () => {
    const hadReport = !!mappingState.report
    mappingState.reset()
    if (hadReport) {
      onMappingComplete()
    }
  }

  return (
    <>
      <button
        onClick={mappingState.startConfirmFlow}
        className="px-3 py-1.5 rounded border border-blue-500 text-blue-400 hover:bg-blue-500/10 text-sm font-medium transition-colors"
      >
        ⚡ {t('autoMapping.button')}
      </button>

      {mappingState.modalStage !== 'idle' && (
        <AutoMappingModal
          state={mappingState}
          onClose={handleModalClose}
        />
      )}
    </>
  )
}
