import { Router } from 'express';
import { createAuthRoutes } from './auth.routes';
import { createFtpRoutes } from './ftp.routes';
import { createConfigRoutes } from './config.routes';
import { createScheduleRoutes } from './schedule.routes';
import { createForecastRoutes } from './forecast.routes';
import { PortalAuthService } from '../services/portalAuth.service';
import { FtpService } from '../services/ftp.service';
import { ConfigStoreService } from '../services/configStore.service';
import { ScheduleStoreService } from '../services/scheduleStore.service';
import { ForecastService } from '../services/forecast.service';

export async function createRoutes(): Promise<Router> {
  const router = Router();

  // Initialize services
  const portalAuth = new PortalAuthService();
  const ftpService = new FtpService();
  const configStore = new ConfigStoreService();
  const scheduleStore = new ScheduleStoreService();
  const forecastService = new ForecastService();

  // Initialize LowDB before mounting routes
  await configStore.init();
  await scheduleStore.init();

  // Mount route groups
  router.use('/auth', createAuthRoutes(portalAuth, configStore));
  router.use('/ftp', createFtpRoutes(ftpService));
  router.use('/config', createConfigRoutes(configStore, portalAuth));
  router.use('/schedule', createScheduleRoutes(ftpService, scheduleStore, configStore));
  router.use('/forecast', createForecastRoutes(forecastService));

  return router;
}
