/**
 * performance-monitor.ts — tracks real runtime execution duration and CPU overhead.
 *
 * Target: <5% CPU overhead during observation and active experiments.
 */

export interface PerformanceMetrics {
  eventsProcessed: number;
  totalProcessingTimeMs: number;
  avgEventProcessingMs: number;
  maxEventProcessingMs: number;
  windowDurationMs: number;
  cpuOverheadPercentage: number;
  targetMet: boolean;
}

export class PerformanceMonitor {
  private _startTime: number = performance.now();
  private _eventsProcessed: number = 0;
  private _totalProcessingTimeMs: number = 0;
  private _maxEventProcessingMs: number = 0;
  private _lastReportTime: number = performance.now();

  /**
   * Record the execution duration of a processing block.
   */
  recordProcessing(durationMs: number): void {
    this._eventsProcessed++;
    this._totalProcessingTimeMs += durationMs;
    if (durationMs > this._maxEventProcessingMs) {
      this._maxEventProcessingMs = durationMs;
    }

    // Auto-report periodically if events are flowing
    const now = performance.now();
    if (now - this._lastReportTime > 5000 && this._eventsProcessed > 0) {
      this.logReport('ACTIVE');
      this._lastReportTime = now;
    }
  }

  /**
   * Calculate current performance metrics.
   */
  getMetrics(): PerformanceMetrics {
    const now = performance.now();
    const windowDurationMs = Math.max(1, now - this._startTime);
    const avgEventProcessingMs =
      this._eventsProcessed > 0
        ? this._totalProcessingTimeMs / this._eventsProcessed
        : 0;

    const cpuOverheadPercentage = Math.min(
      100,
      (this._totalProcessingTimeMs / windowDurationMs) * 100
    );

    return {
      eventsProcessed: this._eventsProcessed,
      totalProcessingTimeMs: this._totalProcessingTimeMs,
      avgEventProcessingMs,
      maxEventProcessingMs: this._maxEventProcessingMs,
      windowDurationMs,
      cpuOverheadPercentage,
      targetMet: cpuOverheadPercentage < 5.0,
    };
  }

  /**
   * Output a structured performance log.
   */
  logReport(context: string): PerformanceMetrics {
    const m = this.getMetrics();
    const eventRate = (
      (m.eventsProcessed / Math.max(1, m.windowDurationMs)) *
      1000
    ).toFixed(1);

    console.log(
      `[HAVOC][perf] Performance Report [${context}]:\n` +
      `  Events Processed: ${m.eventsProcessed} (${eventRate} evt/s)\n` +
      `  Avg Ingestion Latency: ${m.avgEventProcessingMs.toFixed(3)}ms (Max: ${m.maxEventProcessingMs.toFixed(3)}ms)\n` +
      `  Total Active Compute: ${m.totalProcessingTimeMs.toFixed(2)}ms over ${(m.windowDurationMs / 1000).toFixed(1)}s window\n` +
      `  Calculated CPU Overhead: ${m.cpuOverheadPercentage.toFixed(2)}% ${m.targetMet ? '(✓ <5% Target PASSED)' : '(▲ EXCEEDS 5% TARGET)'}`
    );

    return m;
  }

  reset(): void {
    this._startTime = performance.now();
    this._eventsProcessed = 0;
    this._totalProcessingTimeMs = 0;
    this._maxEventProcessingMs = 0;
    this._lastReportTime = performance.now();
  }
}

export const globalPerfMonitor = new PerformanceMonitor();
