import { Router } from 'express'
import { sessionAuth } from '../middleware/sessionAuth'
import { FtpService } from '../services/ftp.service'
import { ConfigStoreService } from '../services/configStore.service'
import { runAutoMapping } from '../services/autoMapping.service'
import { AutoMappingEvent } from '@smartpulse-intl/shared'

export function createAutoMappingRoutes(
  ftpService: FtpService,
  configStore: ConfigStoreService,
): Router {
  const router = Router()

  // POST /api/auto-mapping/run  — SSE stream
  router.post('/run', sessionAuth, async (req, res) => {
    const session = req.session.portalSession!

    // Load current group profile
    const profile = await configStore.loadGroupProfile(String(session.groupId))
    if (!profile) {
      res.status(400).json({ code: 'NO_PROFILE', message: 'Group profile not found' })
      return
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
      await runAutoMapping(session, profile, ftpService, configStore, emit)
    } catch (err: any) {
      emit({ step: 'error', status: 'failed', i18nKey: 'autoMapping.error.csvFailed' })
    } finally {
      res.end()
    }
  })

  return router
}
