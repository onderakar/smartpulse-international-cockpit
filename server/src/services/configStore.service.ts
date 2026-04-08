import { PrismaClient } from '@prisma/client';
import { DashboardProfile, GroupProfile, UserProfile } from '@smartpulse-intl/shared';

const DEFAULT_POLLING = {
  intervalSeconds: 60,
  maxWindowHours: 3,
  incrementalWindowMinutes: 10,
  scheduleIntervalSeconds: 300,
};

const prisma = new PrismaClient();

/**
 * Configuration store backed by PostgreSQL via Prisma.
 * Replaces the old LowDB-based implementation.
 *
 * Public API is preserved for backward compatibility with all route handlers.
 */
export class ConfigStoreService {
  /** No-op — kept for backward compatibility with callers that call init(). */
  async init(): Promise<void> {
    // Prisma connects lazily on first query. Nothing to do.
  }

  // ── Group Profile ──

  async loadGroupProfile(groupId: string): Promise<GroupProfile | null> {
    const row = await prisma.groupProfile.findUnique({ where: { id: groupId } });
    if (!row) return null;
    return this.rowToGroupProfile(row);
  }

  async saveGroupProfile(groupId: string, profile: GroupProfile): Promise<void> {
    await prisma.groupProfile.upsert({
      where: { id: groupId },
      update: {
        name: profile.name,
        portalEnv: profile.portalEnv,
        assetMapping: profile.assetMapping as any,
        polling: profile.polling as any,
        monitoringCredentials: profile.monitoringCredentials as any ?? undefined,
        graphQlApiKey: profile.graphQlApiKey ?? undefined,
        scheduleBapEditable: profile.scheduleBapEditable ?? false,
        defaultResolutionMinutes: profile.defaultResolutionMinutes ?? undefined,
        customAttributeDefinitions: profile.customAttributeDefinitions as any ?? undefined,
        portfolioMap: (profile as any).portfolioSnapshot as any ?? (profile as any).portfolioMap as any ?? undefined,
      },
      create: {
        id: groupId,
        name: profile.name || 'Default',
        portalEnv: profile.portalEnv || 'prod',
        assetMapping: profile.assetMapping as any || {},
        polling: profile.polling as any || DEFAULT_POLLING,
        monitoringCredentials: profile.monitoringCredentials as any ?? undefined,
        graphQlApiKey: profile.graphQlApiKey ?? undefined,
        scheduleBapEditable: profile.scheduleBapEditable ?? false,
        defaultResolutionMinutes: profile.defaultResolutionMinutes ?? undefined,
        customAttributeDefinitions: profile.customAttributeDefinitions as any ?? undefined,
        portfolioMap: (profile as any).portfolioSnapshot as any ?? (profile as any).portfolioMap as any ?? undefined,
      },
    });
  }

  /** Load all group profiles (used by ScadaWorker). */
  async loadAllGroupProfiles(): Promise<Record<string, GroupProfile>> {
    const rows = await prisma.groupProfile.findMany();
    const result: Record<string, GroupProfile> = {};
    for (const row of rows) {
      result[row.id] = this.rowToGroupProfile(row);
    }
    return result;
  }

  // ── User Profile ──

  async loadUserProfile(username: string): Promise<UserProfile | null> {
    const row = await prisma.userProfile.findUnique({ where: { id: username } });
    if (!row) return null;
    return this.rowToUserProfile(row);
  }

  async saveUserProfile(username: string, profile: UserProfile): Promise<void> {
    await prisma.userProfile.upsert({
      where: { id: username },
      update: {
        groupId: profile.groupId,
        widgetLayout: profile.widgetLayout as any ?? undefined,
      },
      create: {
        id: username,
        groupId: profile.groupId,
        widgetLayout: profile.widgetLayout as any ?? undefined,
      },
    });
  }

  // ── Merged Profile (backward-compatible) ──

  async loadProfile(username: string, groupId?: string): Promise<DashboardProfile | null> {
    const userRow = await prisma.userProfile.findUnique({ where: { id: username } });
    const resolvedGroupId = groupId || userRow?.groupId;
    if (!resolvedGroupId) return null;

    const groupRow = await prisma.groupProfile.findUnique({ where: { id: resolvedGroupId } });
    if (!groupRow) return null;

    const gp = this.rowToGroupProfile(groupRow);
    const up = userRow ? this.rowToUserProfile(userRow) : null;

    return {
      id: gp.id,
      name: gp.name,
      portalEnv: gp.portalEnv,
      assetMapping: gp.assetMapping,
      polling: gp.polling,
      monitoringCredentials: gp.monitoringCredentials,
      graphQlApiKey: gp.graphQlApiKey,
      scheduleBapEditable: gp.scheduleBapEditable,
      defaultResolutionMinutes: gp.defaultResolutionMinutes,
      customAttributeDefinitions: gp.customAttributeDefinitions,
      portfolioSnapshot: gp.portfolioSnapshot,
      widgetLayout: up?.widgetLayout,
      groupId: resolvedGroupId,
      createdAt: gp.createdAt,
      updatedAt: gp.updatedAt,
    };
  }

  async saveProfile(username: string, profile: DashboardProfile, groupId?: string, forceMapping = false): Promise<void> {
    const resolvedGroupId = groupId || profile.groupId;
    if (!resolvedGroupId) {
      throw new Error('Cannot save profile without groupId');
    }

    // Guard: prevent accidental mapping deletion
    const existingGroup = await this.loadGroupProfile(resolvedGroupId);
    const existingCompanyCount = existingGroup?.assetMapping?.companies?.length ?? 0;
    const incomingCompanyCount = profile.assetMapping?.companies?.length ?? 0;
    if (!forceMapping && existingCompanyCount > 0 && incomingCompanyCount === 0) {
      throw new Error('MAPPING_DELETE_BLOCKED: Cannot clear asset mapping that has companies.');
    }

    // Transaction: save group + user atomically
    await prisma.$transaction(async (tx) => {
      await tx.groupProfile.upsert({
        where: { id: resolvedGroupId },
        update: {
          name: profile.name || existingGroup?.name || 'Default',
          portalEnv: profile.portalEnv || existingGroup?.portalEnv || 'prod',
          assetMapping: profile.assetMapping as any || existingGroup?.assetMapping || {},
          polling: profile.polling as any || existingGroup?.polling || DEFAULT_POLLING,
          monitoringCredentials: profile.monitoringCredentials as any ?? existingGroup?.monitoringCredentials as any ?? undefined,
          graphQlApiKey: profile.graphQlApiKey ?? existingGroup?.graphQlApiKey ?? undefined,
          scheduleBapEditable: profile.scheduleBapEditable ?? existingGroup?.scheduleBapEditable ?? false,
          defaultResolutionMinutes: profile.defaultResolutionMinutes ?? existingGroup?.defaultResolutionMinutes ?? undefined,
          customAttributeDefinitions: profile.customAttributeDefinitions as any ?? existingGroup?.customAttributeDefinitions as any ?? undefined,
          portfolioMap: profile.portfolioMap as any ?? existingGroup?.portfolioMap as any ?? undefined,
        },
        create: {
          id: resolvedGroupId,
          name: profile.name || 'Default',
          portalEnv: profile.portalEnv || 'prod',
          assetMapping: profile.assetMapping as any || {},
          polling: profile.polling as any || DEFAULT_POLLING,
          monitoringCredentials: profile.monitoringCredentials as any ?? undefined,
          graphQlApiKey: profile.graphQlApiKey ?? undefined,
          scheduleBapEditable: profile.scheduleBapEditable ?? false,
          defaultResolutionMinutes: profile.defaultResolutionMinutes ?? undefined,
          customAttributeDefinitions: profile.customAttributeDefinitions as any ?? undefined,
        },
      });

      const existingUser = await tx.userProfile.findUnique({ where: { id: username } });
      await tx.userProfile.upsert({
        where: { id: username },
        update: {
          groupId: resolvedGroupId,
          widgetLayout: profile.widgetLayout as any ?? existingUser?.widgetLayout ?? undefined,
        },
        create: {
          id: username,
          groupId: resolvedGroupId,
          widgetLayout: profile.widgetLayout as any ?? undefined,
        },
      });
    });
  }

  async reassociateGroup(username: string, realGroupId: string, groupName: string): Promise<void> {
    const userRow = await prisma.userProfile.findUnique({ where: { id: username } });
    if (!userRow) return;

    const currentGroupId = userRow.groupId;
    if (currentGroupId === realGroupId) return;

    await prisma.$transaction(async (tx) => {
      const existingRealGroup = await tx.groupProfile.findUnique({ where: { id: realGroupId } });

      if (existingRealGroup) {
        // Real group exists — point user to it
        await tx.userProfile.update({
          where: { id: username },
          data: { groupId: realGroupId },
        });

        // Clean up legacy group
        if (currentGroupId.startsWith('legacy_')) {
          // Only delete if no other users reference it
          const otherUsers = await tx.userProfile.count({ where: { groupId: currentGroupId } });
          if (otherUsers === 0) {
            await tx.groupProfile.delete({ where: { id: currentGroupId } }).catch(() => {});
          }
        }
      } else {
        // Move legacy group to real groupId
        const legacyGroup = await tx.groupProfile.findUnique({ where: { id: currentGroupId } });
        if (legacyGroup) {
          // Create new group with real ID, copy data
          await tx.groupProfile.create({
            data: {
              ...legacyGroup,
              id: realGroupId,
              name: groupName,
              updatedAt: new Date(),
            },
          });
          // Point user to new group
          await tx.userProfile.update({
            where: { id: username },
            data: { groupId: realGroupId },
          });
          // Delete legacy group
          const otherUsers = await tx.userProfile.count({ where: { groupId: currentGroupId } });
          if (otherUsers === 0) {
            await tx.groupProfile.delete({ where: { id: currentGroupId } }).catch(() => {});
          }
        } else {
          // No legacy group — just create empty real group and point user
          await tx.groupProfile.create({
            data: {
              id: realGroupId,
              name: groupName,
              portalEnv: 'prod',
              assetMapping: {},
              polling: DEFAULT_POLLING,
            },
          });
          await tx.userProfile.update({
            where: { id: username },
            data: { groupId: realGroupId },
          });
        }
      }
    });

    console.log(`[ConfigStore] Reassociated ${username}: ${currentGroupId} → ${realGroupId} (${groupName})`);
  }

  async deleteProfile(username: string): Promise<void> {
    await prisma.userProfile.delete({ where: { id: username } }).catch(() => {});
  }

  // ── Private helpers ──

  private rowToGroupProfile(row: any): GroupProfile {
    return {
      id: row.id,
      name: row.name,
      portalEnv: row.portalEnv as GroupProfile['portalEnv'],
      assetMapping: row.assetMapping as any,
      polling: row.polling as any,
      monitoringCredentials: row.monitoringCredentials as any ?? undefined,
      graphQlApiKey: row.graphQlApiKey ?? undefined,
      scheduleBapEditable: row.scheduleBapEditable ?? undefined,
      defaultResolutionMinutes: row.defaultResolutionMinutes ?? undefined,
      customAttributeDefinitions: row.customAttributeDefinitions as any ?? undefined,
      portfolioSnapshot: row.portfolioMap as any ?? undefined,
      createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
      updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
    };
  }

  private rowToUserProfile(row: any): UserProfile {
    return {
      id: row.id,
      groupId: row.groupId,
      widgetLayout: row.widgetLayout as any ?? undefined,
      createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
      updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
    };
  }
}
