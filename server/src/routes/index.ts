import { Router } from 'express';
import { createAuthRoutes } from './auth.routes';
import { createAutoMappingRoutes } from './autoMapping.routes';
import { createFtpRoutes } from './ftp.routes';
import { createMonitoringRoutes } from './monitoring.routes';
import { createPortfolioRoutes } from './portfolio.routes';
import { createConfigRoutes } from './config.routes';
import { createScheduleRoutes } from './schedule.routes';
import { createForecastRoutes } from './forecast.routes';
import { PortalAuthService } from '../services/portalAuth.service';
import { MonitoringAuthService } from '../services/monitoringAuth.service';
import { MonitoringService } from '../services/monitoring.service';
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
  const monitoringAuth = new MonitoringAuthService();
  const monitoringService = new MonitoringService();

  // Prisma-backed stores — no init needed

  // Mount route groups
  router.use('/auth', createAuthRoutes(portalAuth, configStore));
  router.use('/ftp', createFtpRoutes(ftpService, configStore));
  router.use('/config', createConfigRoutes(configStore, portalAuth));
  router.use('/schedule', createScheduleRoutes(ftpService, scheduleStore, configStore));
  router.use('/forecast', createForecastRoutes(forecastService));
  router.use('/auto-mapping', createAutoMappingRoutes(ftpService, configStore));
  router.use('/monitoring', createMonitoringRoutes(monitoringAuth, monitoringService));
  router.use('/portfolio', createPortfolioRoutes(configStore));

  return router;
}
