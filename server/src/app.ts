import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { createRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { envConfig } from './config/env';

// Import session type augmentation
import './store/sessions';

export async function createApp(): Promise<express.Application> {
  const app = express();

  // Trust first proxy (K8s ingress / nginx) so secure cookies work behind HTTPS termination
  app.set('trust proxy', 1);

  // Middleware stack
  app.use(cors({
    origin: envConfig.CLIENT_ORIGIN,
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(session({
    secret: envConfig.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: envConfig.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  }));
  app.use(requestLogger);

  // API routes
  const routes = await createRoutes();
  app.use('/api', routes);

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
