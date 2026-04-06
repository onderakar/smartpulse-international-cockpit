import { Router } from 'express';
import { PortalAuthService } from '../services/portalAuth.service';
import { ConfigStoreService } from '../services/configStore.service';

export function createAuthRoutes(
  portalAuth: PortalAuthService,
  configStore: ConfigStoreService,
): Router {
  const router = Router();

  // POST /api/auth/portal-login
  router.post('/portal-login', async (req, res, next) => {
    try {
      const { username, password, env = 'prod' } = req.body;

      if (!username || !password) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'Username and password are required',
        });
      }

      const result = await portalAuth.login(username, password, env);

      // Extract primary group from portal response
      const primaryGroup = result.groups[0];
      const groupId = primaryGroup?.id ?? 0;
      const groupName = primaryGroup?.name ?? '';
      const groupIdStr = String(groupId);

      // Store in express-session
      req.session.portalSession = {
        username,
        portalAccessToken: result.accessToken,
        oauthAccessToken: result.oauthAccessToken,
        graphQlAuthKey: result.graphQlAuthKey,
        portalCookies: result.cookies,
        plants: result.plants,
        companies: result.companies,
        groups: result.groups,
        groupId,
        groupName,
        env,
        loginTimestamp: Date.now(),
      };

      // Re-associate legacy group profile with real portal groupId
      if (groupId) {
        await configStore.reassociateGroup(username, groupIdStr, groupName);
      }

      // Auto-load existing profile (merged group + user)
      const existingProfile = await configStore.loadProfile(username, groupIdStr);

      res.json({
        plants: result.plants,
        companies: result.companies,
        groups: result.groups,
        groupId,
        groupName,
        username,
        profile: existingProfile,
      });
    } catch (err) {
      console.error('[AuthRoute] 500 Error during /portal-login:', err);
      next(err);
    }
  });

  // POST /api/auth/portal-check
  router.post('/portal-check', async (req, res, next) => {
    try {
      if (!req.session.portalSession) {
        return res.json({ loggedIn: false });
      }

      const { portalCookies, env, username, groupId, groupName } = req.session.portalSession;
      const sessionInfo = await portalAuth.checkSession(portalCookies, env);

      if (sessionInfo.valid) {
        // Update session with fresh companies/plants from CheckUserLoggedIn
        if (sessionInfo.companies.length > 0) {
          req.session.portalSession.companies = sessionInfo.companies;
        }
        if (sessionInfo.plants.length > 0) {
          req.session.portalSession.plants = sessionInfo.plants;
        }
      }

      res.json({
        loggedIn: sessionInfo.valid,
        plants: sessionInfo.valid ? req.session.portalSession.plants : undefined,
        companies: sessionInfo.valid ? req.session.portalSession.companies : undefined,
        username: sessionInfo.valid ? username : undefined,
        groupId: sessionInfo.valid ? groupId : undefined,
        groupName: sessionInfo.valid ? groupName : undefined,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/portal-logout
  router.post('/portal-logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  return router;
}
