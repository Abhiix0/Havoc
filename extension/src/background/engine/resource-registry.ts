/**
 * resource-registry.ts — tracks resources acquired during an experiment run
 * and ensures they are released correctly, even when cleanup partially fails.
 *
 * Design principles:
 *  - Every resource has an explicit scope so future phases can do scoped
 *    teardown (e.g. "clean up only run-lifetime resources").
 *  - cleanupAll() is best-effort: one failing cleanup never stops the rest.
 *  - The caller (RunCoordinator) decides what to do with the result — this
 *    module only executes and reports; it does not transition state itself.
 *  - Resources are cleaned up in LIFO order (last registered, first cleaned)
 *    so that dependent resources are unwound in the correct order.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResourceScope =
  | 'extension-lifetime'  // survives the run; cleaned up when the extension unloads
  | 'experiment-lifetime' // tied to the ExperimentDefinition, not a specific run
  | 'run-lifetime'        // tied to one ExperimentRun; cleaned up at run end
  | 'tab-lifetime';       // tied to the target tab; cleaned up when tab closes

export interface Resource {
  /** Human-readable identifier for logging and error reporting. */
  id: string;
  scope: ResourceScope;
  /** Called during cleanup. May be async. Must not throw — wrap defensively. */
  cleanup: () => Promise<void> | void;
}

export interface CleanupResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

// ---------------------------------------------------------------------------
// ResourceRegistry
// ---------------------------------------------------------------------------

const CLEANUP_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T> | T, timeoutMs: number): Promise<T> {
  const p = Promise.resolve(promise);
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('cleanup timed out')), timeoutMs);
      p.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer)
      );
    }),
  ]);
}

export class ResourceRegistry {
  private readonly _resources: Resource[] = [];

  /**
   * Register a resource to be tracked. Resources are cleaned up in LIFO order.
   */
  register(resource: Resource): void {
    this._resources.push(resource);
    console.log(`[HAVOC][registry] registered resource "${resource.id}" (${resource.scope})`);
  }

  /**
   * Attempt to clean up all registered resources in LIFO order.
   * Every resource is attempted independently with a 5000ms timeout — one failure
   * or slow resource does NOT block the rest.
   *
   * @param signal  Optional AbortSignal for context (cleanup itself is never skipped).
   * @returns       CleanupResult indicating which resources succeeded or failed.
   */
  async cleanupAll(signal?: AbortSignal): Promise<CleanupResult> {
    void signal;
    // Take a snapshot in reverse order and clear immediately so re-entrant
    // calls (e.g. from a timeout) don't double-clean.
    const toClean = this._resources.splice(0).reverse();

    const result: CleanupResult = { succeeded: [], failed: [] };

    for (const resource of toClean) {
      try {
        await withTimeout(resource.cleanup(), CLEANUP_TIMEOUT_MS);
        result.succeeded.push(resource.id);
        console.log(`[HAVOC][registry] cleaned up "${resource.id}"`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        result.failed.push({ id: resource.id, error: errorMessage });
        console.error(`[HAVOC][registry] cleanup failed for "${resource.id}":`, errorMessage);
      }
    }

    return result;
  }

  /**
   * Clean up only resources matching a given scope.
   * Useful for tab-lifetime cleanup when a tab closes mid-run.
   */
  async cleanupScope(scope: ResourceScope): Promise<CleanupResult> {
    const indices: number[] = [];
    for (let i = this._resources.length - 1; i >= 0; i--) {
      if (this._resources[i]?.scope === scope) indices.push(i);
    }

    const result: CleanupResult = { succeeded: [], failed: [] };

    for (const idx of indices) {
      const resource = this._resources[idx];
      if (resource === undefined) continue;
      this._resources.splice(idx, 1);
      try {
        await resource.cleanup();
        result.succeeded.push(resource.id);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        result.failed.push({ id: resource.id, error: errorMessage });
        console.error(`[HAVOC][registry] scope cleanup failed for "${resource.id}":`, errorMessage);
      }
    }

    return result;
  }

  get size(): number {
    return this._resources.length;
  }
}
