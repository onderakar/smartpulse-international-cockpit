import { createApp } from './app';
import { envConfig } from './config/env';

import { FileWatcherWorker } from './workers/fileWatcher.worker';
import { ScadaWorker } from './workers/scada.worker';
import { FileIngestionWorker } from './workers/fileIngestion.worker';
import { setupWebSocket } from './websocket';

async function main() {
  const app = await createApp();

  // Start HTTP server first so health checks pass while workers initialize
  const server = app.listen(envConfig.PORT, () => {
    console.log(`[SmartPulse International Cockpit Server]`);
    console.log(`  Environment: ${envConfig.NODE_ENV}`);
    console.log(`  Port:        ${envConfig.PORT}`);
    console.log(`  Portal:      ${envConfig.PORTAL_BASE_URL}`);
    console.log(`  Monitoring:  ${envConfig.MONITORING_BASE_URL}`);
    console.log(`  Ready.`);
  });

  // Attach Socket.io
  setupWebSocket(server);

  // Initialize workers in background
  const fileWatcher = new FileWatcherWorker();
  fileWatcher.start().catch(err => console.error('[FileWatcherWorker] Failed to start:', err));

  const scadaWorker = new ScadaWorker(envConfig.SCADA_POLL_INTERVAL_MS);
  scadaWorker.start().catch(err => console.error('[ScadaWorker] Failed to start:', err));

  const fileIngestionWorker = new FileIngestionWorker();
  fileIngestionWorker.start().catch(err => console.error('[FileIngestionWorker] Failed to start:', err));

  console.log('  Workers:     [STARTING]');
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
