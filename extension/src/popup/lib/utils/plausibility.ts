import type { HavocEvent } from '../../../domain/event';
import type { Signal } from '../../../domain/signal';

export interface PlausibilityTag {
  label: string;
  tone: 'chaos' | 'ambient' | 'noise';
}

export function getOrigin(urlStr?: string, baseOrigin?: string): string | null {
  if (!urlStr) return null;
  try {
    return new URL(urlStr, baseOrigin).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Derives presentation tag for a network failure event based on
 * target origin proximity and active chaos injection linkage.
 */
export function getEventPlausibilityTag(
  event: HavocEvent,
  targetOrigin: string
): PlausibilityTag | null {
  if (
    !event.type.startsWith('REQUEST_') ||
    (!event.type.includes('FAILURE') && !event.type.includes('TIMEOUT'))
  ) {
    return null;
  }

  const effectiveTgt = getOrigin(targetOrigin);
  const eventOrigin = getOrigin(event.resource, effectiveTgt ?? undefined);
  const hasInjection =
    typeof event.metadata?.injectionId === 'string' &&
    event.metadata.injectionId.length > 0;
  const isSame = Boolean(
    effectiveTgt && eventOrigin && effectiveTgt === eventOrigin
  );

  if (isSame) {
    return hasInjection
      ? { label: 'SAME-ORIGIN · CHAOS-LINKED', tone: 'chaos' }
      : { label: 'SAME-ORIGIN · AMBIENT', tone: 'ambient' };
  } else {
    return hasInjection
      ? { label: 'CROSS-ORIGIN · CHAOS-LINKED', tone: 'chaos' }
      : { label: 'CROSS-ORIGIN · THIRD-PARTY', tone: 'noise' };
  }
}

/**
 * Derives presentation tag for a derived Signal.
 */
export function getSignalPlausibilityTag(
  signal: Signal
): { label: string; tone: 'chaos' | 'ambient' } | null {
  if (signal.type === 'RequestFailureObserved') {
    if ((signal.confidence ?? 0) >= 0.97) {
      return { label: 'CHAOS-LINKED', tone: 'chaos' };
    }
    if ((signal.confidence ?? 0) === 0.95) {
      return { label: 'SAME-ORIGIN · AMBIENT', tone: 'ambient' };
    }
  }
  return null;
}
