/** Cache state helper for plugin loader registries, in-flight loads, and warning suppression. */
import { PluginLruCache } from "./plugin-cache-primitives.js";

/** Error thrown when one plugin registry cache key attempts nested loading. */
class PluginLoadReentryError extends Error {
  readonly cacheKey: string;

  constructor(cacheKey: string) {
    super(`plugin load reentry detected for cache key: ${cacheKey}`);
    this.name = "PluginLoadReentryError";
    this.cacheKey = cacheKey;
  }
}

/** Small registry cache with reentry detection and per-key warning memory. */
export class PluginLoaderCacheState<T> {
  readonly #registryCache: PluginLruCache<T>;
  readonly #inFlightLoads = new Set<string>();
  readonly #openAllowlistWarningCache = new Set<string>();

  constructor(defaultMaxEntries: number) {
    this.#registryCache = new PluginLruCache<T>(defaultMaxEntries);
  }

  clear(): void {
    this.#registryCache.clear();
    this.#inFlightLoads.clear();
    this.#openAllowlistWarningCache.clear();
  }

  clearCachedRegistries(): void {
    this.#registryCache.clear();
    this.#openAllowlistWarningCache.clear();
  }

  get(cacheKey: string): T | undefined {
    return this.#registryCache.get(cacheKey);
  }

  set(cacheKey: string, state: T): void {
    this.#registryCache.set(cacheKey, state);
  }

  isLoadInFlight(cacheKey: string): boolean {
    return this.#inFlightLoads.has(cacheKey);
  }

  diagnosticSnapshot(cacheKey: string): {
    cachePresent: boolean;
    loadInFlight: boolean;
    activeBuildCount: number;
    waitingCallers: number;
    existingPromise: false;
    promiseAgeMs: null;
    stateScope: "process-local";
  } {
    return {
      cachePresent: this.#registryCache.get(cacheKey) !== undefined,
      loadInFlight: this.#inFlightLoads.has(cacheKey),
      activeBuildCount: this.#inFlightLoads.size,
      waitingCallers: 0,
      existingPromise: false,
      promiseAgeMs: null,
      stateScope: "process-local",
    };
  }

  beginLoad(cacheKey: string): void {
    if (this.#inFlightLoads.has(cacheKey)) {
      throw new PluginLoadReentryError(cacheKey);
    }
    this.#inFlightLoads.add(cacheKey);
  }

  finishLoad(cacheKey: string): void {
    this.#inFlightLoads.delete(cacheKey);
  }

  hasOpenAllowlistWarning(cacheKey: string): boolean {
    return this.#openAllowlistWarningCache.has(cacheKey);
  }

  recordOpenAllowlistWarning(cacheKey: string): void {
    this.#openAllowlistWarningCache.add(cacheKey);
  }
}
