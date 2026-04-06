import { Router } from 'express';
import { FtpService } from '../services/ftp.service';
import { sessionAuth } from '../middleware/sessionAuth';
import { parseTechParams, parseMultiBatteryTechParams, serializeMultiBatteryTechParams } from '../utils/techParamsParser';

export function createFtpRoutes(ftpService: FtpService): Router {
  const router = Router();

  // POST /api/ftp/read
  router.post('/read', sessionAuth, async (req, res, next) => {
    try {
      const { direction, filename } = req.body;

      if (!direction || !filename) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'direction and filename are required',
        });
      }

      const session = req.session.portalSession!;
      const data = await ftpService.readFile(session.portalCookies, session.env, direction, filename);

      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/ftp/read-tech-params  (read + parse)
  router.post('/read-tech-params', sessionAuth, async (req, res, next) => {
    try {
      const { direction, filename } = req.body;

      if (!direction || !filename) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'direction and filename are required',
        });
      }

      const session = req.session.portalSession!;
      const rawCsv = await ftpService.readFile(session.portalCookies, session.env, direction, filename);
      const parsed = parseTechParams(rawCsv);

      res.json({ raw: rawCsv, parsed });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/ftp/write
  router.post('/write', sessionAuth, async (req, res, next) => {
    try {
      const { direction, filename, data } = req.body;

      if (!direction || !filename || data === undefined) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'direction, filename, and data are required',
        });
      }

      const session = req.session.portalSession!;
      const message = await ftpService.saveFile(session.portalCookies, session.env, direction, filename, data);

      res.json({ message });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/ftp/read-multi-tech-params  (read + parse multi-battery CSV)
  router.post('/read-multi-tech-params', sessionAuth, async (req, res, next) => {
    try {
      const { direction, filename } = req.body;

      if (!direction || !filename) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'direction and filename are required',
        });
      }

      const session = req.session.portalSession!;
      const rawCsv = await ftpService.readFile(session.portalCookies, session.env, direction, filename);
      console.log(`[FTP] read-multi-tech-params raw length=${rawCsv.length} preview=${rawCsv.substring(0, 200)}`);
      const parsed = parseMultiBatteryTechParams(rawCsv);

      res.json({ raw: rawCsv, parsed });
    } catch (err: any) {
      console.error('[FTP] read-multi-tech-params error:', err.response?.status, err.response?.data || err.message);
      next(err);
    }
  });

  // POST /api/ftp/write-tech-params  (serialize multi-battery + write)
  router.post('/write-tech-params', sessionAuth, async (req, res, next) => {
    try {
      const { direction, filename, params } = req.body;

      if (!direction || !filename || !params) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'direction, filename, and params are required',
        });
      }

      const csvContent = serializeMultiBatteryTechParams(params);
      const session = req.session.portalSession!;
      const message = await ftpService.saveFile(session.portalCookies, session.env, direction, filename, csvContent);

      res.json({ message });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
