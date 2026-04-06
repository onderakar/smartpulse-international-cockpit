import { useState, useRef, useCallback } from 'react'
import { AutoMappingEvent, AutoMappingReport, AutoMappingWarning } from '@shared/types/assetMapping.types'

export type StepStatus = 'pending' | 'active' | 'done' | 'error'

export interface AutoMappingStep {
  key: string
  i18nKey: string
  status: StepStatus
  badge?: string
}

export interface AutoMappingState {
  isRunning: boolean
  isComplete: boolean
  steps: AutoMappingStep[]
  logLines: string[]
  report: AutoMappingReport | null
  warnings: AutoMappingWarning[]
  run: () => Promise<void>
  reset: () => void
}

const STEP_KEYS = [
  { key: 'csv_read',     i18nKey: 'autoMapping.step.csvRead' },
  { key: 'phase1_done',  i18nKey: 'autoMapping.step.phase1Done' },
  { key: 'portal_fetch', i18nKey: 'autoMapping.step.portalFetch' },
  { key: 'phase2_done',  i18nKey: 'autoMapping.step.phase2Done' },
  { key: 'saved',        i18nKey: 'autoMapping.step.saved' },
]

function makeInitialSteps(): AutoMappingStep[] {
  return STEP_KEYS.map(s => ({ ...s, status: 'pending' as StepStatus }))
}

export function useAutoMapping(onComplete: () => void): AutoMappingState {
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [steps, setSteps] = useState<AutoMappingStep[]>(makeInitialSteps())
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
      case 'csv_read':
        setStepStatus('csv_read', 'done', `${event.batteriesFound} battery`)
        addLog(`[OK] CSV read — ${event.batteriesFound} batteries`)
        setStepStatus('phase1_done', 'active')
        break
      case 'gcp_phase1':
        addLog(`[OK] ${event.name} → BESS(${event.bessPlantId})${event.pvPlantId ? ` + SOLAR(${event.pvPlantId})` : ''}`)
        break
      case 'phase1_done':
        setStepStatus('phase1_done', 'done', `${event.gcps} GCP`)
        setStepStatus('portal_fetch', 'active')
        break
      case 'portal_fetch':
        setStepStatus('portal_fetch', 'done', `${event.plantsFound} plants`)
        setStepStatus('phase2_done', 'active')
        break
      case 'gcp_phase2':
        addLog(`[OK] ${event.name} (plant #${event.plantId})`)
        break
      case 'phase2_done':
        setStepStatus('phase2_done', 'done', `${event.unmappedGcps} GCP`)
        setStepStatus('saved', 'active')
        break
      case 'saved':
        setStepStatus('saved', 'done')
        break
      case 'done':
        setReport(event.report)
        setIsRunning(false)
        setIsComplete(true)
        onComplete()
        break
      case 'warning':
        setWarnings(prev => [...prev, { type: event.warnType, message: event.i18nKey, column: event.params?.column as string | undefined }])
        addLog(`[WARN] ${event.i18nKey} ${JSON.stringify(event.params ?? {})}`)
        break
      case 'error':
        addLog(`[ERROR] ${event.i18nKey}`)
        setSteps(prev => prev.map(s => s.status === 'active' ? { ...s, status: 'error' as StepStatus } : s))
        setIsRunning(false)
        setIsComplete(true)
        break
    }
  }, [onComplete])

  const run = useCallback(async () => {
    setIsRunning(true)
    setIsComplete(false)
    setSteps(makeInitialSteps())
    setLogLines([])
    setReport(null)
    setWarnings([])

    setSteps(prev => prev.map(s => s.key === 'csv_read' ? { ...s, status: 'active' as StepStatus } : s))

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/auto-mapping/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
      }
    }
  }, [dispatch])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setIsRunning(false)
    setIsComplete(false)
    setSteps(makeInitialSteps())
    setLogLines([])
    setReport(null)
    setWarnings([])
  }, [])

  return { isRunning, isComplete, steps, logLines, report, warnings, run, reset }
}
