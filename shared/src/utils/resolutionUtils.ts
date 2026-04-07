import { MTUResolution } from '../types/plant.types'

/**
 * Returns the effective time resolution for a GCP.
 * Priority: gcp.resolutionMinutes → profile.defaultResolutionMinutes → 15 (hard default)
 */
export function getEffectiveResolution(
  gcpResolution: MTUResolution | undefined,
  profileDefault: MTUResolution | undefined,
): MTUResolution {
  return gcpResolution ?? profileDefault ?? 15
}
