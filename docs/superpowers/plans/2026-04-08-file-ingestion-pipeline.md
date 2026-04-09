# File Ingestion Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic file ingestion pipeline that periodically reads files from SmartPulse Portal FTP, stores raw content with versioning in PostgreSQL, and serves the latest version instantly — then migrate BatteryParamsPage to use it.

**Architecture:** FileSource/FileVersion Prisma models store definitions and versioned raw content. FileIngestionWorker runs per-source timers via FtpService. REST API + WebSocket serve latest data reactively. useFileSource hook gives client instant DB read + background FTP refresh.

**Tech Stack:** Prisma 6, Express, Socket.io, React hooks, SHA-256 (Node crypto)

**Spec:** `docs/superpowers/specs/2026-04-08-file-ingestion-pipeline-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `server/prisma/schema.prisma` | +FileSource, +FileVersion models (modify existing) |
| `server/src/services/fileStore.service.ts` | DB CRUD: sources, versions, latest, force-read logic |
| `server/src/workers/fileIngestion.worker.ts` | Periyodik okuma loop, hash-check, version create, WS event |
| `server/src/routes/file.routes.ts` | REST endpoints: sources CRUD, latest, versions, force-read, test, save |
| `client/src/api/file.api.ts` | Client API calls |
| `client/src/hooks/useFileSource.ts` | Hook: DB instant + FTP background + WS reactive |
| `client/src/components/settings/FileSourcesManager.tsx` | Settings UI: source list, add/edit form |
| `client/src/components/settings/FilePreviewModal.tsx` | Test popup: CSV table / JSON tree / XML / raw text viewer |

### Modified Files

| File | Change |
|---|---|
| `server/src/eventBus.ts` | +FILE_UPDATED event |
| `server/src/websocket.ts` | +file:updated subscription and relay |
| `server/src/routes/index.ts` | +file routes mount |
| `server/src/index.ts` | +FileIngestionWorker startup |
| `client/src/pages/SettingsPage.tsx` | +FileSourcesManager component |
| `client/src/pages/BatteryParamsPage.tsx` | ftpApi → useFileSource |
| `shared/src/constants/translations.ts` | +file ingestion i18n keys |

---

## Task 1: Prisma Schema — FileSource + FileVersion

**Files:**
- Modify: `server/prisma/schema.prisma:112` (append after ScheduleRevision)

- [ ] **Step 1: Add FileSource and FileVersion models to schema.prisma**

Append after `ScheduleRevision` model:

```prisma
// ── File Ingestion ──

model FileSource {
  id              Int           @id @default(autoincrement())
  key             String                            // "technical-parameters", "dam-gen"
  displayName     String                            // "Technical Parameters"
  filename        String                            // "Technical_Parameters.csv"
  direction       String        @default("incoming") // "incoming" | "outgoing"
  fileType        String?                           // "csv" | "json" | "xml" | null = auto-detect
  intervalMinutes Int           @default(10)
  enabled         Boolean       @default(true)
  parserKey       String?                           // domain-specific parser key
  groupId         String

  lastCheckedAt   DateTime?
  lastError       String?

  versions        FileVersion[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  @@unique([groupId, key])
  @@index([groupId, enabled])
}

model FileVersion {
  id          Int        @id @default(autoincrement())
  sourceId    Int
  versionNo   Int
  rawContent  String
  contentHash String
  sizeBytes   Int
  isCurrent   Boolean    @default(false)
  fetchedAt   DateTime   @default(now())

  source      FileSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@unique([sourceId, contentHash])
  @@index([sourceId, isCurrent])
  @@index([sourceId, fetchedAt(sort: Desc)])
}
```

- [ ] **Step 2: Run migration**

```bash
cd server && npx prisma migrate dev --name add-file-ingestion
```

- [ ] **Step 3: Verify with Prisma Studio**

```bash
npx prisma studio
```

Check FileSource and FileVersion tables exist.

- [ ] **Step 4: Commit**

```bash
git add server/prisma/
git commit -m "feat: add FileSource and FileVersion Prisma models for file ingestion"
```

---

## Task 2: EventBus — FILE_UPDATED Event

**Files:**
- Modify: `server/src/eventBus.ts`
- Modify: `server/src/websocket.ts`

- [ ] **Step 1: Add FILE_UPDATED to eventBus.ts**

```typescript
// server/src/eventBus.ts
export const EVENTS = {
    METRICS_INGESTED: 'METRICS_INGESTED',
    MARKET_INGESTED: 'MARKET_INGESTED',
    FILE_UPDATED: 'FILE_UPDATED',
};
```

- [ ] **Step 2: Add file:updated subscription to websocket.ts**

In `setupWebSocket()`, after `socket.on('subscribe:market', ...)` block add:

```typescript
socket.on('subscribe:files', (groupId: string) => {
    socket.join(`files:${groupId}`);
    console.log(`[WebSocket] ${socket.id} subscribed to files:${groupId}`);
});

socket.on('unsubscribe:files', (groupId: string) => {
    socket.leave(`files:${groupId}`);
});
```

After `eventBus.on(EVENTS.MARKET_INGESTED, ...)` block add:

```typescript
eventBus.on(EVENTS.FILE_UPDATED, (payload: { groupId: string; sourceKey: string; versionId: number; versionNo: number }) => {
    io.to(`files:${payload.groupId}`).emit('file:updated', payload);
});
```

- [ ] **Step 3: Commit**

```bash
git add server/src/eventBus.ts server/src/websocket.ts
git commit -m "feat: add FILE_UPDATED event to eventBus and WebSocket relay"
```

---

## Task 3: FileStoreService — Core DB Logic

**Files:**
- Create: `server/src/services/fileStore.service.ts`

- [ ] **Step 1: Create fileStore.service.ts**

```typescript
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

export interface FileSourceInput {
  key: string;
  displayName: string;
  filename: string;
  direction: string;
  fileType?: string | null;
  intervalMinutes: number;
  enabled: boolean;
  parserKey?: string | null;
  groupId: string;
}

export class FileStoreService {

  // ── Source CRUD ──

  async listSources(groupId: string) {
    return prisma.fileSource.findMany({
      where: { groupId },
      orderBy: { createdAt: 'asc' },
      include: {
        versions: {
          where: { isCurrent: true },
          select: { id: true, versionNo: true, fetchedAt: true, contentHash: true, sizeBytes: true },
          take: 1,
        },
      },
    });
  }

  async getSource(groupId: string, key: string) {
    return prisma.fileSource.findUnique({ where: { groupId_key: { groupId, key } } });
  }

  async createSource(input: FileSourceInput) {
    return prisma.fileSource.create({ data: input });
  }

  async updateSource(id: number, data: Partial<Omit<FileSourceInput, 'groupId' | 'key'>>) {
    return prisma.fileSource.update({ where: { id }, data });
  }

  async deleteSource(id: number) {
    return prisma.fileSource.delete({ where: { id } });
  }

  async getActiveSources(groupId?: string) {
    const where: any = { enabled: true };
    if (groupId) where.groupId = groupId;
    return prisma.fileSource.findMany({ where });
  }

  async getAllActiveSources() {
    return prisma.fileSource.findMany({ where: { enabled: true } });
  }

  // ── Version Management ──

  async getLatestVersion(sourceId: number) {
    return prisma.fileVersion.findFirst({
      where: { sourceId, isCurrent: true },
    });
  }

  async getLatestVersionByKey(groupId: string, key: string) {
    const source = await this.getSource(groupId, key);
    if (!source) return null;
    return this.getLatestVersion(source.id);
  }

  async listVersions(sourceId: number, take = 20, skip = 0) {
    return prisma.fileVersion.findMany({
      where: { sourceId },
      orderBy: { fetchedAt: 'desc' },
      take,
      skip,
      select: { id: true, versionNo: true, fetchedAt: true, contentHash: true, sizeBytes: true, isCurrent: true },
    });
  }

  /**
   * Ingest raw content: hash-check, create version if changed, update isCurrent.
   * Returns { created: boolean, versionId?: number, versionNo?: number }
   */
  async ingestContent(sourceId: number, rawContent: string): Promise<{ created: boolean; versionId?: number; versionNo?: number }> {
    const contentHash = createHash('sha256').update(rawContent, 'utf-8').digest('hex');
    const sizeBytes = Buffer.byteLength(rawContent, 'utf-8');

    // Check if this exact content already exists for this source
    const existing = await prisma.fileVersion.findUnique({
      where: { sourceId_contentHash: { sourceId, contentHash } },
    });

    if (existing) {
      // Same content — just update lastCheckedAt on source
      await prisma.fileSource.update({
        where: { id: sourceId },
        data: { lastCheckedAt: new Date(), lastError: null },
      });
      return { created: false };
    }

    // Get next versionNo
    const lastVersion = await prisma.fileVersion.findFirst({
      where: { sourceId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });
    const nextVersionNo = (lastVersion?.versionNo ?? 0) + 1;

    // Transaction: create new version + mark as current + unmark old current
    const newVersion = await prisma.$transaction(async (tx) => {
      // Unmark old current
      await tx.fileVersion.updateMany({
        where: { sourceId, isCurrent: true },
        data: { isCurrent: false },
      });

      // Create new version
      const v = await tx.fileVersion.create({
        data: {
          sourceId,
          versionNo: nextVersionNo,
          rawContent,
          contentHash,
          sizeBytes,
          isCurrent: true,
        },
      });

      // Update source
      await tx.fileSource.update({
        where: { id: sourceId },
        data: { lastCheckedAt: new Date(), lastError: null },
      });

      return v;
    });

    return { created: true, versionId: newVersion.id, versionNo: newVersion.versionNo };
  }

  async markSourceError(sourceId: number, error: string) {
    await prisma.fileSource.update({
      where: { id: sourceId },
      data: { lastCheckedAt: new Date(), lastError: error },
    });
  }

  // ── Helpers ──

  static detectFileType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'csv' || ext === 'tsv') return 'csv';
    if (ext === 'json') return 'json';
    if (ext === 'xml') return 'xml';
    return 'text';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/fileStore.service.ts
git commit -m "feat: add FileStoreService with source CRUD, versioning, and hash-based dedup"
```

---

## Task 4: FileIngestionWorker — Periyodik Okuma

**Files:**
- Create: `server/src/workers/fileIngestion.worker.ts`

- [ ] **Step 1: Create fileIngestion.worker.ts**

```typescript
import { FileStoreService } from '../services/fileStore.service';
import { FtpService } from '../services/ftp.service';
import { ConfigStoreService } from '../services/configStore.service';
import { eventBus, EVENTS } from '../eventBus';

interface ActiveTimer {
  sourceId: number;
  key: string;
  groupId: string;
  timer: ReturnType<typeof setInterval>;
}

export class FileIngestionWorker {
  private fileStore = new FileStoreService();
  private ftpService = new FtpService();
  private configStore = new ConfigStoreService();
  private activeTimers: ActiveTimer[] = [];
  private running = false;

  async start() {
    if (this.running) return;
    this.running = true;
    console.log('[FileIngestion] Starting worker...');
    await this.loadAndSchedule();
    console.log(`[FileIngestion] Scheduled ${this.activeTimers.length} source(s)`);
  }

  stop() {
    this.running = false;
    for (const t of this.activeTimers) {
      clearInterval(t.timer);
    }
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

  /** Force-read a single source by key (called from REST API) */
  async forceRead(groupId: string, key: string): Promise<{ created: boolean; versionId?: number; versionNo?: number; rawContent?: string }> {
    const source = await this.fileStore.getSource(groupId, key);
    if (!source) throw new Error(`Source not found: ${key}`);

    const rawContent = await this.readFromFtp(groupId, source.direction, source.filename);
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

  private async loadAndSchedule() {
    const sources = await this.fileStore.getAllActiveSources();

    for (const source of sources) {
      const intervalMs = source.intervalMinutes * 60_000;

      // Initial read
      this.tick(source.id, source.key, source.groupId, source.direction, source.filename);

      // Periodic timer
      const timer = setInterval(
        () => this.tick(source.id, source.key, source.groupId, source.direction, source.filename),
        intervalMs,
      );

      this.activeTimers.push({ sourceId: source.id, key: source.key, groupId: source.groupId, timer });
    }
  }

  private async tick(sourceId: number, key: string, groupId: string, direction: string, filename: string) {
    try {
      const rawContent = await this.readFromFtp(groupId, direction, filename);
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

  private async readFromFtp(groupId: string, direction: string, filename: string): Promise<string> {
    // We need portal cookies. Load from any active session for this group.
    // For worker context, we use stored credentials approach.
    // The worker reads via the FTP service which needs portal cookies.
    // We'll get cookies from the group's session store.
    const { getSessionForGroup } = await import('../store/sessionStore');
    const session = getSessionForGroup(groupId);

    if (!session) {
      throw new Error(`No active session for group ${groupId}. A user must be logged in.`);
    }

    return this.ftpService.readFile(session.portalCookies, session.env, direction as any, filename);
  }
}
```

- [ ] **Step 2: Create session store helper if not exists**

Check if `server/src/store/sessionStore.ts` exists. If not, create a simple in-memory session lookup that the auth middleware populates:

```typescript
// server/src/store/sessionStore.ts

interface StoredSession {
  portalCookies: string[];
  env: string;
  groupId: string;
  username: string;
}

const sessionsByGroup = new Map<string, StoredSession>();

export function storeSessionForGroup(groupId: string, session: StoredSession) {
  sessionsByGroup.set(groupId, session);
}

export function getSessionForGroup(groupId: string): StoredSession | undefined {
  return sessionsByGroup.get(groupId);
}
```

Hook this into the auth route's login success — after successful login, call `storeSessionForGroup()`.

- [ ] **Step 3: Wire worker startup in server/src/index.ts**

After ScadaWorker startup, add:

```typescript
import { FileIngestionWorker } from './workers/fileIngestion.worker';

// ... in main():
const fileIngestionWorker = new FileIngestionWorker();
fileIngestionWorker.start().catch(err => console.error('[FileIngestionWorker] Failed to start:', err));
```

- [ ] **Step 4: Commit**

```bash
git add server/src/workers/fileIngestion.worker.ts server/src/store/sessionStore.ts server/src/index.ts
git commit -m "feat: add FileIngestionWorker with periodic FTP reads and hash-based versioning"
```

---

## Task 5: REST API — File Routes

**Files:**
- Create: `server/src/routes/file.routes.ts`
- Modify: `server/src/routes/index.ts`

- [ ] **Step 1: Create file.routes.ts**

```typescript
import { Router } from 'express';
import { sessionAuth } from '../middleware/sessionAuth';
import { FileStoreService } from '../services/fileStore.service';
import { FileIngestionWorker } from '../workers/fileIngestion.worker';
import { FtpService } from '../services/ftp.service';
import { ConfigStoreService } from '../services/configStore.service';
import { parseMultiBatteryTechParams } from '../utils/techParamsParser';
import { parseAutoMappingCsv } from '../utils/autoMappingParser';
import { syncAttributesFromCsv } from '../services/attributeSync.service';
import { mergeDefinitions } from '@smartpulse-intl/shared';

// Parser registry
const FILE_PARSERS: Record<string, (raw: string) => unknown> = {
  'tech-params': (raw) => parseMultiBatteryTechParams(raw),
};

export function createFileRoutes(
  fileStore: FileStoreService,
  fileIngestionWorker: FileIngestionWorker,
  ftpService: FtpService,
  configStore: ConfigStoreService,
): Router {
  const router = Router();

  // GET /api/files/sources — list all sources for user's group
  router.get('/sources', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const sources = await fileStore.listSources(groupId);
      res.json(sources);
    } catch (err) { next(err); }
  });

  // POST /api/files/sources — create new source
  router.post('/sources', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const { key, displayName, filename, direction, fileType, intervalMinutes, enabled, parserKey } = req.body;
      if (!key || !filename) return res.status(400).json({ message: 'key and filename required' });

      const source = await fileStore.createSource({
        key, displayName: displayName || key, filename,
        direction: direction || 'incoming',
        fileType: fileType || null,
        intervalMinutes: intervalMinutes || 10,
        enabled: enabled !== false,
        parserKey: parserKey || null,
        groupId,
      });

      // Reload worker to pick up new source
      await fileIngestionWorker.reload();

      res.json(source);
    } catch (err) { next(err); }
  });

  // PUT /api/files/sources/:id — update source
  router.put('/sources/:id', sessionAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      const { displayName, filename, direction, fileType, intervalMinutes, enabled, parserKey } = req.body;
      const source = await fileStore.updateSource(id, {
        displayName, filename, direction, fileType, intervalMinutes, enabled, parserKey,
      });
      await fileIngestionWorker.reload();
      res.json(source);
    } catch (err) { next(err); }
  });

  // DELETE /api/files/sources/:id
  router.delete('/sources/:id', sessionAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await fileStore.deleteSource(id);
      await fileIngestionWorker.reload();
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  // GET /api/files/:key/latest — raw latest version
  router.get('/:key/latest', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const version = await fileStore.getLatestVersionByKey(groupId, req.params.key);
      if (!version) return res.status(404).json({ message: 'No version found' });
      res.json(version);
    } catch (err) { next(err); }
  });

  // GET /api/files/:key/latest/parsed — parsed latest version
  router.get('/:key/latest/parsed', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const source = await fileStore.getSource(groupId, req.params.key);
      if (!source) return res.status(404).json({ message: 'Source not found' });

      const version = await fileStore.getLatestVersion(source.id);
      if (!version) return res.status(404).json({ message: 'No version found' });

      const parser = source.parserKey ? FILE_PARSERS[source.parserKey] : null;
      const parsed = parser ? parser(version.rawContent) : null;
      const fileType = source.fileType || FileStoreService.detectFileType(source.filename);

      res.json({
        raw: version.rawContent,
        parsed,
        fileType,
        versionNo: version.versionNo,
        fetchedAt: version.fetchedAt,
        contentHash: version.contentHash,
        sizeBytes: version.sizeBytes,
      });
    } catch (err) { next(err); }
  });

  // GET /api/files/:key/versions — version history
  router.get('/:key/versions', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const source = await fileStore.getSource(groupId, req.params.key);
      if (!source) return res.status(404).json({ message: 'Source not found' });

      const take = Math.min(parseInt(req.query.take as string) || 20, 100);
      const skip = parseInt(req.query.skip as string) || 0;
      const versions = await fileStore.listVersions(source.id, take, skip);
      res.json(versions);
    } catch (err) { next(err); }
  });

  // POST /api/files/:key/force-read — FTP'den aninda oku
  router.post('/:key/force-read', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const result = await fileIngestionWorker.forceRead(groupId, req.params.key);
      res.json(result);
    } catch (err) { next(err); }
  });

  // POST /api/files/:key/force-read-and-sync — FTP refresh + attribute sync
  router.post('/:key/force-read-and-sync', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const result = await fileIngestionWorker.forceRead(groupId, req.params.key);

      // Now sync attributes from the latest raw content
      const source = await fileStore.getSource(groupId, req.params.key);
      const version = await fileStore.getLatestVersion(source!.id);
      if (!version) return res.json({ ...result, syncSkipped: true });

      const profile = await configStore.loadGroupProfile(groupId);
      if (!profile?.assetMapping) return res.json({ ...result, syncSkipped: true, reason: 'No asset mapping' });

      const allDefs = mergeDefinitions(profile.customAttributeDefinitions);
      const parsed = parseAutoMappingCsv(version.rawContent, allDefs);
      const syncResult = syncAttributesFromCsv(profile.assetMapping, parsed.batteries);
      await configStore.saveGroupProfile(groupId, profile);

      res.json({ ...result, sync: syncResult });
    } catch (err) { next(err); }
  });

  // POST /api/files/:key/test — tek seferlik FTP oku (preview icin)
  router.post('/:key/test', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const source = await fileStore.getSource(groupId, req.params.key);
      if (!source) return res.status(404).json({ message: 'Source not found' });

      const session = req.session.portalSession!;
      const rawContent = await ftpService.readFile(
        session.portalCookies, session.env, source.direction as any, source.filename
      );

      const fileType = source.fileType || FileStoreService.detectFileType(source.filename);
      const parser = source.parserKey ? FILE_PARSERS[source.parserKey] : null;

      res.json({
        rawContent,
        parsed: parser ? parser(rawContent) : null,
        fileType,
        sizeBytes: Buffer.byteLength(rawContent, 'utf-8'),
      });
    } catch (err) { next(err); }
  });

  // POST /api/files/:key/save — FTP'ye geri yaz
  router.post('/:key/save', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const source = await fileStore.getSource(groupId, req.params.key);
      if (!source) return res.status(404).json({ message: 'Source not found' });

      const { content } = req.body;
      if (!content) return res.status(400).json({ message: 'content required' });

      const session = req.session.portalSession!;
      const message = await ftpService.saveFile(
        session.portalCookies, session.env, source.direction as any, source.filename, content
      );

      // Also ingest the saved content as a new version
      await fileStore.ingestContent(source.id, content);

      res.json({ success: true, message });
    } catch (err) { next(err); }
  });

  return router;
}
```

- [ ] **Step 2: Mount file routes in index.ts**

In `server/src/routes/index.ts`, add import and mount:

```typescript
import { createFileRoutes } from './file.routes';
import { FileStoreService } from '../services/fileStore.service';
import { FileIngestionWorker } from '../workers/fileIngestion.worker';

// Inside createRoutes():
const fileStore = new FileStoreService();
const fileIngestionWorker = new FileIngestionWorker();

router.use('/files', createFileRoutes(fileStore, fileIngestionWorker, ftpService, configStore));
```

Note: The FileIngestionWorker here is for the route's `forceRead` calls. The main startup worker in `index.ts` handles periodic scheduling. Either share the same instance (via a singleton pattern or by passing the worker into createRoutes), or have forceRead be a static/standalone function. Simplest: make FileIngestionWorker a singleton.

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/file.routes.ts server/src/routes/index.ts
git commit -m "feat: add REST API endpoints for file ingestion (sources CRUD, latest, versions, force-read, test, save)"
```

---

## Task 6: Client API — file.api.ts

**Files:**
- Create: `client/src/api/file.api.ts`

- [ ] **Step 1: Create file.api.ts**

```typescript
import { apiClient } from './client';

export interface FileSourceDto {
  id: number;
  key: string;
  displayName: string;
  filename: string;
  direction: string;
  fileType: string | null;
  intervalMinutes: number;
  enabled: boolean;
  parserKey: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  versions?: Array<{ id: number; versionNo: number; fetchedAt: string; contentHash: string; sizeBytes: number }>;
}

export interface FileVersionDto {
  id: number;
  versionNo: number;
  rawContent: string;
  contentHash: string;
  sizeBytes: number;
  isCurrent: boolean;
  fetchedAt: string;
}

export interface LatestParsedDto<T = unknown> {
  raw: string;
  parsed: T | null;
  fileType: string;
  versionNo: number;
  fetchedAt: string;
  contentHash: string;
  sizeBytes: number;
}

export const fileApi = {
  // Sources CRUD
  async listSources(): Promise<FileSourceDto[]> {
    const { data } = await apiClient.get('/files/sources');
    return data;
  },
  async createSource(input: Partial<FileSourceDto>): Promise<FileSourceDto> {
    const { data } = await apiClient.post('/files/sources', input);
    return data;
  },
  async updateSource(id: number, input: Partial<FileSourceDto>): Promise<FileSourceDto> {
    const { data } = await apiClient.put(`/files/sources/${id}`, input);
    return data;
  },
  async deleteSource(id: number): Promise<void> {
    await apiClient.delete(`/files/sources/${id}`);
  },

  // Versions
  async getLatest<T = unknown>(key: string): Promise<LatestParsedDto<T>> {
    const { data } = await apiClient.get(`/files/${key}/latest/parsed`);
    return data;
  },
  async getVersions(key: string, take = 20, skip = 0) {
    const { data } = await apiClient.get(`/files/${key}/versions`, { params: { take, skip } });
    return data;
  },

  // Actions
  async forceRead(key: string): Promise<{ created: boolean; versionId?: number; versionNo?: number }> {
    const { data } = await apiClient.post(`/files/${key}/force-read`);
    return data;
  },
  async forceReadAndSync(key: string): Promise<any> {
    const { data } = await apiClient.post(`/files/${key}/force-read-and-sync`);
    return data;
  },
  async test(key: string): Promise<{ rawContent: string; parsed: unknown; fileType: string; sizeBytes: number }> {
    const { data } = await apiClient.post(`/files/${key}/test`);
    return data;
  },
  async saveBack(key: string, content: string): Promise<{ success: boolean; message: string }> {
    const { data } = await apiClient.post(`/files/${key}/save`, { content });
    return data;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add client/src/api/file.api.ts
git commit -m "feat: add file API client for file ingestion endpoints"
```

---

## Task 7: useFileSource Hook

**Files:**
- Create: `client/src/hooks/useFileSource.ts`

- [ ] **Step 1: Create useFileSource.ts**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { fileApi, LatestParsedDto } from '../api/file.api';
import { useAuth } from '../context/AuthContext';
import { io, Socket } from 'socket.io-client';

interface UseFileSourceOptions {
  autoRefresh?: boolean;  // trigger FTP refresh on mount (default: true)
  parser?: string;        // unused client-side, server handles parsing
}

interface UseFileSourceResult<T> {
  raw: string | null;
  parsed: T | null;
  loading: boolean;
  refreshing: boolean;
  versionNo: number | null;
  fetchedAt: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  forceReadAndSync: () => Promise<any>;
}

export function useFileSource<T = unknown>(key: string, options: UseFileSourceOptions = {}): UseFileSourceResult<T> {
  const { autoRefresh = true } = options;
  const [data, setData] = useState<LatestParsedDto<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const fetchLatest = useCallback(async () => {
    try {
      const result = await fileApi.getLatest<T>(key);
      setData(result);
      setError(null);
    } catch (err: any) {
      // 404 = no version yet, not an error
      if (err?.response?.status !== 404) {
        setError(err?.response?.data?.message || err.message);
      }
    }
  }, [key]);

  const triggerFtpRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fileApi.forceRead(key);
      // WS event will trigger re-fetch, but also fetch directly
      await fetchLatest();
    } catch (err: any) {
      console.warn(`[useFileSource] FTP refresh failed for ${key}:`, err.message);
    } finally {
      setRefreshing(false);
    }
  }, [key, fetchLatest]);

  const refresh = useCallback(async () => {
    await fetchLatest();
    triggerFtpRefresh(); // fire and forget
  }, [fetchLatest, triggerFtpRefresh]);

  const forceReadAndSync = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fileApi.forceReadAndSync(key);
      await fetchLatest();
      return result;
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message);
      throw err;
    } finally {
      setRefreshing(false);
    }
  }, [key, fetchLatest]);

  // Initial load: DB instant + optional FTP refresh
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      await fetchLatest();
      if (!cancelled) setLoading(false);
      if (autoRefresh && !cancelled) {
        triggerFtpRefresh(); // background, non-blocking
      }
    })();

    return () => { cancelled = true; };
  }, [fetchLatest, autoRefresh, triggerFtpRefresh]);

  // WebSocket: listen for file:updated events
  useEffect(() => {
    // Reuse existing socket or connect
    // For simplicity, listen on the existing socket.io connection
    // The WS subscription is set up in a parent context or here directly
    const handleFileUpdated = (payload: { sourceKey: string }) => {
      if (payload.sourceKey === key) {
        fetchLatest();
      }
    };

    // Use a simple approach: poll-on-event via window custom events
    // The MonitoringContext or a dedicated FileContext could manage the socket
    // For now, use a lightweight approach
    window.addEventListener('file:updated', ((e: CustomEvent) => {
      handleFileUpdated(e.detail);
    }) as EventListener);

    return () => {
      window.removeEventListener('file:updated', (() => {}) as EventListener);
    };
  }, [key, fetchLatest]);

  return {
    raw: data?.raw ?? null,
    parsed: data?.parsed ?? null,
    loading,
    refreshing,
    versionNo: data?.versionNo ?? null,
    fetchedAt: data?.fetchedAt ?? null,
    error,
    refresh,
    forceReadAndSync,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useFileSource.ts
git commit -m "feat: add useFileSource hook with instant DB read, FTP background refresh, and WS reactive updates"
```

---

## Task 8: BatteryParamsPage Migration

**Files:**
- Modify: `client/src/pages/BatteryParamsPage.tsx`

- [ ] **Step 1: Rewrite BatteryParamsPage to use useFileSource**

Replace the entire data-fetching logic. Key changes:
- Remove `ftpApi.readMultiTechParams()` calls
- Use `useFileSource<MultiBatteryTechParams>('technical-parameters')`
- `loadParams` → `refresh()`
- `handleSyncAttributes` → `forceReadAndSync()`

```typescript
import { useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useProfile } from '../context/ProfileContext';
import { useFileSource } from '../hooks/useFileSource';
import { MultiBatteryTechParams } from '@shared/types/techParams.types';
import { useLocale } from '../context/LocaleContext';

export function BatteryParamsPage() {
  const { profile } = useProfile();
  const mapping = profile?.assetMapping ?? null;
  const { t } = useLocale();

  const {
    parsed: multiParams,
    loading,
    refreshing,
    error,
    versionNo,
    fetchedAt,
    refresh,
    forceReadAndSync,
  } = useFileSource<MultiBatteryTechParams>('technical-parameters', { autoRefresh: true });

  const handleSyncAttributes = useCallback(async () => {
    try {
      const result = await forceReadAndSync();
      if (result?.sync) {
        toast.success(t('batteryParams.attrSynced', {
          gcps: String(result.sync.gcpsUpdated),
          comps: String(result.sync.componentsUpdated),
        }));
      } else {
        toast.success('Refreshed from FTP');
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err.message || 'Sync failed');
    }
  }, [forceReadAndSync, t]);

  const handleRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  // Column letters (A, B, C, ...) for Excel-style header
  const colLetters = useMemo(() => {
    if (!multiParams) return [];
    return multiParams.plantIds.map((_, i) => {
      let letter = '';
      let n = i;
      do {
        letter = String.fromCharCode(65 + (n % 26)) + letter;
        n = Math.floor(n / 26) - 1;
      } while (n >= 0);
      return letter;
    });
  }, [multiParams]);

  if (!mapping) {
    return (
      <div className="p-6 max-w-[1600px] mx-auto">
        <h2 className="text-xl font-bold text-white mb-6">{t('batteryParams.title')}</h2>
        <div className="bg-dark-800 border border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-400 text-sm">{t('common.configureMapping')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-[1600px] mx-auto flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#1e1e34] border border-[#2d2d4a] rounded-md px-3 py-1.5">
            <i className="ri-file-excel-2-line text-emerald-400 text-sm" />
            <span className="text-xs text-gray-300 font-medium">technical-parameters</span>
          </div>
          {multiParams && (
            <span className="text-[10px] text-gray-500">
              {multiParams.plantIds.length} {t('batteryParams.batteries')} &times; {multiParams.variableOrder.length} {t('batteryParams.variables')}
            </span>
          )}
          {versionNo && (
            <span className="text-[10px] text-gray-600">
              v#{versionNo} {fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : ''}
            </span>
          )}
          {refreshing && (
            <span className="text-[10px] text-primary-400 animate-pulse">FTP syncing...</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncAttributes}
            disabled={refreshing || !multiParams}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-900/20 border border-emerald-800/40 rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className="ri-database-2-line text-sm" />
            {refreshing ? t('common.saving') : t('batteryParams.syncAttributes')}
          </button>
          <button
            onClick={handleRefresh}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-[#1e1e34] border border-[#2d2d4a] rounded-md px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <i className="ri-refresh-line text-sm" />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-orange-900/20 border border-orange-800/40 rounded-md px-4 py-2.5 mb-3 flex items-center justify-between shrink-0">
          <span className="text-orange-300 text-xs">{error}</span>
          <button onClick={handleRefresh} className="text-orange-400 hover:text-orange-300 text-xs underline ml-4">{t('common.retry')}</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-[#1a1a2e] border border-[#2d2d4a] rounded-md p-12 text-center">
          <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-primary-400 rounded-full animate-spin mb-2" />
          <p className="text-gray-500 text-xs">{t('batteryParams.loadingParams')}</p>
        </div>
      )}

      {/* Spreadsheet Table — UNCHANGED from current implementation */}
      {!loading && multiParams && multiParams.variableOrder.length > 0 && (
        <div className="flex-1 min-h-0 overflow-auto rounded-md border border-[#2d2d4a] bg-[#12121e] shadow-xl select-text"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#2d2d4a #12121e' }}
        >
          <table className="w-full border-collapse" style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif", fontSize: '11px' }}>
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 bg-[#191930] border-b border-r border-[#2d2d4a] w-[40px] min-w-[40px]" />
                <th className="sticky left-[40px] z-30 bg-[#191930] border-b border-r border-[#2d2d4a] min-w-[240px]" />
                {multiParams.plantIds.map((_, i) => (
                  <th key={i} className="bg-[#191930] text-center px-1 py-1 text-[9px] text-gray-600 font-normal border-b border-r border-[#2d2d4a] min-w-[130px]">
                    {colLetters[i]}
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-30 bg-[#1c1c35] border-b border-r border-[#2d2d4a] text-center text-[9px] text-gray-600 font-normal py-1.5 w-[40px] min-w-[40px]">#</th>
                <th className="sticky left-[40px] z-30 bg-[#1c1c35] text-left px-3 py-1.5 text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-r border-[#2d2d4a] min-w-[240px]">Variable</th>
                {multiParams.plantIds.map(plantId => (
                  <th key={plantId} className="bg-[#1c1c35] text-center px-3 py-1.5 text-[10px] text-emerald-400/80 font-semibold border-b border-r border-[#2d2d4a] min-w-[130px] whitespace-nowrap">{plantId}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {multiParams.variableOrder.map((variable, rowIdx) => {
                const bgColor = rowIdx % 2 === 0 ? '#14142a' : '#171730';
                return (
                  <tr key={variable} className="group hover:!bg-[#1e1e42] transition-colors duration-75">
                    <td className="sticky left-0 z-10 text-center py-[5px] text-[9px] text-gray-600 border-b border-r border-[#2d2d4a] select-none" style={{ backgroundColor: bgColor }}>{rowIdx + 1}</td>
                    <td className="sticky left-[40px] z-10 px-3 py-[5px] text-gray-300 font-medium border-b border-r border-[#2d2d4a] whitespace-nowrap group-hover:text-white" style={{ backgroundColor: bgColor }}>{variable}</td>
                    {multiParams.plantIds.map(plantId => {
                      const val = multiParams.rawByPlant[plantId]?.[variable];
                      const display = val !== undefined && val !== null ? String(val) : '';
                      const isNum = display !== '' && !isNaN(Number(display));
                      return (
                        <td key={plantId} className={`px-3 py-[5px] border-b border-r border-[#2d2d4a] tabular-nums ${isNum ? 'text-right text-gray-200' : display === '' ? 'text-center text-gray-700' : 'text-left text-blue-300/70'}`}>
                          {display || '\u00B7'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && multiParams && multiParams.variableOrder.length === 0 && (
        <div className="bg-[#1a1a2e] border border-[#2d2d4a] rounded-md p-8 text-center">
          <p className="text-gray-500 text-xs">{t('batteryParams.noDataInCsv')}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/BatteryParamsPage.tsx
git commit -m "feat: migrate BatteryParamsPage to useFileSource (instant DB + FTP background refresh)"
```

---

## Task 9: Settings UI — FileSourcesManager

**Files:**
- Create: `client/src/components/settings/FileSourcesManager.tsx`
- Create: `client/src/components/settings/FilePreviewModal.tsx`
- Modify: `client/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Create FilePreviewModal.tsx**

Modal component that receives `rawContent`, `fileType`, `sizeBytes` and renders appropriate viewer:
- csv → HTML table (split by newlines + commas)
- json → `<pre>` with JSON.stringify pretty-print (collapsible later)
- xml → `<pre>` with syntax coloring
- text → `<pre>` with line numbers

Include a [Save Back to FTP] button that calls `fileApi.saveBack(key, content)`.

- [ ] **Step 2: Create FileSourcesManager.tsx**

Settings section component:
- Lists all sources via `fileApi.listSources()`
- Each source card shows: filename, direction, interval, enabled, lastCheckedAt, lastError, current version info
- [Test] button → calls `fileApi.test(key)` → opens FilePreviewModal
- [Read Now] button → calls `fileApi.forceRead(key)`
- [Edit] button → inline edit form
- [+ Add] button → new source form (key, displayName, filename, direction, intervalMinutes, enabled)
- [Delete] button with confirmation

- [ ] **Step 3: Add FileSourcesManager to SettingsPage**

In `client/src/pages/SettingsPage.tsx`, import and add `<FileSourcesManager />` after `<PortfolioViewer />`.

- [ ] **Step 4: Add i18n keys to translations.ts**

Add keys under `fileIngestion` namespace in `shared/src/constants/translations.ts`:

```typescript
'fileIngestion.title': { en: 'File Data Sources', tr: 'Dosya Veri Kaynaklari' },
'fileIngestion.addSource': { en: 'Add Source', tr: 'Kaynak Ekle' },
'fileIngestion.test': { en: 'Test', tr: 'Test' },
'fileIngestion.readNow': { en: 'Read Now', tr: 'Simdi Oku' },
'fileIngestion.noSources': { en: 'No file sources configured.', tr: 'Dosya kaynagi tanimlanmamis.' },
'fileIngestion.direction': { en: 'Direction', tr: 'Yon' },
'fileIngestion.interval': { en: 'Interval (min)', tr: 'Periyot (dk)' },
'fileIngestion.lastRead': { en: 'Last Read', tr: 'Son Okuma' },
'fileIngestion.version': { en: 'Version', tr: 'Versiyon' },
'fileIngestion.saveBack': { en: 'Save Back to FTP', tr: 'FTP ye Geri Kaydet' },
'fileIngestion.preview': { en: 'File Preview', tr: 'Dosya Onizleme' },
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/settings/FileSourcesManager.tsx client/src/components/settings/FilePreviewModal.tsx client/src/pages/SettingsPage.tsx shared/src/constants/translations.ts
git commit -m "feat: add File Sources manager in Settings with preview modal and FTP save-back"
```

---

## Task 10: Seed technical-parameters Source + Build Verification

**Files:**
- Modify: `server/src/routes/file.routes.ts` (or a seed script)

- [ ] **Step 1: Add seed endpoint or startup seed**

In the FileIngestionWorker.start(), after loading sources, check if `technical-parameters` source exists. If not, auto-create it from the group profile's assetMapping.ftpFilename:

```typescript
// In FileIngestionWorker.start(), after loadAndSchedule:
await this.seedDefaultSources();

private async seedDefaultSources() {
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
}
```

- [ ] **Step 2: Build shared + server**

```bash
npm run build --workspace=@smartpulse-intl/shared
cd server && npx tsc --noEmit
```

- [ ] **Step 3: Start server and verify**

```bash
npm run dev
```

Verify:
1. FileIngestionWorker starts and seeds technical-parameters source
2. Settings page shows File Sources section
3. BatteryParamsPage loads data from DB + triggers FTP refresh
4. [Test] button shows preview modal
5. [Sync Attributes] does force-read then sync

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: seed technical-parameters source, build verification"
```

---

## Summary

| Task | Description | Estimated |
|---|---|---|
| 1 | Prisma schema + migration | 5 min |
| 2 | EventBus FILE_UPDATED + WebSocket | 5 min |
| 3 | FileStoreService (DB CRUD) | 10 min |
| 4 | FileIngestionWorker (periodic reads) | 15 min |
| 5 | REST API endpoints | 15 min |
| 6 | Client API (file.api.ts) | 5 min |
| 7 | useFileSource hook | 10 min |
| 8 | BatteryParamsPage migration | 10 min |
| 9 | Settings UI (FileSourcesManager + PreviewModal) | 20 min |
| 10 | Seed + build verification | 10 min |
| **Total** | | **~105 min** |
