// === Portal Auth ===

export interface PortalLoginRequest {
  username: string;
  password: string;
}

export interface PortalCompany {
  id: number;
  name: string;
  fullName: string;
  timezone: string;
  powerPlantIds: number[];
}

export interface PortalPlant {
  id: number;
  name: string;
  power: number;
  timezone: string;
  typeid: number;
  isSfc: boolean;
}

export interface PortalLoginResponse {
  accessToken: string;
  graphQlAuthKey: string;
  plants: PortalPlant[];
  companies: PortalCompany[];
  groups: PortalGroup[];
}

export interface PortalSessionStatus {
  loggedIn: boolean;
  plants?: PortalPlant[];
  companies?: PortalCompany[];
}

// === Portal Groups ===

export interface PortalGroup {
  id: number;
  name: string;
  timezone: string;
  companies: number[];
}

// === Monitoring Auth ===

export interface MonitoringLoginRequest {
  username: string;
  password: string;
}

export interface MonitoringLoginResponse {
  success: boolean;
  expiresAt: number;
}
