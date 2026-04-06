import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  console.error(`[${req.method} ${req.path}]`, err.message || err);

  // Axios errors from upstream APIs (portal, monitoring, etc.)
  // NEVER forward upstream 401 as 401 to client — that's reserved for our own session auth.
  // Upstream failures are always 502 (bad gateway) from client's perspective.
  if (err.response) {
    const upstream = err.response;
    return res.status(502).json({
      code: 'UPSTREAM_ERROR',
      message: `Upstream API returned ${upstream.status}`,
      details: upstream.data,
    });
  }

  // Known app errors — only OUR middleware/sessionAuth produces 401
  if (err.code === 'MONITORING_NOT_AUTHENTICATED') {
    return res.status(502).json({
      code: 'MONITORING_AUTH_REQUIRED',
      message: 'Monitoring API authentication required. Please login via Settings.',
    });
  }

  if (err.code === 'PORTAL_NOT_AUTHENTICATED') {
    return res.status(401).json({
      code: 'PORTAL_AUTH_REQUIRED',
      message: 'Portal session expired. Please login again.',
    });
  }

  // Generic
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
  });
}
