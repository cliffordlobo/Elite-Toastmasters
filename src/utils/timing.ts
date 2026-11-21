import type { QualificationStatus, TimingLampState, TimingThresholds } from '../types/evaluation';

/**
 * Parses a target duration string like "5-7 minutes", "5–7 min", "4 to 6 minutes",
 * "1-2 minutes", or "8-10" into numeric min/max minutes.
 */
export function parseTargetDuration(
  input: string,
  fallbackMin = 5,
  fallbackMax = 7
): { minMinutes: number; maxMinutes: number } {
  if (!input || typeof input !== 'string') {
    return { minMinutes: fallbackMin, maxMinutes: fallbackMax };
  }

  const rangeMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/i);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!Number.isNaN(min) && !Number.isNaN(max) && max >= min && min > 0) {
      return { minMinutes: min, maxMinutes: max };
    }
  }

  const singleMatch = input.match(/(\d+(?:\.\d+)?)/);
  if (singleMatch) {
    const val = parseFloat(singleMatch[1]);
    if (!Number.isNaN(val) && val > 0) {
      return { minMinutes: Math.max(0.5, val - 1), maxMinutes: val };
    }
  }

  return { minMinutes: fallbackMin, maxMinutes: fallbackMax };
}

/**
 * Computes Toastmasters timing signal thresholds in seconds.
 * - Green: minimum target time (e.g. 5:00)
 * - Yellow: midpoint between min and max (e.g. 6:00)
 * - Red: maximum target time (e.g. 7:00)
 * - Qualification grace window: [min - 30s, max + 30s]
 */
export function computeTimingThresholds(minMinutes: number, maxMinutes: number): TimingThresholds {
  const safeMin = Math.max(0.5, minMinutes || 5);
  const safeMax = Math.max(safeMin, maxMinutes || 7);

  const minSeconds = Math.round(safeMin * 60);
  const maxSeconds = Math.round(safeMax * 60);
  const midSeconds = Math.round((minSeconds + maxSeconds) / 2);

  return {
    minSeconds,
    midSeconds,
    maxSeconds,
    graceMinSeconds: Math.max(0, minSeconds - 30),
    graceMaxSeconds: maxSeconds + 30,
  };
}

export function getTimingLampState(
  elapsedSeconds: number,
  thresholds: TimingThresholds,
  isActiveOrRecorded: boolean
): TimingLampState {
  if (!isActiveOrRecorded && elapsedSeconds === 0) {
    return 'idle';
  }
  if (elapsedSeconds > thresholds.graceMaxSeconds) {
    return 'overtime';
  }
  if (elapsedSeconds >= thresholds.maxSeconds) {
    return 'red';
  }
  if (elapsedSeconds >= thresholds.midSeconds) {
    return 'yellow';
  }
  if (elapsedSeconds >= thresholds.minSeconds) {
    return 'green';
  }
  return 'under';
}

export function evaluateQualification(
  actualSeconds: number,
  thresholds: TimingThresholds
): QualificationStatus {
  if (actualSeconds < thresholds.graceMinSeconds) {
    return 'UNDER_TIME';
  }
  if (actualSeconds > thresholds.graceMaxSeconds) {
    return 'OVERTIME';
  }
  return 'QUALIFIED';
}

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
