import type { ShipCheckRun } from '../../../domain/ship-check';

export type DeckTagLabel = 'RUNNING' | 'FINALIZING' | 'COMPLETE';

export function getDeckTagLabel(shipCheck: ShipCheckRun | null | undefined): DeckTagLabel {
  if (!shipCheck) return 'RUNNING';
  if (shipCheck.completedAt) return 'COMPLETE';
  const steps = shipCheck.steps ?? [];
  const allStepsTerminal =
    steps.length > 0 &&
    steps.every((s) => s.status === 'DONE' || s.status === 'ERRORED' || s.status === 'SKIPPED');
  return allStepsTerminal ? 'FINALIZING' : 'RUNNING';
}
