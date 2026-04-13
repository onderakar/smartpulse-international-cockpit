import { EventEmitter } from 'events';

class SystemEventBus extends EventEmitter { }

export const eventBus = new SystemEventBus();

// Specific Event Names
export const EVENTS = {
    METRICS_INGESTED: 'METRICS_INGESTED',
    MARKET_INGESTED: 'MARKET_INGESTED',
    FILE_UPDATED: 'FILE_UPDATED',
    BACKFILL_COMPLETE: 'BACKFILL_COMPLETE'
};
