import { Router } from 'express';
import { sessionAuth } from '../middleware/sessionAuth';
import { FileStoreService } from '../services/fileStore.service';
import { FileIngestionWorker } from '../workers/fileIngestion.worker';
import { FtpService } from '../services/ftp.service';
import { ConfigStoreService } from '../services/configStore.service';
import { parseMultiBatteryTechParams } from '../utils/techParamsParser';
import { parseDamGenCsv } from '../utils/damGenParser';
import { parseAutoMappingCsv } from '../utils/autoMappingParser';
import { syncAttributesFromCsv } from '../services/attributeSync.service';
import { mergeDefinitions } from '@smartpulse-intl/shared';

// Parser registry — domain-specific parsers for known file types
const FILE_PARSERS: Record<string, (raw: string) => unknown> = {
  'tech-params': (raw) => parseMultiBatteryTechParams(raw),
  'dam-gen': (raw) => parseDamGenCsv(raw),
};

export function createFileRoutes(
  fileStore: FileStoreService,
  fileIngestionWorker: FileIngestionWorker,
  ftpService: FtpService,
  configStore: ConfigStoreService,
): Router {
  const router = Router();

  // ── Source CRUD ──

  // GET /api/files/sources
  router.get('/sources', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const sources = await fileStore.listSources(groupId);
      res.json(sources);
    } catch (err) { next(err); }
  });

  // POST /api/files/sources
  router.post('/sources', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const { key, displayName, filename, direction, fileType, intervalMinutes, enabled, parserKey } = req.body;
      if (!key || !filename) return res.status(400).json({ message: 'key and filename required' });

      const source = await fileStore.createSource({
        key,
        displayName: displayName || key,
        filename,
        direction: direction || 'incoming',
        fileType: fileType || null,
        intervalMinutes: intervalMinutes || 10,
        enabled: enabled !== false,
        parserKey: parserKey || null,
        groupId,
      });

      await fileIngestionWorker.reload();
      res.json(source);
    } catch (err) { next(err); }
  });

  // PUT /api/files/sources/:id
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

  // ── Version Access ──

  // GET /api/files/:key/latest
  router.get('/:key/latest', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const version = await fileStore.getLatestVersionByKey(groupId, req.params.key);
      if (!version) return res.status(404).json({ message: 'No version found' });
      res.json(version);
    } catch (err) { next(err); }
  });

  // GET /api/files/:key/latest/parsed
  router.get('/:key/latest/parsed', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const source = await fileStore.getSource(groupId, req.params.key);
      if (!source) return res.status(404).json({ message: 'Source not found' });

      const version = await fileStore.getLatestVersion(source.id);
      if (!version) return res.status(404).json({ message: 'No version found' });

      const parser = source.parserKey ? FILE_PARSERS[source.parserKey] : null;
      let parsed: unknown = null;
      let parseError: string | null = null;
      try {
        parsed = parser ? parser(version.rawContent) : null;
      } catch (err: any) {
        parseError = err.message;
      }

      const fileType = source.fileType || FileStoreService.detectFileType(source.filename);

      res.json({
        raw: version.rawContent,
        parsed,
        parseError,
        fileType,
        versionNo: version.versionNo,
        fetchedAt: version.fetchedAt,
        contentHash: version.contentHash,
        sizeBytes: version.sizeBytes,
      });
    } catch (err) { next(err); }
  });

  // GET /api/files/:key/versions
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

  // ── Actions ──

  // POST /api/files/:key/force-read
  router.post('/:key/force-read', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const groupId = String(session.groupId);
      const result = await fileIngestionWorker.forceReadWithCookies(
        groupId, req.params.key, session.portalCookies, session.env,
      );
      res.json(result);
    } catch (err) { next(err); }
  });

  // POST /api/files/:key/force-read-and-sync
  router.post('/:key/force-read-and-sync', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const groupId = String(session.groupId);

      // Force read from FTP
      const result = await fileIngestionWorker.forceReadWithCookies(
        groupId, req.params.key, session.portalCookies, session.env,
      );

      // Sync attributes from latest version
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

  // POST /api/files/:key/test — one-shot FTP read for preview
  router.post('/:key/test', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const groupId = String(session.groupId);
      const source = await fileStore.getSource(groupId, req.params.key);
      if (!source) return res.status(404).json({ message: 'Source not found' });

      const rawContent = await ftpService.readFile(
        session.portalCookies, session.env, source.direction as any, source.filename,
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

  // POST /api/files/:key/save — write back to FTP
  router.post('/:key/save', sessionAuth, async (req, res, next) => {
    try {
      const session = req.session.portalSession!;
      const groupId = String(session.groupId);
      const source = await fileStore.getSource(groupId, req.params.key);
      if (!source) return res.status(404).json({ message: 'Source not found' });

      const { content } = req.body;
      if (!content) return res.status(400).json({ message: 'content required' });

      const message = await ftpService.saveFile(
        session.portalCookies, session.env, source.direction as any, source.filename, content,
      );

      // Also ingest the saved content as a new version
      await fileStore.ingestContent(source.id, content);

      res.json({ success: true, message });
    } catch (err) { next(err); }
  });

  return router;
}
