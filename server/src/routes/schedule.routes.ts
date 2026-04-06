import { Router } from 'express';
import { FtpService } from '../services/ftp.service';
import { ScheduleStoreService } from '../services/scheduleStore.service';
import { ConfigStoreService } from '../services/configStore.service';
import { sessionAuth } from '../middleware/sessionAuth';
import { parseScheduleCsv, serializeScheduleCsv } from '../utils/scheduleParser';
import { getScheduleFilenameFromMapping } from '@smartpulse-intl/shared';

export function createScheduleRoutes(
  ftpService: FtpService,
  scheduleStore: ScheduleStoreService,
  configStore: ConfigStoreService
): Router {
  const router = Router();

  // POST /api/schedule/read
  router.post('/read', sessionAuth, async (req, res, next) => {
    try {
      const { plantId, dateKey } = req.body;

      if (!plantId) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'plantId is required',
        });
      }

      const session = req.session.portalSession!;
      const useDateKey = dateKey || new Date().toISOString().slice(0, 10);

      // Resolve schedule filename from asset mapping config
      const profile = await configStore.loadProfile(session.username, String(session.groupId));
      const filename = getScheduleFilenameFromMapping(profile?.assetMapping, plantId);
      const baseName = filename.replace(/\.csv$/i, '');

      console.log(`[Schedule] Reading ${filename} for plantId=${plantId}`);

      const rawCsv = await ftpService.readFile(
        session.portalCookies,
        session.env,
        'outgoing',
        filename
      );

      const parsed = parseScheduleCsv(rawCsv);

      // We still sync history from FTP, but we also process the explicit main file we just securely read!
      await scheduleStore.syncScheduleFromFtp(
        plantId,
        useDateKey,
        ftpService,
        session.portalCookies,
        session.env,
        baseName
      );

      // Finally apply the LIVE securely read file over the history to guarantee it's not missing!
      const { hasChanges } = await scheduleStore.processSchedule(
        plantId,
        useDateKey,
        parsed.rows,
        rawCsv
      );

      // Merge FTP rows with protected past slots from local store
      const mergedRows = await scheduleStore.mergeWithProtectedPast(plantId, useDateKey, parsed.rows);

      res.json({
        rows: mergedRows,
        header: parsed.header,
        lastFetchedAt: Date.now(),
        hasChanges,
      });
    } catch (err: any) {
      console.error('[Schedule] read error:', err.response?.status, err.response?.data || err.message);
      next(err);
    }
  });

  // POST /api/schedule/history
  router.post('/history', sessionAuth, async (req, res, next) => {
    try {
      const { plantId, dateKey } = req.body;
      if (!plantId) {
        return res.status(400).json({ code: 'INVALID_REQUEST', message: 'plantId is required' });
      }
      const useDateKey = dateKey || new Date().toISOString().slice(0, 10);
      const history = await scheduleStore.getScheduleHistory(plantId, useDateKey);
      res.json(history);
    } catch (err: any) {
      console.error('[Schedule] history error:', err.message);
      next(err);
    }
  });

  // POST /api/schedule/save
  router.post('/save', sessionAuth, async (req, res, next) => {
    try {
      const { plantId, header, rows } = req.body;

      if (!plantId || !header || !rows) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'plantId, header, and rows are required',
        });
      }

      const session = req.session.portalSession!;

      // Check if schedule editing is allowed
      const profile = await configStore.loadProfile(session.username, String(session.groupId));
      if (profile && profile.scheduleBapEditable === false) {
        return res.status(403).json({
          code: 'SCHEDULE_EDIT_DISABLED',
          message: 'Schedule editing is disabled in settings.',
        });
      }
      const filename = getScheduleFilenameFromMapping(profile?.assetMapping, plantId);
      const csvContent = serializeScheduleCsv(header, rows);

      console.log(`[Schedule] Saving ${filename} for plantId=${plantId}, ${rows.length} rows`);

      const message = await ftpService.saveFile(
        session.portalCookies,
        session.env,
        'outgoing',
        filename,
        csvContent
      );

      // Record user save to local store for past-slot protection
      await scheduleStore.recordUserSave(plantId, rows);

      res.json({ message });
    } catch (err: any) {
      console.error('[Schedule] save error:', err.response?.status, err.response?.data || err.message);
      next(err);
    }
  });

  // POST /api/schedule/slot-history
  router.post('/slot-history', sessionAuth, async (req, res, next) => {
    try {
      const { plantId, deliveryStart } = req.body;
      if (!plantId || !deliveryStart) {
        return res.status(400).json({ code: 'INVALID_REQUEST', message: 'plantId and deliveryStart are required' });
      }
      const dateKey = deliveryStart.slice(0, 10);
      const revisions = await scheduleStore.getSlotHistory(plantId, dateKey, deliveryStart);
      res.json({ revisions });
    } catch (err: any) {
      console.error('[Schedule] slot-history error:', err.message);
      next(err);
    }
  });

  // POST /api/schedule/export-versioned
  router.post('/export-versioned', sessionAuth, async (req, res, next) => {
    try {
      const { plantId, dateKey } = req.body;
      if (!plantId || !dateKey) {
        return res.status(400).json({ code: 'INVALID_REQUEST', message: 'plantId and dateKey are required' });
      }

      const history = await scheduleStore.getScheduleHistory(plantId, dateKey);
      const csvLines = ['Delivery_Start,Delivery_End,BAP_MW,Source,Revision_Time,Duration_Seconds'];

      const slotKeys = Object.keys(history.slots).sort();
      for (const slotKey of slotKeys) {
        const revisions = history.slots[slotKey];
        if (!Array.isArray(revisions)) continue;

        for (let i = 0; i < revisions.length; i++) {
          const rev = revisions[i];
          const bap = Number(rev.row.Battery_Active_Power_MW) || 0;
          const source = rev.source || 'ftp';
          const revTime = new Date(rev.fetchedAt).toISOString();

          // Duration: time until next revision for this slot, or until slot end
          let durationSec = 0;
          if (i < revisions.length - 1) {
            durationSec = Math.round((revisions[i + 1].fetchedAt - rev.fetchedAt) / 1000);
          } else {
            // Last revision — duration until slot end
            const slotEndMs = new Date(rev.row.Delivery_End).getTime();
            const revMs = rev.fetchedAt;
            durationSec = Math.max(0, Math.round((slotEndMs - revMs) / 1000));
          }

          csvLines.push(`${rev.row.Delivery_Start},${rev.row.Delivery_End},${bap},${source},${revTime},${durationSec}`);
        }
      }

      const csvContent = csvLines.join('\r\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="schedule_${plantId}_${dateKey}_versioned.csv"`);
      res.send(csvContent);
    } catch (err: any) {
      console.error('[Schedule] export-versioned error:', err.message);
      next(err);
    }
  });

  return router;
}
