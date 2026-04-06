import { Router } from 'express';
import { ForecastService } from '../services/forecast.service';
import { sessionAuth } from '../middleware/sessionAuth';

const RESERVED_PROVIDERS = ['userforecast', 'finalforecast', 'epiasforecast'];

export function createForecastRoutes(forecastService: ForecastService): Router {
  const router = Router();

  // POST /api/forecast/values — Get provider forecast for a power plant
  router.post('/values', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const { companyId, powerPlantId, provider, startDate, endDate, minute, hour, columnId } = req.body;

      if (!companyId || !powerPlantId || !provider || !startDate || !endDate) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'companyId, powerPlantId, provider, startDate, and endDate are required',
        });
      }

      const data = await forecastService.getPowerPlantValues(
        session.portalCookies,
        session.env,
        {
          companyId,
          powerPlantId,
          provider,
          startDate,
          endDate,
          minute: minute ?? 0,
          hour,
          columnId,
        },
      );
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/forecast/submit — Submit forecast as a forecast provider
  // Auth: Session cookie (same as other portal endpoints)
  // URL:  POST portal/api/production-forecast/forecasts/resolution/{providerName}
  router.post('/submit', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const { providerName, measureUnit, description, forecasts } = req.body;

      if (!providerName || !forecasts || !Array.isArray(forecasts) || forecasts.length === 0) {
        return res.status(400).json({
          code: 'INVALID_REQUEST',
          message: 'providerName and forecasts array are required',
        });
      }

      if (RESERVED_PROVIDERS.includes(providerName.toLowerCase())) {
        return res.status(400).json({
          code: 'RESERVED_PROVIDER',
          message: 'Bu provider adina gonderim yapilamaz / Cannot submit to this provider name',
        });
      }

      if (!session.portalCookies || session.portalCookies.length === 0) {
        return res.status(401).json({
          code: 'NO_SESSION',
          message: 'Portal session cookies not found. Please log in again.',
        });
      }

      const submissionBody = {
        measureUnit: measureUnit ?? 1,
        description: description ?? '',
        forecasts,
      };

      console.log(`[Forecast] Submitting to provider="${providerName}", env=${session.env}, units=${forecasts.length}, predictions=${forecasts[0]?.predictions?.length ?? 0}`);
      console.log(`[Forecast] Request payload:`, JSON.stringify(submissionBody, null, 2));

      const data = await forecastService.submitForecast(
        session.portalCookies,
        session.env,
        providerName,
        submissionBody,
      );

      // The API wraps response in BaseResponse: { ReplyObject, isError, ErrorMessage, ... }
      // Portal statusCode patterns:
      //   '1200' / Status1200Success = full success
      //   '1210' / Status1210PartialSuccess = some accepted, existing ones skipped
      const statusStr = String(data?.status || '');
      const statusCode = String(data?.statusCode || '');
      const isPortalSuccess = statusStr.includes('Success') || statusCode === '1200' || statusCode === '1210';
      const success = data === true
        || data?.ReplyObject === true
        || isPortalSuccess
        || (typeof data === 'object' && data !== null && data?.isError === false);

      // Collect all error details from portal response
      const errors = data?.Errors || data?.errors || [];
      const errorMessages: string[] = [];
      if (Array.isArray(errors)) {
        for (const e of errors) {
          if (typeof e === 'string') errorMessages.push(e);
          else if (e?.Message || e?.message) errorMessages.push(e.Message || e.message);
          else if (e?.ErrorMessage) errorMessages.push(e.ErrorMessage);
          else errorMessages.push(JSON.stringify(e));
        }
      }
      const portalMessage = data?.ErrorMessage || data?.Message || data?.message || '';
      const fullMessage = errorMessages.length > 0
        ? `${portalMessage} | ${errorMessages.join(' | ')}`
        : portalMessage;

      console.log(`[Forecast] Submit response: success=${success}, isPortalSuccess=${isPortalSuccess}, statusCode=${statusCode}, status=${statusStr}, ReplyObject=${data?.ReplyObject}, isError=${data?.isError}`);
      console.log(`[Forecast] Raw portal data:`, JSON.stringify(data));

      if (!success) {
        console.error(`[Forecast] Portal errors:`, JSON.stringify(errors));
        console.error(`[Forecast] Portal returned non-success. ReplyObject=${data?.ReplyObject}, isError=${data?.isError}, ErrorMessage=${portalMessage}, Errors=${errorMessages.join('; ')}`);
      }

      res.json({ success, data, message: fullMessage || (success ? 'OK' : 'Portal did not confirm success') });
    } catch (err: any) {
      const status = err.response?.status;
      const detail = err.response?.data;
      console.error(`[Forecast] Submit failed: HTTP ${status}`, JSON.stringify(detail) || err.message);
      res.status(status || 500).json({
        code: 'FORECAST_SUBMIT_ERROR',
        message: `Forecast submission failed (HTTP ${status || 'unknown'}): ${typeof detail === 'string' ? detail : JSON.stringify(detail) || err.message}`,
      });
    }
  });

  return router;
}
