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

  async getSourceById(id: number) {
    return prisma.fileSource.findUnique({ where: { id } });
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
      await tx.fileVersion.updateMany({
        where: { sourceId, isCurrent: true },
        data: { isCurrent: false },
      });

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
