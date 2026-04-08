/**
 * One-time migration: LowDB (db.json) → PostgreSQL
 * Run: cd server && npx tsx prisma/seed-from-lowdb.ts
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

const DEFAULT_POLLING = {
  intervalSeconds: 60,
  maxWindowHours: 3,
  incrementalWindowMinutes: 10,
  scheduleIntervalSeconds: 300,
};

async function main() {
  // Read db.json
  const dbPath = path.resolve(__dirname, '../data/db.json');
  if (!fs.existsSync(dbPath)) {
    console.log('[Seed] No db.json found, nothing to migrate.');
    return;
  }

  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  const groups = raw.groups || {};
  const users = raw.users || {};

  console.log(`[Seed] Found ${Object.keys(groups).length} group(s), ${Object.keys(users).length} user(s) in db.json`);

  // Migrate groups
  for (const [groupId, g] of Object.entries(groups) as [string, any][]) {
    await prisma.groupProfile.upsert({
      where: { id: groupId },
      update: {
        name: g.name || 'Default',
        portalEnv: g.portalEnv || 'prod',
        assetMapping: g.assetMapping || {},
        polling: g.polling || DEFAULT_POLLING,
        monitoringCredentials: g.monitoringCredentials || undefined,
        graphQlApiKey: g.graphQlApiKey || undefined,
        scheduleBapEditable: g.scheduleBapEditable || false,
        defaultResolutionMinutes: g.defaultResolutionMinutes || undefined,
        customAttributeDefinitions: g.customAttributeDefinitions || undefined,
      },
      create: {
        id: groupId,
        name: g.name || 'Default',
        portalEnv: g.portalEnv || 'prod',
        assetMapping: g.assetMapping || {},
        polling: g.polling || DEFAULT_POLLING,
        monitoringCredentials: g.monitoringCredentials || undefined,
        graphQlApiKey: g.graphQlApiKey || undefined,
        scheduleBapEditable: g.scheduleBapEditable || false,
        defaultResolutionMinutes: g.defaultResolutionMinutes || undefined,
        customAttributeDefinitions: g.customAttributeDefinitions || undefined,
      },
    });
    console.log(`[Seed] Group "${groupId}" (${g.name}) migrated.`);
  }

  // Migrate users
  for (const [username, u] of Object.entries(users) as [string, any][]) {
    const gid = u.groupId;
    if (!gid) {
      console.warn(`[Seed] User "${username}" has no groupId, skipping.`);
      continue;
    }
    // Ensure group exists
    const groupExists = await prisma.groupProfile.findUnique({ where: { id: gid } });
    if (!groupExists) {
      console.warn(`[Seed] User "${username}" references group "${gid}" which doesn't exist, skipping.`);
      continue;
    }
    await prisma.userProfile.upsert({
      where: { id: username },
      update: {
        groupId: gid,
        widgetLayout: u.widgetLayout || undefined,
      },
      create: {
        id: username,
        groupId: gid,
        widgetLayout: u.widgetLayout || undefined,
      },
    });
    console.log(`[Seed] User "${username}" → group "${gid}" migrated.`);
  }

  // Migrate schedules if file exists
  const schedulesPath = path.resolve(__dirname, '../data/schedules.json');
  if (fs.existsSync(schedulesPath)) {
    const schedRaw = JSON.parse(fs.readFileSync(schedulesPath, 'utf-8'));
    const schedules = schedRaw.schedules || {};
    let revCount = 0;

    for (const [storeKey, store] of Object.entries(schedules) as [string, any][]) {
      const [plantIdStr, dateKey] = storeKey.split(':');
      const gcpId = parseInt(plantIdStr, 10);
      if (isNaN(gcpId) || !dateKey) continue;

      const slots = store.slots || {};
      for (const [deliveryStart, revisions] of Object.entries(slots) as [string, any[]][]) {
        if (!Array.isArray(revisions)) continue;
        for (const rev of revisions) {
          try {
            await prisma.scheduleRevision.upsert({
              where: {
                gcpId_dateKey_deliveryStart_contentHash: {
                  gcpId,
                  dateKey,
                  deliveryStart,
                  contentHash: rev.contentHash || '',
                },
              },
              update: {},
              create: {
                gcpId,
                dateKey,
                deliveryStart,
                row: rev.row || rev,
                fetchedAt: BigInt(rev.fetchedAt || Date.now()),
                contentHash: rev.contentHash || '',
                source: rev.source || 'ftp',
              },
            });
            revCount++;
          } catch (err: any) {
            // Skip duplicates silently
            if (!err.message?.includes('Unique constraint')) {
              console.warn(`[Seed] Schedule revision error: ${err.message}`);
            }
          }
        }
      }
    }
    console.log(`[Seed] ${revCount} schedule revision(s) migrated.`);
  }

  console.log('[Seed] Migration complete.');
}

main()
  .catch(err => {
    console.error('[Seed] Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
