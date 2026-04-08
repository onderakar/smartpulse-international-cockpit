import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { MonitoringAuthService } from '../services/monitoringAuth.service';
import { MonitoringService } from '../services/monitoring.service';
import { sessionAuth } from '../middleware/sessionAuth';

const prisma = new PrismaClient();

export function createMonitoringRoutes(
  monitoringAuth: MonitoringAuthService,
  monitoringService: MonitoringService,
): Router {
  const router = Router();

  // GET /api/monitoring/v2/metrics
  router.get('/v2/metrics', sessionAuth, async (req, res, next) => {
    try {
      const { gcpId, companyId, start, end } = req.query;
      if (!gcpId || !companyId || !start || !end) {
        return res.status(400).json({ message: 'gcpId, companyId, start, end required' });
      }

      const asset = await prisma.asset.findUnique({ where: { name: `GCP_${gcpId}` } });
      if (!asset) {
        return res.status(404).json({ message: `Asset GCP_${gcpId} not found` });
      }

      const metrics = await prisma.timeSeriesData.findMany({
        where: {
          assetId: asset.id,
          effectiveTime: { gte: new Date(start as string), lte: new Date(end as string) }
        },
        include: { metricType: true },
        orderBy: { effectiveTime: 'asc' }
      });

      const result = metrics.map((m: any) => ({
        timestamp: m.effectiveTime.getTime(),
        type: m.metricType.name.toUpperCase(),
        value: m.value
      }));

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/monitoring/v2/refetch
  router.post('/v2/refetch', sessionAuth, async (req, res, next) => {
    try {
      const { gcpId, companyId, start, end } = req.body;
      if (!gcpId || !companyId || !start || !end) {
        return res.status(400).json({ message: 'gcpId, companyId, start, end required' });
      }

      const username = req.session?.portalSession?.username;
      if (!username) return res.status(401).json({ message: 'Unauthorized' });

      const parsedCompanyId = parseInt(companyId, 10);
      const gcpIdStr = String(gcpId);

      const asset = await prisma.asset.findUnique({ where: { name: `GCP_${gcpIdStr}` } });
      if (!asset) {
        return res.status(404).json({ message: `Asset GCP_${gcpIdStr} not found` });
      }

      // Find children of this asset to wipe their data too
      const childAssets = await prisma.asset.findMany({ where: { parentId: asset.id } });
      const allAssetIds = [asset.id, ...childAssets.map((a: any) => a.id)];

      const deleted = await prisma.timeSeriesData.deleteMany({
        where: {
          assetId: { in: allAssetIds },
          effectiveTime: { gte: new Date(start), lte: new Date(end) }
        }
      });
      console.log(`[Monitoring Routes] Wiped ${deleted.count} records for GCP ${gcpIdStr} from ${start} to ${end}.`);

      const { ConfigStoreService } = require('../services/configStore.service');
      const store = new ConfigStoreService();

      const groupId = String(req.session.portalSession!.groupId);
      const profile = await store.loadGroupProfile(groupId);

      if (!profile || !profile.monitoringCredentials) {
        return res.status(400).json({ message: 'Monitoring credentials missing' });
      }

      // Respond immediately, refetch in background
      res.json({ success: true, message: 'Data wiped. Refetch started in background.' });

      const { ScadaWorker } = require('../workers/scada.worker');
      ScadaWorker.fetchAndIngestAdhoc({
        gcpId: gcpIdStr,
        companyId: parsedCompanyId,
        start,
        end,
        profile
      }).then(() => {
        console.log(`[Monitoring Routes] Background refetch completed for GCP ${gcpIdStr}`);
      }).catch((err: any) => {
        console.error(`[Monitoring Routes] Background refetch failed for GCP ${gcpIdStr}:`, err.message);
      });
    } catch (err: any) {
      console.error('Refetch error:', err);
      res.status(500).json({ success: false, message: err.message || 'Refetch failed' });
    }
  });

  // POST /api/monitoring/v2/test-metric
  router.post('/v2/test-metric', sessionAuth, async (req, res, next) => {
    try {
      const { masternode, node, nodeidentity } = req.body;
      if (!masternode || !node || nodeidentity === undefined) {
        return res.status(400).json({ message: 'masternode, node, and nodeidentity required' });
      }

      const username = req.session?.portalSession?.username;
      if (!username) return res.status(401).json({ message: 'Unauthorized' });

      const groupId = String(req.session.portalSession!.groupId);
      const { ConfigStoreService } = require('../services/configStore.service');
      const store = new ConfigStoreService();
      const profile = await store.loadGroupProfile(groupId);

      if (!profile || !profile.monitoringCredentials) {
        return res.status(400).json({ message: 'Monitoring credentials not configured in settings.' });
      }

      const { username: credUsername, password } = profile.monitoringCredentials;
      const entry = await monitoringAuth.login(credUsername, password, req.sessionID);
      const token = entry.accessToken;

      const start = new Date(Date.now() - 60000).toISOString();
      const end = new Date().toISOString();

      const response = await monitoringService.getMetrics(token, {
        masternode,
        node,
        nodeidentity: parseInt(nodeidentity, 10),
        start,
        end
      });

      const count = Array.isArray(response.data) ? response.data.length : 0;
      let sample = null;
      if (count > 0) sample = response.data[0];

      res.json({ success: true, count, sample });
    } catch (err: any) {
      console.error('Test metric error:', err?.message || err);
      res.status(500).json({ success: false, message: err?.response?.data?.message || err?.message || 'Failed to fetch' });
    }
  });

  // POST /api/monitoring/login — test monitoring credentials
  router.post('/login', sessionAuth, async (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: 'username and password required' });
      }

      const entry = await monitoringAuth.login(username, password, req.sessionID);
      res.json({ success: true, expiresAt: entry.expiresAt });
    } catch (err: any) {
      res.status(401).json({ success: false, message: err?.response?.data?.message || err?.message || 'Login failed' });
    }
  });

  return router;
}
