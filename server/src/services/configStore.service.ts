import path from 'path';
import fs from 'fs/promises';
import { DashboardProfile, GroupProfile, UserProfile, migrateAssetMapping } from '@smartpulse-intl/shared';
import { envConfig } from '../config/env';

const MAX_BACKUPS = 20;

interface DatabaseSchema {
  groups: Record<string, GroupProfile>;
  users: Record<string, UserProfile>;
}

/** Legacy schema for migration detection */
interface LegacyDatabaseSchema {
  users: Record<string, DashboardProfile>;
}

const DEFAULT_DATA: DatabaseSchema = { groups: {}, users: {} };

/** Fields that belong to GroupProfile */
const GROUP_FIELDS = ['portalEnv', 'assetMapping', 'polling', 'monitoringCredentials', 'graphQlApiKey', 'scheduleBapEditable'] as const;

export class ConfigStoreService {
  private db: any = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    const dbDir = path.dirname(envConfig.DB_PATH);
    await fs.mkdir(dbDir, { recursive: true });

    const { Low } = await import('lowdb');
    const { JSONFile } = await import('lowdb/node');

    const adapter = new JSONFile<DatabaseSchema>(envConfig.DB_PATH);
    this.db = new Low<DatabaseSchema>(adapter, DEFAULT_DATA);

    await this.db.read();
    if (!this.db.data) {
      this.db.data = DEFAULT_DATA;
      await this.db.write();
    }

    // Migrate legacy format if needed
    await this.migrateIfNeeded();

    console.log(`[ConfigStore] LowDB initialized at ${envConfig.DB_PATH}`);
  }

  /**
   * Detect and migrate legacy format where users stored full DashboardProfiles.
   * Legacy format: { users: { "username": DashboardProfile } }
   * New format: { groups: { "groupId": GroupProfile }, users: { "username": UserProfile } }
   */
  private async migrateIfNeeded(): Promise<void> {
    const db = this.getDb();
    const data = db.data as any;

    // If groups key already exists, assume already migrated
    if (data.groups && Object.keys(data.groups).length > 0) return;

    // Check if users have legacy full profiles (they contain assetMapping/portalEnv)
    const userEntries = Object.entries(data.users || {}) as [string, any][];
    const legacyEntries = userEntries.filter(
      ([, profile]) => profile && ('assetMapping' in profile || 'portalEnv' in profile),
    );

    if (legacyEntries.length === 0) {
      // No legacy data or empty db — just ensure groups exists
      if (!data.groups) {
        data.groups = {};
        await db.write();
      }
      return;
    }

    console.log(`[ConfigStore] Migrating ${legacyEntries.length} legacy user profile(s) to group-based format...`);

    data.groups = data.groups || {};
    const now = new Date().toISOString();

    for (const [username, legacy] of legacyEntries) {
      // Use a temporary group key based on a hash of the username
      // This will be re-associated with the real portal groupId on next login
      const tempGroupId = `legacy_${username}`;

      // Extract group-level fields
      const groupProfile: GroupProfile = {
        id: tempGroupId,
        name: legacy.name || 'Default',
        portalEnv: legacy.portalEnv || 'prod',
        assetMapping: legacy.assetMapping || {},
        polling: legacy.polling || { intervalSeconds: 60, maxWindowHours: 3, incrementalWindowMinutes: 10, scheduleIntervalSeconds: 300 },
        monitoringCredentials: legacy.monitoringCredentials,
        graphQlApiKey: legacy.graphQlApiKey,
        createdAt: legacy.createdAt || now,
        updatedAt: legacy.updatedAt || now,
      };

      // Auto-migrate old single-GCP assetMapping format
      if (groupProfile.assetMapping && !(groupProfile.assetMapping as any).companies && (groupProfile.assetMapping as any).uevcb) {
        groupProfile.assetMapping = migrateAssetMapping(groupProfile.assetMapping);
      }

      data.groups[tempGroupId] = groupProfile;

      // Extract user-level fields
      const userProfile: UserProfile = {
        id: username,
        groupId: tempGroupId,
        widgetLayout: legacy.widgetLayout,
        createdAt: legacy.createdAt || now,
        updatedAt: legacy.updatedAt || now,
      };

      data.users[username] = userProfile;
    }

    await db.write();
    console.log(`[ConfigStore] Migration complete. ${Object.keys(data.groups).length} group(s), ${Object.keys(data.users).length} user(s).`);
  }

  private getDb() {
    if (!this.db) {
      throw new Error('ConfigStoreService not initialized. Call init() first.');
    }
    return this.db;
  }

  // ── Group Profile ──

  async loadGroupProfile(groupId: string): Promise<GroupProfile | null> {
    const db = this.getDb();
    await db.read();
    return db.data.groups[groupId] ?? null;
  }

  async saveGroupProfile(groupId: string, profile: GroupProfile): Promise<void> {
    const db = this.getDb();
    await db.read();
    profile.updatedAt = new Date().toISOString();
    if (!profile.createdAt) {
      profile.createdAt = profile.updatedAt;
    }
    db.data.groups[groupId] = profile;
    await db.write();
  }

  // ── User Profile ──

  async loadUserProfile(username: string): Promise<UserProfile | null> {
    const db = this.getDb();
    await db.read();
    return db.data.users[username] ?? null;
  }

  async saveUserProfile(username: string, profile: UserProfile): Promise<void> {
    const db = this.getDb();
    await db.read();
    profile.updatedAt = new Date().toISOString();
    if (!profile.createdAt) {
      profile.createdAt = profile.updatedAt;
    }
    db.data.users[username] = profile;
    await db.write();
  }

  // ── Merged Profile (backward-compatible) ──

  /**
   * Load a merged DashboardProfile combining group + user data.
   * Used by routes that need the full profile view.
   */
  async loadProfile(username: string, groupId?: string): Promise<DashboardProfile | null> {
    const db = this.getDb();
    await db.read();

    const userProfile = db.data.users[username] as UserProfile | undefined;
    const resolvedGroupId = groupId || userProfile?.groupId;

    if (!resolvedGroupId) return null;

    const groupProfile = db.data.groups[resolvedGroupId] as GroupProfile | undefined;
    if (!groupProfile) return null;

    // Merge group + user into DashboardProfile
    return {
      id: groupProfile.id,
      name: groupProfile.name,
      portalEnv: groupProfile.portalEnv,
      assetMapping: groupProfile.assetMapping,
      polling: groupProfile.polling,
      monitoringCredentials: groupProfile.monitoringCredentials,
      graphQlApiKey: groupProfile.graphQlApiKey,
      scheduleBapEditable: groupProfile.scheduleBapEditable,
      widgetLayout: userProfile?.widgetLayout,
      groupId: resolvedGroupId,
      createdAt: groupProfile.createdAt,
      updatedAt: groupProfile.updatedAt,
    };
  }

  /**
   * Create a timestamped backup of the current db.json before destructive writes.
   */
  private async backupBeforeSave(): Promise<void> {
    try {
      const dbPath = envConfig.DB_PATH;
      const backupDir = path.join(path.dirname(dbPath), 'backups');
      await fs.mkdir(backupDir, { recursive: true });

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `db-${ts}.json`);
      await fs.copyFile(dbPath, backupPath);

      // Prune old backups — keep only the most recent MAX_BACKUPS
      const files = (await fs.readdir(backupDir))
        .filter(f => f.startsWith('db-') && f.endsWith('.json'))
        .sort();
      if (files.length > MAX_BACKUPS) {
        const toDelete = files.slice(0, files.length - MAX_BACKUPS);
        for (const f of toDelete) {
          await fs.unlink(path.join(backupDir, f)).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[ConfigStore] backup failed (non-fatal):', err);
    }
  }

  /**
   * Save a merged DashboardProfile by splitting it into group + user parts.
   */
  async saveProfile(username: string, profile: DashboardProfile, groupId?: string): Promise<void> {
    const resolvedGroupId = groupId || profile.groupId;
    if (!resolvedGroupId) {
      throw new Error('Cannot save profile without groupId');
    }

    const now = new Date().toISOString();

    // Split and save group fields
    const existingGroup = await this.loadGroupProfile(resolvedGroupId);

    // Guard: prevent accidental mapping deletion
    const existingCompanyCount = existingGroup?.assetMapping?.companies?.length ?? 0;
    const incomingCompanyCount = profile.assetMapping?.companies?.length ?? 0;
    if (existingCompanyCount > 0 && incomingCompanyCount === 0) {
      throw new Error('MAPPING_DELETE_BLOCKED: Cannot clear asset mapping that has companies. Remove companies individually or use force flag.');
    }

    // Auto-backup before overwriting
    await this.backupBeforeSave();

    const groupProfile: GroupProfile = {
      id: resolvedGroupId,
      name: profile.name || existingGroup?.name || 'Default',
      portalEnv: profile.portalEnv || existingGroup?.portalEnv || 'prod',
      assetMapping: profile.assetMapping || existingGroup?.assetMapping || ({} as any),
      polling: profile.polling || existingGroup?.polling || { intervalSeconds: 60, maxWindowHours: 3, incrementalWindowMinutes: 10, scheduleIntervalSeconds: 300 },
      monitoringCredentials: profile.monitoringCredentials ?? existingGroup?.monitoringCredentials,
      graphQlApiKey: profile.graphQlApiKey ?? existingGroup?.graphQlApiKey,
      scheduleBapEditable: profile.scheduleBapEditable ?? existingGroup?.scheduleBapEditable,
      createdAt: existingGroup?.createdAt || now,
      updatedAt: now,
    };
    await this.saveGroupProfile(resolvedGroupId, groupProfile);

    // Split and save user fields
    const existingUser = await this.loadUserProfile(username);
    const userProfile: UserProfile = {
      id: username,
      groupId: resolvedGroupId,
      widgetLayout: profile.widgetLayout ?? existingUser?.widgetLayout,
      createdAt: existingUser?.createdAt || now,
      updatedAt: now,
    };
    await this.saveUserProfile(username, userProfile);
  }

  /**
   * Re-associate a user's legacy group profile with their real portal groupId.
   * Called on login when we know the real groupId from the portal.
   */
  async reassociateGroup(username: string, realGroupId: string, groupName: string): Promise<void> {
    const db = this.getDb();
    await db.read();

    const userProfile = db.data.users[username] as UserProfile | undefined;
    if (!userProfile) return;

    const currentGroupId = userProfile.groupId;

    // If already associated with the real group, nothing to do
    if (currentGroupId === realGroupId) return;

    // Check if a real group profile already exists (another user from this group already logged in)
    const existingRealGroup = db.data.groups[realGroupId] as GroupProfile | undefined;

    if (existingRealGroup) {
      // Real group already exists — just point the user to it
      userProfile.groupId = realGroupId;
      userProfile.updatedAt = new Date().toISOString();
      db.data.users[username] = userProfile;

      // Clean up the legacy group if it was temporary
      if (currentGroupId.startsWith('legacy_')) {
        delete db.data.groups[currentGroupId];
      }
    } else {
      // Move the legacy group profile to the real groupId
      const legacyGroup = db.data.groups[currentGroupId] as GroupProfile | undefined;
      if (legacyGroup) {
        legacyGroup.id = realGroupId;
        legacyGroup.name = groupName;
        db.data.groups[realGroupId] = legacyGroup;
        delete db.data.groups[currentGroupId];
      }

      userProfile.groupId = realGroupId;
      userProfile.updatedAt = new Date().toISOString();
      db.data.users[username] = userProfile;
    }

    await db.write();
    console.log(`[ConfigStore] Reassociated ${username}: ${currentGroupId} → ${realGroupId} (${groupName})`);
  }

  async deleteProfile(username: string): Promise<void> {
    const db = this.getDb();
    await db.read();
    delete db.data.users[username];
    await db.write();
  }
}
