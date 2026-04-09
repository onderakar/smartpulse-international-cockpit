import { PrismaClient } from '@prisma/client';
import { eventBus, EVENTS } from '../eventBus';
import { DamGenAdapter } from './damGenAdapter';

const prisma = new PrismaClient();
const damGenAdapter = new DamGenAdapter();

/**
 * Post-ingestion hooks: listen for FILE_UPDATED events and route to
 * appropriate domain adapters based on file source metadata.
 *
 * This is the bridge between generic file ingestion and domain-specific
 * time series extraction. Add new adapters here as new file types are introduced.
 */
export function registerFileIngestionHooks() {
  eventBus.on(EVENTS.FILE_UPDATED, async (payload: {
    groupId: string;
    sourceKey: string;
    versionId: number;
    versionNo: number;
  }) => {
    try {
      // Find the source to determine which adapter to use
      const source = await prisma.fileSource.findFirst({
        where: { groupId: payload.groupId, key: payload.sourceKey },
      });

      if (!source) return;

      // Route by parserKey or filename pattern
      const isDamGen = source.parserKey === 'dam-gen' ||
        source.filename.toLowerCase().includes('dam_gen');

      if (isDamGen) {
        // Get the latest version content
        const version = await prisma.fileVersion.findFirst({
          where: { id: payload.versionId },
          select: { rawContent: true },
        });

        if (version) {
          await damGenAdapter.process(payload.groupId, version.rawContent);
        }
      }

      // Future: add more adapters here
      // if (isIdmFile) { await idmAdapter.process(...); }

    } catch (err: any) {
      console.error(`[FileIngestionHooks] Error processing ${payload.sourceKey}:`, err.message);
    }
  });

  console.log('[FileIngestionHooks] Registered');
}
