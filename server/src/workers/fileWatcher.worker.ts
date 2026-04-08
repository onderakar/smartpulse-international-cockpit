import { watch } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { envConfig } from '../config/env';

export class FileWatcherWorker {
    private watcher: any = null;
    private watchDir: string;

    constructor() {
        // We assume FTP syncs drop files into a known directory.
        // For now, we watch the directory where the Node app runs, or a specific `data/ftp` folder.
        this.watchDir = path.resolve(__dirname, '../../data/ftp');
    }

    async start() {
        // Ensure directory exists
        try {
            await fs.mkdir(this.watchDir, { recursive: true });
        } catch (e) {
            console.error('[FileWatcherWorker] Failed to create FTP watch directory', e);
            return;
        }

        console.log(`[FileWatcherWorker] Started watching ${this.watchDir} for CSV changes`);

        this.watcher = watch(this.watchDir, async (eventType, filename) => {
            if (!filename || !filename.endsWith('.csv')) return;
            if (eventType !== 'change' && eventType !== 'rename') return;

            console.log(`[FileWatcherWorker] Detected change in ${filename}. Ingesting Data...`);
            try {
                const filePath = path.join(this.watchDir, filename);

                // Minor debounce to ensure file is fully written by the OS before reading
                setTimeout(async () => {
                    try {
                        const stat = await fs.stat(filePath);
                        if (stat.isFile()) {
                            const content = await fs.readFile(filePath, 'utf-8');

                            // If this is the Technical Parameters file
                            if (filename.toLowerCase().includes('technical_parameters')) {
                                // TODO: sync metadata when Prisma/DB integration is set up
                                console.log(`[FileWatcherWorker] Detected Technical_Parameters update: ${filename}`);
                            }
                            // Add parsing for battery plans, OSOS CSVs etc. here
                        }
                    } catch (err: any) {
                        console.error(`[FileWatcherWorker] Error processing file ${filename}:`, err.message);
                    }
                }, 500);

            } catch (err: any) {
                console.error(`[FileWatcherWorker] Watcher sequence failed`, err.message);
            }
        });
    }

    stop() {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        console.log('[FileWatcherWorker] Stopped');
    }
}
