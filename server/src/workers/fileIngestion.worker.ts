import { FileStoreService } from '../services/fileStore.service';
import { FtpService } from '../services/ftp.service';
import { ConfigStoreService } from '../services/configStore.service';
import { getCachedGroupSession } from '../store/groupSessionCache';
import { eventBus, EVENTS } from '../eventBus';

interface ActiveTimer {
  sourceId: number;
  key: string;
  groupId: string;
  timer: ReturnType<typeof setInterval>;
}

export class FileIngestionWorker {
  private fileStore: FileStoreService;
  private ftpService: FtpService;
  private configStore: ConfigStoreService;
  private activeTimers: ActiveTimer[] = [];
  private running = false;

  constructor(
    fileStore?: FileStoreService,
    ftpService?: FtpService,
    configStore?: ConfigStoreService,
  ) {
    this.fileStore = fileStore ?? new FileStoreService();
    this.ftpService = ftpService ?? new FtpService();
    this.configStore = configStore ?? new ConfigStoreService();
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log('[FileIngestion] Starting worker...');
    await this.seedDefaultSources();
    await this.loadAndSchedule();
    console.log(`[FileIngestion] Scheduled ${this.activeTimers.length} source(s)`);
  }

  stop() {
    this.running = false;
    for (const t of this.activeTimers) clearInterval(t.timer);
    this.activeTimers = [];
    console.log('[FileIngestion] Stopped');
  }

  /** Reload source definitions and restart timers */
  async reload() {
    this.stop();
    this.running = true;
    await this.loadAndSchedule();
    console.log(`[FileIngestion] Reloaded ${this.activeTimers.length} source(s)`);
  }

  /** Force-read a single source by key (called from REST API with request cookies) */
  async forceReadWithCookies(
    groupId: string,
    key: string,
    portalCookies: string[],
    env: string,
  ): Promise<{ created: boolean; versionId?: number; versionNo?: number; rawContent?: string }> {
    const source = await this.fileStore.getSource(groupId, key);
    if (!source) throw new Error(`Source not found: ${key}`);

    const rawContent = await this.ftpService.readFile(portalCookies, env, source.direction as any, source.filename);
    const result = await this.fileStore.ingestContent(source.id, rawContent);

    if (result.created) {
      eventBus.emit(EVENTS.FILE_UPDATED, {
        groupId,
        sourceKey: key,
        versionId: result.versionId,
        versionNo: result.versionNo,
      });
      console.log(`[FileIngestion] ${key}: new version #${result.versionNo}`);
    } else {
      console.log(`[FileIngestion] ${key}: no change`);
    }

    return { ...result, rawContent };
  }

  // ── Private ──

  private async seedDefaultSources() {
    try {
      const allProfiles = await this.configStore.loadAllGroupProfiles();
      for (const [groupId, profile] of Object.entries(allProfiles)) {
        const existing = await this.fileStore.getSource(groupId, 'technical-parameters');
        if (!existing && profile.assetMapping?.ftpFilename) {
          await this.fileStore.createSource({
            key: 'technical-parameters',
            displayName: 'Technical Parameters',
            filename: profile.assetMapping.ftpFilename,
            direction: profile.assetMapping.ftpDirection || 'incoming',
            intervalMinutes: 10,
            enabled: true,
            parserKey: 'tech-params',
            groupId,
          });
          console.log(`[FileIngestion] Seeded technical-parameters for group ${groupId}`);
        }
      }
    } catch (err: any) {
      console.warn(`[FileIngestion] Seed failed: ${err.message}`);
    }
  }

  private async loadAndSchedule() {
    const sources = await this.fileStore.getAllActiveSources();

    for (const source of sources) {
      const intervalMs = Math.max(source.intervalMinutes * 60_000, 60_000); // min 1 minute

      // Periodic timer (first tick after interval — initial read happens on user's first page load via force-read)
      const timer = setInterval(
        () => this.tick(source.id, source.key, source.groupId, source.direction, source.filename),
        intervalMs,
      );

      this.activeTimers.push({ sourceId: source.id, key: source.key, groupId: source.groupId, timer });
    }
  }

  private async tick(sourceId: number, key: string, groupId: string, direction: string, filename: string) {
    const session = getCachedGroupSession(groupId);
    if (!session) {
      // No user logged in for this group yet — skip silently
      return;
    }

    try {
      const rawContent = await this.ftpService.readFile(session.portalCookies, session.env, direction as any, filename);
      const result = await this.fileStore.ingestContent(sourceId, rawContent);

      if (result.created) {
        eventBus.emit(EVENTS.FILE_UPDATED, {
          groupId,
          sourceKey: key,
          versionId: result.versionId,
          versionNo: result.versionNo,
        });
        console.log(`[FileIngestion] ${key}: new version #${result.versionNo}`);
      }
    } catch (err: any) {
      console.error(`[FileIngestion] ${key}: error — ${err.message}`);
      await this.fileStore.markSourceError(sourceId, err.message).catch(() => {});
    }
  }
}
