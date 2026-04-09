import { Router } from 'express';
import { sessionAuth } from '../middleware/sessionAuth';
import { EntityTimeSeriesService } from '../services/entityTimeSeries.service';

export function createEntityTimeSeriesRoutes(): Router {
  const router = Router();
  const ets = new EntityTimeSeriesService();

  /**
   * GET /api/time-series/current
   * Query params: entityType, entityId, seriesKey, dateStart, dateEnd
   * Returns current (isFinal) values for all delivery slots in range.
   */
  router.get('/current', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const { entityType, entityId, seriesKey, dateStart, dateEnd } = req.query as Record<string, string>;

      if (!entityType || !entityId || !seriesKey || !dateStart || !dateEnd) {
        return res.status(400).json({ message: 'entityType, entityId, seriesKey, dateStart, dateEnd are required' });
      }

      const data = await ets.getCurrentValues(
        groupId, entityType, entityId, seriesKey,
        new Date(dateStart), new Date(dateEnd),
      );
      res.json(data);
    } catch (err) { next(err); }
  });

  /**
   * GET /api/time-series/multi
   * Query params: entityType, entityId, seriesKeys (comma-separated), dateStart, dateEnd
   * Returns multiple series grouped by key — ideal for dashboard charts.
   */
  router.get('/multi', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const { entityType, entityId, seriesKeys, dateStart, dateEnd } = req.query as Record<string, string>;

      if (!entityType || !entityId || !seriesKeys || !dateStart || !dateEnd) {
        return res.status(400).json({ message: 'entityType, entityId, seriesKeys, dateStart, dateEnd are required' });
      }

      const keys = seriesKeys.split(',').map(k => k.trim());
      const data = await ets.getMultiSeries(
        groupId, entityType, entityId, keys,
        new Date(dateStart), new Date(dateEnd),
      );
      res.json(data);
    } catch (err) { next(err); }
  });

  /**
   * GET /api/time-series/history
   * Query params: entityType, entityId, seriesKey, deliveryStart
   * Returns all observed versions for a specific slot — "how did this value change?"
   */
  router.get('/history', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const { entityType, entityId, seriesKey, deliveryStart } = req.query as Record<string, string>;

      if (!entityType || !entityId || !seriesKey || !deliveryStart) {
        return res.status(400).json({ message: 'entityType, entityId, seriesKey, deliveryStart are required' });
      }

      const data = await ets.getSlotHistory(
        groupId, entityType, entityId, seriesKey,
        new Date(deliveryStart),
      );
      res.json(data);
    } catch (err) { next(err); }
  });

  return router;
}
