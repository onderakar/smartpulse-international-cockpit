import { Router } from 'express';
import { sessionAuth } from '../middleware/sessionAuth';
import { IntradayService } from '../services/intraday.service';

export function createIntradayRoutes(): Router {
  console.log('=== INTRADAY ROUTES V2 LOADED ===');
  const router = Router();
  const intradayService = new IntradayService();

  /**
   * POST /api/intraday/refresh
   * Body: { companyIds: number[], startDate: string, endDate: string }
   * Fetches transactions from SmartPulse, stores them, and aggregates net position.
   */
  router.post('/refresh', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const groupId = String(session.groupId);
      const { companyIds, startDate, endDate } = req.body;

      if (!companyIds?.length || !startDate || !endDate) {
        return res.status(400).json({ message: 'companyIds, startDate, endDate are required' });
      }

      console.log(`[Intraday Route] refresh called: companies=${JSON.stringify(companyIds)}, start=${startDate}, end=${endDate}, token=${session.portalAccessToken ? 'yes' : 'no'}, cookies=${session.portalCookies?.length ?? 0}`);

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
      res.json(result);
    } catch (err) { next(err); }
  });

  /**
   * GET /api/intraday/transactions
   * Query: companyId, startDate, endDate
   * Returns raw stored transactions for detailed reporting.
   */
  router.get('/transactions', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const { companyId, startDate, endDate } = req.query as Record<string, string>;

      if (!companyId || !startDate || !endDate) {
        return res.status(400).json({ message: 'companyId, startDate, endDate are required' });
      }

      const transactions = await intradayService.getTransactions(
        groupId, parseInt(companyId), startDate, endDate,
      );

      res.json({ transactions, count: transactions.length });
    } catch (err) { next(err); }
  });

  return router;
}
