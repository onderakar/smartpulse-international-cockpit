import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that checks if a portal session exists.
 * Rejects with 401 if not authenticated.
 */
export function sessionAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.portalSession) {
    return res.status(401).json({
      code: 'PORTAL_AUTH_REQUIRED',
      message: 'Not authenticated. Please login first.',
    });
  }
  next();
}
