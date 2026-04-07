import { useState, useRef, useCallback } from 'react'
import { AutoMappingEvent, AutoMappingReport, AutoMappingWarning } from '@shared/types/assetMapping.types'

export type StepStatus = 'pending' | 'active' | 'done' | 'error'
export type ModalStage = 'idle' | 'confirm1' | 'confirm2' | 'running' | 'complete'

export interface AutoMappingStep {
  key: string
  i18nKey: string
  status: StepStatus
  badge?: string
}

export interface AutoMappingState {
  modalStage: ModalStage
  isRunning: boolean
  isComplete: boolean
  steps: AutoMappingStep[]
  logLines: string[]
  report: AutoMappingReport | null
  warnings: AutoMappingWarning[]
  startConfirmFlow: () => void
  confirmPhase1: () => void
  confirmPhase2: (runPhase2: boolean) => void
  reset: () => void
  cancel: () => void
}

const BASE_STEP_KEYS = [
  { key: 'portal_fetch', i18nKey: 'autoMapping.step.portalFetch' },
  { key: 'csv_read',     i18nKey: 'autoMapping.step.csvRead'     },
  { key: 'phase1_done',  i18nKey: 'autoMapping.step.phase1Done'  },
  { key: 'saved',        i18nKey: 'autoMapping.step.saved'       },
]

const PHASE2_STEP_KEY = { key: 'phase2_done', i18nKey: 'autoMapping.step.phase2Done' }

function makeInitialSteps(includePhase2: boolean): AutoMappingStep[] {
  const keys = includePhase2
    ? [...BASE_STEP_KEYS.slice(0, 3), PHASE2_STEP_KEY, BASE_STEP_KEYS[3]]
    : BASE_STEP_KEYS
  return keys.map(s => ({ ...s, status: 'pending' as StepStatus }))
}

export function useAutoMapping(onComplete: () => void): AutoMappingState {
  const [modalStage, setModalStage] = useState<ModalStage>('idle')
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [steps, setSteps] = useState<AutoMappingStep[]>(makeInitialSteps(false))
  const [logLines, setLogLines] = useState<string[]>([])
  const [report, setReport] = useState<AutoMappingReport | null>(null)
  const [warnings, setWarnings] = useState<AutoMappingWarning[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const addLog = (line: string) => setLogLines(prev => [...prev, line])

  const setStepStatus = (key: string, status: StepStatus, badge?: string) => {
    setSteps(prev => prev.map(s =>
      s.key === key ? { ...s, status, ...(badge ? { badge } : {}) } : s
    ))
  }

  const dispatch = useCallback((event: AutoMappingEvent) => {
    switch (event.step) {
      case 'portal_fetch':
        setStepStatus('portal_fetch', 'done', `${event.plantsFound} plants`)
        addLog(`[OK] Portal fetch — ${event.plantsFound} plants`)
        setStepStatus('csv_read', 'active')
        break
      case 'csv_read':
        setStepStatus('csv_read', 'done', `${event.batteriesFound} batteries`)
        addLog(`[OK] CSV read — ${event.batteriesFound} batteries`)
        setStepStatus('phase1_done', 'active')
        break
      case 'gcp_phase1':
        addLog(`[OK] ${event.gcpName} (root: ${event.gcpRoot}) → Gen(${event.genPlantId ?? '-'}) Con(${event.conPlantId ?? '-'}) | ${event.companionComponents} component(s)`)
        break
      case 'phase1_done':
        setStepStatus('phase1_done', 'done', `${event.gcps} GCP`)
        addLog(`[OK] Phase 1 done — ${event.gcps} GCPs, ${event.bessComponents} BESS, gen=${event.genSubComponents} con=${event.conSubComponents}`)
        setStepStatus('phase2_done', 'active')
        setStepStatus('saved', 'active')
        break
      case 'phase2_scan':
        addLog(`[OK] Phase 2 scan — ${event.plantsScanned} remaining plants`)
        break
      case 'gcp_phase2':
        addLog(`[OK] Phase2: ${event.name} — ${event.plantCount} component(s) gen=${event.genCount} con=${event.conCount}`)
        break
      case 'phase2_done':
        setStepStatus('phase2_done', 'done', `${event.gcpsCreated} GCP`)
        addLog(`[OK] Phase 2 done — ${event.gcpsCreated} GCPs (${event.standalone} standalone, ${event.grouped} grouped)`)
        setStepStatus('saved', 'active')
        break
      case 'saved':
        setStepStatus('saved', 'done')
        break
      case 'done':
        setReport(event.report)
        setIsRunning(false)
        setIsComplete(true)
        setModalStage('complete')
        onComplete()
        break
      case 'warning':
        setWarnings(prev => [...prev, {
          type: event.warnType,
          message: event.i18nKey,
          column: event.params?.column as string | undefined,
          plantId: event.params?.plantId as number | undefined,
          plantName: event.params?.plantName as string | undefined,
        }])
        addLog(`[WARN] ${event.i18nKey} ${JSON.stringify(event.params ?? {})}`)
        break
      case 'error':
        addLog(`[ERROR] ${event.i18nKey}`)
        setSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' as StepStatus } : s))
        setIsRunning(false)
        setIsComplete(true)
        setModalStage('complete')
        break
    }
  }, [onComplete])

  const runMapped = useCallback(async (runPhase2: boolean) => {
    setIsRunning(true)
    setIsComplete(false)
    setSteps(makeInitialSteps(runPhase2))
    setLogLines([])
    setReport(null)
    setWarnings([])

    setSteps(prev => prev.map(s => s.key === 'portal_fetch' ? { ...s, status: 'active' as StepStatus } : s))

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/auto-mapping/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runPhase2 }),
        signal: abortRef.current.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const event: AutoMappingEvent = JSON.parse(line.slice(6))
              dispatch(event)
            } catch {
              // malformed SSE line — ignore
            }
          }
        }
      }
    } catch (err: unknown) {
      const error = err as Error
      if (error.name !== 'AbortError') {
        addLog(`[ERROR] Network error: ${error.message}`)
        setIsRunning(false)
        setIsComplete(true)
        setModalStage('complete')
      }
    }
  }, [dispatch])

  const startConfirmFlow = useCallback(() => {
    setModalStage('confirm1')
  }, [])

  const confirmPhase1 = useCallback(() => {
    setModalStage('confirm2')
  }, [])

  const confirmPhase2 = useCallback((runPhase2: boolean) => {
    setModalStage('running')
    runMapped(runPhase2)
  }, [runMapped])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setIsComplete(false)
    setSteps(makeInitialSteps(false))
    setLogLines([])
    setReport(null)
    setWarnings([])
    setModalStage('idle')
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setIsComplete(true)
    setModalStage('complete')
  }, [])

  return { modalStage, isRunning, isComplete, steps, logLines, report, warnings, startConfirmFlow, confirmPhase1, confirmPhase2, reset, cancel }
}
