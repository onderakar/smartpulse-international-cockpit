import { Router } from 'express';
import axios from 'axios';
import { sessionAuth } from '../middleware/sessionAuth';
import { ConfigStoreService } from '../services/configStore.service';
import { PORTAL_BASE_URLS } from '../config/env';
import type { PortfolioSnapshot, PortalEntityUnit, PortfolioEntry } from '@smartpulse-intl/shared';

export function createPortfolioRoutes(configStore: ConfigStoreService): Router {
  const router = Router();

  /**
   * POST /api/portfolio/refresh
   * Fetches all portfolios + entity units from SmartPulse Portal and saves to GroupProfile.portfolioMap
   * Portal API: GET /PortfolioManagement/GetPortfoliosByUserId
   */
  router.post('/refresh', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const { portalCookies, portalAccessToken, env, groupId } = session;
      const baseUrl = PORTAL_BASE_URLS[env] ?? PORTAL_BASE_URLS['prod'];

      const headers = {
        Cookie: portalCookies.join('; '),
        Authorization: `Bearer ${portalAccessToken}`,
        'Content-Type': 'application/json',
      };

      // Single GET call returns everything
      const response = await axios.get(
        `${baseUrl}/PortfolioManagement/GetPortfoliosByUserId`,
        { headers, timeout: 15000 },
      );

      const body = response.data;
      if (body.isError) {
        return res.status(502).json({ success: false, message: body.ErrorMessage || 'Portal error' });
      }

      const replyObj = body.replyObject;

      const entityUnits: PortalEntityUnit[] = (replyObj?.entityUnits || []).map((u: any) => ({
        unitNo: u.unitNo,
        unitType: u.unitType || 'PP',
        shortName: u.shortName || null,
        fullName: u.fullName || '',
      }));

      const portfolios: PortfolioEntry[] = (replyObj?.portfolios || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        portfolioType: p.portfolioType || 'Unknown',
        eicForTps: p.eicForTps || null,
        eicForPps: p.eicForPps || null,
        portfolioUnits: (p.portfolioUnits || []).map((u: any) => ({
          unitNo: u.unitNo,
          unitType: u.unitType || 'PP',
        })),
      }));

      console.log(`[Portfolio] Fetched ${entityUnits.length} entity unit(s), ${portfolios.length} portfolio(s)`);

      const snapshot: PortfolioSnapshot = {
        entityUnits,
        portfolios,
        fetchedAt: new Date().toISOString(),
      };

      // Save to GroupProfile.portfolioMap (JSONB column)
      const groupIdStr = String(groupId);
      const existingProfile = await configStore.loadGroupProfile(groupIdStr);
      if (existingProfile) {
        (existingProfile as any).portfolioSnapshot = snapshot;
        await configStore.saveGroupProfile(groupIdStr, existingProfile);
      }

      res.json({
        success: true,
        entityUnitCount: entityUnits.length,
        portfolioCount: portfolios.length,
        totalPortfolioUnits: portfolios.reduce((s, p) => s + p.portfolioUnits.length, 0),
      });
    } catch (err: any) {
      console.error('[Portfolio] Refresh failed:', err.message);
      res.status(500).json({
        success: false,
        message: err?.response?.data?.ErrorMessage || err.message || 'Failed to refresh portfolios',
      });
    }
  });

  return router;
}
