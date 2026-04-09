import { Router } from 'express';
import { PrismaClient, FileSource } from '@prisma/client';
import { sessionAuth } from '../middleware/sessionAuth';
import { FileStoreService } from '../services/fileStore.service';
import { ConfigStoreService } from '../services/configStore.service';
import { parseDamGenCsv } from '../utils/damGenParser';

const prisma = new PrismaClient();

/** Find the DAM_GEN file source by key, parserKey, or filename pattern */
async function findDamGenSource(fileStore: FileStoreService, groupId: string): Promise<FileSource | null> {
  // Try common key names first
  for (const key of ['dam-gen', 'dam_gen', 'DAM_GEN', 'DAM_GEN.csv']) {
    const source = await fileStore.getSource(groupId, key);
    if (source) return source;
  }
  // Fallback: search all sources for this group by filename pattern
  const allSources = await prisma.fileSource.findMany({ where: { groupId } });
  return allSources.find(s =>
    s.filename.toLowerCase().includes('dam_gen') ||
    s.parserKey === 'dam-gen'
  ) ?? null;
}

export function createPortfolioMappingRoutes(
  fileStore: FileStoreService,
  configStore: ConfigStoreService,
): Router {
  const router = Router();

  // GET /api/portfolio-mapping — all mappings for this group
  router.get('/', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const mappings = await prisma.portfolioMapping.findMany({
        where: { groupId },
        orderBy: [{ portfolioType: 'asc' }, { externalId: 'asc' }],
      });
      res.json({ mappings });
    } catch (err) { next(err); }
  });

  // GET /api/portfolio-mapping/dam-portfolios — distinct PORTFOLIO_IDs from DAM_GEN.csv
  router.get('/dam-portfolios', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const source = await findDamGenSource(fileStore, groupId);
      if (!source) {
        return res.json({ portfolios: [], sourceVersion: null, message: 'No dam-gen file source configured' });
      }

      const version = await fileStore.getLatestVersion(source.id);
      if (!version) {
        return res.json({ portfolios: [], sourceVersion: null, message: 'No version available yet' });
      }

      const parsed = parseDamGenCsv(version.rawContent);
      res.json({
        portfolios: parsed.distinctPortfolios,
        sourceVersion: { versionNo: version.versionNo, fetchedAt: version.fetchedAt },
      });
    } catch (err) { next(err); }
  });

  // PUT /api/portfolio-mapping — batch save mappings (delete + insert)
  router.put('/', sessionAuth, async (req, res, next) => {
    try {
      const groupId = String(req.session.portalSession!.groupId);
      const username = req.session.portalSession!.username;
      const { portfolioType, mappings } = req.body as {
        portfolioType: string;
        mappings: Array<{ externalId: string; companyId: number }>;
      };

      if (!portfolioType) {
        return res.status(400).json({ message: 'portfolioType is required' });
      }

      // Validate: no duplicate companyIds
      const companyIds = mappings.map(m => m.companyId);
      if (new Set(companyIds).size !== companyIds.length) {
        return res.status(400).json({ message: 'A company can only be assigned to one portfolio' });
      }

      // Resolve company names from AssetMapping
      const profile = await configStore.loadGroupProfile(groupId);
      const companyNameMap = new Map<number, string>(
        profile?.assetMapping?.companies?.map((c: any) => [c.companyId, c.companyName || c.fullName || `Company ${c.companyId}`]) ?? []
      );

      await prisma.$transaction(async (tx) => {
        // Remove existing mappings for this type
        await tx.portfolioMapping.deleteMany({ where: { groupId, portfolioType } });

        // Insert new mappings
        if (mappings.length > 0) {
          await tx.portfolioMapping.createMany({
            data: mappings.map(m => ({
              groupId,
              portfolioType,
              externalId: m.externalId,
              companyId: m.companyId,
              companyName: companyNameMap.get(m.companyId) ?? `Company ${m.companyId}`,
              updatedBy: username,
            })),
          });
        }
      });

      res.json({ saved: mappings.length });
    } catch (err) { next(err); }
  });

  // DELETE /api/portfolio-mapping/:id — delete single mapping
  router.delete('/:id', sessionAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id);
      await prisma.portfolioMapping.delete({ where: { id } });
      res.json({ success: true });
    } catch (err) { next(err); }
  });

  return router;
}
