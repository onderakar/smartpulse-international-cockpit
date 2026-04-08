/** A power plant / entity unit registered in SmartPulse Portal */
export interface PortalEntityUnit {
  unitNo: number;
  unitType: string;       // "PP" = Power Plant
  shortName: string | null;
  fullName: string;
}

/** A unit reference inside a portfolio (lightweight — just unitNo) */
export interface PortfolioUnitRef {
  unitNo: number;
  unitType: string;
}

/** A portfolio with its assigned units */
export interface PortfolioEntry {
  id: number;
  name: string;
  portfolioType: string;  // "Unknown", "TSO", "AFRR", etc.
  eicForTps: string | null;
  eicForPps: string | null;
  portfolioUnits: PortfolioUnitRef[];
}

/** Full portfolio snapshot fetched from Portal */
export interface PortfolioSnapshot {
  entityUnits: PortalEntityUnit[];
  portfolios: PortfolioEntry[];
  fetchedAt: string;  // ISO timestamp
}
