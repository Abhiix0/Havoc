import type { ReadinessState } from '../../../domain/ship-check';

export type ReadinessTone = 'critical' | 'warning' | 'success' | 'neutral';

/**
 * Maps a categorical Ship Check readiness verdict to a visual semantic tone.
 */
export function readinessToTone(readiness: ReadinessState): ReadinessTone {
  switch (readiness) {
    case 'READY':
      return 'success';
    case 'NEEDS_ATTENTION':
      return 'warning';
    case 'BLOCKED':
      return 'critical';
    case 'UNKNOWN':
      return 'neutral';
  }
}
