import { Router } from 'express';
import { ConfigStoreService } from '../services/configStore.service';
import { PortalAuthService } from '../services/portalAuth.service';
import { sessionAuth } from '../middleware/sessionAuth';

export function createConfigRoutes(
  configStore: ConfigStoreService,
  portalAuth: PortalAuthService,
): Router {
  const router = Router();

  // GET /api/config/profile
  router.get('/profile', sessionAuth, async (req, res, next) => {
    try {
      const { username, groupId } = req.session.portalSession!;
      const profile = await configStore.loadProfile(username, String(groupId));
      res.json({ profile });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/config/profile
  router.post('/profile', sessionAuth, async (req, res, next) => {
    try {
      const { profile, forceMapping = false } = req.body;

      if (!profile) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'profile object is required',
        });
      }

      const { username, groupId } = req.session.portalSession!;
      await configStore.saveProfile(username, profile, String(groupId), forceMapping);
      res.json({ success: true, profileId: username });
    } catch (err: any) {
      if (err.message?.startsWith('MAPPING_DELETE_BLOCKED')) {
        return res.status(400).json({ code: 'MAPPING_DELETE_BLOCKED', message: err.message });
      }
      next(err);
    }
  });

  // POST /api/config/plants-resolution
  router.post('/plants-resolution', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const data = await portalAuth.getPlantsResolution(session.portalCookies, session.env);
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
