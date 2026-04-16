-- Invert generation_forecast values: CSV stored them as negative,
-- but the system should use positive values.
UPDATE "EntityTimeSeries"
SET "value" = "value" * -1
WHERE "seriesKey" = 'generation_forecast';
