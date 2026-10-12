/** Tests plugin loader cache state keys, invalidation, and reset behavior. */
import { describe, expect, it } from "vitest";
import { PluginLoaderCacheState } from "./loader-cache-state.js";

describe("PluginLoaderCacheState", () => {
  it("evicts the least recently used registry cache entry", () => {
    const cache = new PluginLoaderCacheState<string>(2);

    cache.set("", "empty");
    cache.set("a", "alpha");
    cache.set("b", "bravo");
    expect(cache.get("a")).toBe("alpha");

    cache.set("c", "charlie");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("alpha");
    expect(cache.get("c")).toBe("charlie");
  });

  it("clears registry, in-flight, and warning state together", () => {
    const cache = new PluginLoaderCacheState<string>(2);

    cache.set("demo", "registry");
    cache.beginLoad("demo");
    cache.recordOpenAllowlistWarning("demo-warning");

    cache.clear();

    expect(cache.get("demo")).toBeUndefined();
    expect(cache.isLoadInFlight("demo")).toBe(false);
    expect(cache.hasOpenAllowlistWarning("demo-warning")).toBe(false);
  });

  it("clears cached registries without dropping in-flight load guards", () => {
    const cache = new PluginLoaderCacheState<string>(2);

    cache.set("demo", "registry");
    cache.beginLoad("demo");
    cache.recordOpenAllowlistWarning("demo-warning");

    cache.clearCachedRegistries();

    expect(cache.get("demo")).toBeUndefined();
    expect(cache.isLoadInFlight("demo")).toBe(true);
    expect(cache.hasOpenAllowlistWarning("demo-warning")).toBe(false);
  });

  it("reports synchronous cache and in-flight ownership without inventing waiters", () => {
    const cache = new PluginLoaderCacheState<string>(2);

    expect(cache.diagnosticSnapshot("demo")).toMatchObject({
      cachePresent: false,
      loadInFlight: false,
      activeBuildCount: 0,
      waitingCallers: 0,
      existingPromise: false,
      promiseAgeMs: null,
      stateScope: "process-local",
    });

    cache.set("demo", "registry");
    expect(cache.diagnosticSnapshot("demo")).toMatchObject({
      cachePresent: true,
      loadInFlight: false,
    });

    cache.beginLoad("other");
    expect(cache.diagnosticSnapshot("other")).toMatchObject({
      cachePresent: false,
      loadInFlight: true,
      activeBuildCount: 1,
    });
    expect(cache.diagnosticSnapshot("demo").activeBuildCount).toBe(1);
    cache.finishLoad("other");
  });

  it("rejects a second synchronous builder for the same cache key", () => {
    const cache = new PluginLoaderCacheState<string>(2);

    cache.beginLoad("demo");
    expect(() => cache.beginLoad("demo")).toThrow(/reentry detected/);
    expect(cache.diagnosticSnapshot("demo")).toMatchObject({
      loadInFlight: true,
      activeBuildCount: 1,
    });
    cache.finishLoad("demo");
  });
});
