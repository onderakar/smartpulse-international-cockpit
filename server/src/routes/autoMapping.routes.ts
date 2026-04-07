import { Router } from 'express'
import { sessionAuth } from '../middleware/sessionAuth'
import { FtpService } from '../services/ftp.service'
import { ConfigStoreService } from '../services/configStore.service'
import { runAutoMapping } from '../services/autoMapping.service'
import { AutoMappingEvent, GroupProfile, DEFAULT_POLLING_CONFIG } from '@smartpulse-intl/shared'

export function createAutoMappingRoutes(
  ftpService: FtpService,
  configStore: ConfigStoreService,
): Router {
  const router = Router()

  // POST /api/auto-mapping/run  — SSE stream
  router.post('/run', sessionAuth, async (req, res) => {
    const session = req.session.portalSession!
    const { runPhase2 = false } = req.body as { runPhase2?: boolean }

    // Load current group profile; fall back to empty profile when none exists yet
    const profile: GroupProfile = (await configStore.loadGroupProfile(String(session.groupId))) ?? {
      id: String(session.groupId),
      name: '',
      portalEnv: 'prod',
      assetMapping: { companies: [], ftpDirection: 'incoming', ftpFilename: 'Technical_Parameters.csv' },
      polling: DEFAULT_POLLING_CONFIG,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const emit = (event: AutoMappingEvent) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    try {
      await runAutoMapping(session, profile, ftpService, configStore, runPhase2, emit)
    } catch (err: any) {
      emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.csvFailed' })
    } finally {
      res.end()
    }
  })

  return router
}
