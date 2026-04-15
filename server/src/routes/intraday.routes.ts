import { Router } from 'express';
import { sessionAuth } from '../middleware/sessionAuth';
import { IntradayService } from '../services/intraday.service';

export function createIntradayRoutes(): Router {
  console.log('=== INTRADAY ROUTES V2 LOADED ===');
  const router = Router();
  const intradayService = new IntradayService();

  // Rate limit: 5 min per (companyId, date) combination
  const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
  const lastRefreshMap = new Map<string, number>(); // key → timestamp

  /**
   * POST /api/intraday/refresh
   * Body: { companyIds: number[], startDate: string, endDate: string }
   * Rate limited: 5 min per (companyId, date). Returns 429 with retryAfterSec if too soon.
   */
  router.post('/refresh', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const groupId = String(session.groupId);
      const { companyIds, startDate, endDate } = req.body;

      if (!companyIds?.length || !startDate || !endDate) {
        return res.status(400).json({ message: 'companyIds, startDate, endDate are required' });
      }

      // Check rate limit per company+date
      const now = Date.now();
      const dateKey = startDate.slice(0, 10); // YYYY-MM-DD
      for (const cid of companyIds) {
        const key = `${groupId}_${cid}_${dateKey}`;
        const last = lastRefreshMap.get(key);
        if (last && (now - last) < REFRESH_COOLDOWN_MS) {
          const retryAfterSec = Math.ceil((REFRESH_COOLDOWN_MS - (now - last)) / 1000);
          return res.status(429).json({
            message: `Rate limited. Try again in ${retryAfterSec}s.`,
            retryAfterSec,
            nextRefreshAt: new Date(last + REFRESH_COOLDOWN_MS).toISOString(),
          });
        }
      }

      // Mark refresh time
      for (const cid of companyIds) {
        lastRefreshMap.set(`${groupId}_${cid}_${dateKey}`, now);
      }

      console.log(`[Intraday Route] refresh called: companies=${JSON.stringify(companyIds)}, start=${startDate}, end=${endDate}`);

      const result = await intradayService.refreshTransactions(
        groupId,
        companyIds,
        startDate,
        endDate,
        session.portalAccessToken,
        session.portalCookies,
        session.env,
      );

      console.log(`[Intraday Route] result:`, JSON.stringify(result));
      res.json({
        ...result,
        nextRefreshAt: new Date(now + REFRESH_COOLDOWN_MS).toISOString(),
      });
    } catch (err) { next(err); }
  });

  /**
   * GET /api/intraday/transactions
   * Query: companyId, startDate, endDate (required)
   *        page, pageSize, sortBy, sortDir (pagination/sorting)
   *        direction, contractName, productType, username, status, orderType (filters)
   * Returns paginated transactions with total count.
   */
  router.get('/transactions', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const q = req.query as Record<string, string>;

      if (!q.companyId || !q.startDate || !q.endDate) {
        return res.status(400).json({ message: 'companyId, startDate, endDate are required' });
      }

      const page = Math.max(1, parseInt(q.page) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(q.pageSize) || 50));
      const sortBy = q.sortBy || 'deliveryStart';
      const sortDir = (q.sortDir === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';

      // Column filters
      const filters: Record<string, string> = {};
      for (const key of [
        'direction', 'contractName', 'contractId', 'productType', 'username',
        'status', 'orderType', 'platformCode', 'areaCode', 'explanation',
        'remoteTradeId', 'remoteOrderId', 'companyName', 'alertName',
        // numeric range keys
        'quantity_min', 'quantity_max', 'price_min', 'price_max',
        'mcp_min', 'mcp_max', 'smp_min', 'smp_max',
        'revisionNo_min', 'revisionNo_max', 'smartbotId_min', 'smartbotId_max',
        'id_min', 'id_max',
        // multi-select keys
        'direction_in', 'contractName_in', 'contractId_in', 'productType_in',
        'username_in', 'status_in', 'orderType_in', 'platformCode_in',
        'areaCode_in', 'explanation_in', 'remoteTradeId_in', 'remoteOrderId_in',
        'companyName_in', 'alertName_in',
      ]) {
        if (q[key] != null && q[key] !== '') filters[key] = q[key];
      }

      const result = await intradayService.getTransactionsPaginated(
        groupId, parseInt(q.companyId), q.startDate, q.endDate,
        { page, pageSize, sortBy, sortDir, filters },
      );

      res.json(result);
    } catch (err) { next(err); }
  });

  /**
   * GET /api/intraday/transactions/heatmap
   * Query: companyId, startDate, endDate
   * Returns heatmap data: for each delivery slot, trade volume by minutes-before-delivery buckets.
   */
  router.get('/transactions/heatmap', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const q = req.query as Record<string, string>;

      if (!q.companyId || !q.startDate || !q.endDate) {
        return res.status(400).json({ message: 'companyId, startDate, endDate are required' });
      }

      const result = await intradayService.getHeatmapData(
        groupId, parseInt(q.companyId), q.startDate, q.endDate,
      );

      res.json(result);
    } catch (err) { next(err); }
  });

  /**
   * GET /api/intraday/transactions/export
   * Same filters as /transactions but returns ALL matching rows (no pagination, max 3000).
   * Client uses this to generate a CSV download.
   */
  router.get('/transactions/export', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const q = req.query as Record<string, string>;

      if (!q.companyId || !q.startDate || !q.endDate) {
        return res.status(400).json({ message: 'companyId, startDate, endDate are required' });
      }

      const sortBy = q.sortBy || 'deliveryStart';
      const sortDir = (q.sortDir === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';

      const filters: Record<string, string> = {};
      for (const key of [
        'direction', 'contractName', 'contractId', 'productType', 'username',
        'status', 'orderType', 'platformCode', 'areaCode', 'explanation',
        'remoteTradeId', 'remoteOrderId', 'companyName', 'alertName',
        'quantity_min', 'quantity_max', 'price_min', 'price_max',
        'mcp_min', 'mcp_max', 'smp_min', 'smp_max',
        'revisionNo_min', 'revisionNo_max', 'smartbotId_min', 'smartbotId_max',
        'id_min', 'id_max',
        'direction_in', 'contractName_in', 'contractId_in', 'productType_in',
        'username_in', 'status_in', 'orderType_in', 'platformCode_in',
        'areaCode_in', 'explanation_in', 'remoteTradeId_in', 'remoteOrderId_in',
        'companyName_in', 'alertName_in',
      ]) {
        if (q[key] != null && q[key] !== '') filters[key] = q[key];
      }

      const result = await intradayService.exportTransactions(
        groupId, parseInt(q.companyId), q.startDate, q.endDate,
        { sortBy, sortDir, filters },
      );

      res.json(result);
    } catch (err) { next(err); }
  });

  /**
   * GET /api/intraday/transactions/distinct
   * Query: companyId, startDate, endDate, column
   * Returns distinct values for a given text column (for filter dropdowns).
   */
  router.get('/transactions/distinct', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const q = req.query as Record<string, string>;

      if (!q.companyId || !q.startDate || !q.endDate || !q.column) {
        return res.status(400).json({ message: 'companyId, startDate, endDate, column are required' });
      }

      const allowed = ['contractName', 'contractId', 'productType', 'username', 'orderType', 'platformCode', 'areaCode', 'status', 'explanation', 'remoteTradeId', 'remoteOrderId', 'companyName', 'alertName'];
      if (!allowed.includes(q.column)) {
        return res.status(400).json({ message: `Column not allowed. Use: ${allowed.join(', ')}` });
      }

      const values = await intradayService.getDistinctValues(
        groupId, parseInt(q.companyId), q.startDate, q.endDate, q.column,
      );

      res.json({ column: q.column, values });
    } catch (err) { next(err); }
  });

  return router;
}
