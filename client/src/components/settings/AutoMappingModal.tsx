import { useEffect, useRef } from 'react'
import { useLocale } from '../../context/LocaleContext'
import { TranslationKey } from '@shared/constants/translations'
import { AutoMappingState, StepStatus } from '../../hooks/useAutoMapping'

interface Props {
  state: AutoMappingState
  onClose: () => void
}

const STATUS_ICON: Record<StepStatus, string> = {
  pending: '○',
  active:  '⟳',
  done:    '✓',
  error:   '✗',
}

const STATUS_COLOR: Record<StepStatus, string> = {
  pending: 'text-slate-500',
  active:  'text-blue-400 animate-spin',
  done:    'text-green-400',
  error:   'text-red-400',
}

export function AutoMappingModal({ state, onClose }: Props) {
  const { t } = useLocale()
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [state.logLines])

  const doneSteps = state.steps.filter(s => s.status === 'done').length
  const progress = Math.round((doneSteps / state.steps.length) * 100)

  const overallStatus = state.report?.overallStatus
  const headerBadge = overallStatus
    ? overallStatus === 'success'
      ? { label: t('autoMapping.statusSuccess'), cls: 'bg-green-900 text-green-300' }
      : overallStatus === 'partial'
        ? { label: t('autoMapping.statusPartial'), cls: 'bg-yellow-900 text-yellow-300' }
        : { label: t('autoMapping.statusFailed'), cls: 'bg-red-900 text-red-300' }
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-slate-800 px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm text-slate-100">
            {state.isComplete ? t('autoMapping.done') : t('autoMapping.modalTitle')}
          </span>
          {headerBadge && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${headerBadge.cls}`}>
              {headerBadge.label}
            </span>
          )}
        </div>

        <div className="p-4 space-y-4">

          {/* Step list */}
          <div className="space-y-1.5">
            {state.steps.map(step => (
              <div key={step.key} className="flex items-center gap-2.5">
                <span className={`text-sm w-4 text-center ${STATUS_COLOR[step.status]}`}>
                  {STATUS_ICON[step.status]}
                </span>
                <span className={`text-xs ${step.status === 'done' ? 'text-slate-400 line-through' : step.status === 'active' ? 'text-slate-100 font-medium' : 'text-slate-600'}`}>
                  {t(step.i18nKey as TranslationKey)}
                </span>
                {step.badge && (
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-green-900/60 text-green-300">
                    {step.badge}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div className="bg-slate-700 rounded h-1.5">
            <div
              className={`h-1.5 rounded transition-all duration-300 ${overallStatus === 'failed' ? 'bg-red-500' : overallStatus === 'partial' ? 'bg-yellow-400' : 'bg-blue-500'}`}
              style={{ width: `${state.isComplete ? 100 : progress}%` }}
            />
          </div>

          {/* Summary cards — shown after completion */}
          {state.isComplete && state.report && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'GCP', value: state.report.gcpsCreated, cls: 'text-green-400' },
                { label: 'BESS', value: state.report.bessCreated, cls: 'text-green-400' },
                { label: 'SOLAR', value: state.report.solarCreated, cls: 'text-green-400' },
                { label: t('autoMapping.warnings'), value: state.report.warnings.length, cls: state.report.warnings.length > 0 ? 'text-yellow-400' : 'text-green-400' },
              ].map(card => (
                <div key={card.label} className="bg-slate-800 border border-slate-600 rounded p-2 text-center">
                  <div className={`text-lg font-bold ${card.cls}`}>{card.value}</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">{card.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Log area */}
          <div
            ref={logRef}
            className="bg-slate-950 border border-slate-800 rounded p-2.5 h-28 overflow-y-auto font-mono text-[10px] space-y-0.5"
          >
            {state.logLines.map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('[OK]') ? 'text-green-400' :
                  line.startsWith('[WARN]') ? 'text-yellow-400' :
                  line.startsWith('[ERROR]') ? 'text-red-400' :
                  'text-slate-500'
                }
              >
                {line}
              </div>
            ))}
          </div>

          {/* Warnings detail */}
          {state.isComplete && state.warnings.length > 0 && (
            <div className="bg-yellow-950/40 border border-yellow-800/50 rounded p-2.5 text-xs space-y-1">
              <div className="text-yellow-400 font-semibold">
                ⚠ {t('autoMapping.warnings').replace('{count}', String(state.warnings.length))}
              </div>
              {state.warnings.map((w, i) => (
                <div key={i} className="text-yellow-200/80">• {t(w.message as TranslationKey).replace('{column}', w.column ?? '')}</div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            {!state.isComplete ? (
              <button
                onClick={state.cancel}
                className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold"
              >
                {t('autoMapping.cancel')}
              </button>
            ) : state.report ? (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                {t('autoMapping.viewMapping')} →
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-semibold"
              >
                {t('autoMapping.close')}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
