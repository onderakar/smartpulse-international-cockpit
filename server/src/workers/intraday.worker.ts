import { IntradayService } from '../services/intraday.service';
import { ConfigStoreService } from '../services/configStore.service';
import { getCachedGroupSession } from '../store/groupSessionCache';

const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 minutes

/**
 * IntradayWorker: periodically fetches intraday transactions for all companies
 * in all active groups, stores them, and aggregates net positions.
 *
 * Only runs when a user has logged in (needs portal session for API auth).
 */
export class IntradayWorker {
  private intradayService = new IntradayService();
  private configStore = new ConfigStoreService();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private intervalMs: number;

  constructor(intervalMs?: number) {
    this.intervalMs = intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  async start() {
    if (this.running) return;
    this.running = true;

    console.log(`[IntradayWorker] Starting with interval ${this.intervalMs / 1000}s`);

    // First tick after a short delay (let users log in first)
    setTimeout(() => this.tick(), 30_000);

    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    console.log('[IntradayWorker] Stopped');
  }

  private async tick() {
    try {
      const allProfiles = await this.configStore.loadAllGroupProfiles();

      for (const [groupId, profile] of Object.entries(allProfiles)) {
        const session = getCachedGroupSession(groupId);
        if (!session) continue; // No logged-in user for this group

        const companies = profile.assetMapping?.companies;
        if (!companies || companies.length === 0) continue;

        const companyIds = companies.map((c: any) => c.companyId).filter(Boolean);
        if (companyIds.length === 0) continue;

        // Fetch today's transactions
        const today = new Date().toISOString().slice(0, 10);
        const startDate = `${today}T00:00:00`;
        const endDate = `${today}T23:59:59`;

        try {
          const result = await this.intradayService.refreshTransactions(
            groupId,
            companyIds,
            startDate,
            endDate,
            session.accessToken,
            session.portalCookies,
            session.env,
          );

          if (result.newTransactions > 0 || result.aggregated.inserted > 0) {
            console.log(
              `[IntradayWorker] group=${groupId}: ${result.newTransactions} new transactions, ` +
              `${result.aggregated.inserted} series updated`
            );
          }
        } catch (err: any) {
          console.error(`[IntradayWorker] group=${groupId} error: ${err.message?.substring(0, 200)}`);
        }
      }
    } catch (err: any) {
      console.error(`[IntradayWorker] tick error: ${err.message}`);
    }
  }
}
