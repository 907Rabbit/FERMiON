// Resolves native module require paths for plugin runtime loading.
import fs from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPathInside } from "../infra/path-guards.js";
import { emitPluginModuleLoaderDiagnostic } from "./module-loader-diagnostics.js";

const nodeRequire = createRequire(import.meta.url);
type ResolveFilename = (
  request: string,
  parent: NodeJS.Module | undefined,
  isMain: boolean,
  options?: { paths?: string[] },
) => string;
const moduleWithResolver = Module as typeof Module & {
  _resolveFilename?: ResolveFilename;
  registerHooks?: (options: {
    resolve?: (
      specifier: string,
      context: { parentURL?: string | undefined },
      nextResolve: (
        specifier: string,
        context?: { parentURL?: string | undefined },
      ) => {
        url: string;
      },
    ) => { shortCircuit?: boolean; url: string };
  }) => { deregister: () => void };
};

/** True for file extensions Node can load through the native JS module loader. */
export function isJavaScriptModulePath(modulePath: string): boolean {
  return [".js", ".mjs", ".cjs"].includes(
    path.extname(normalizeNativeModulePath(modulePath)).toLowerCase(),
  );
}

function normalizeNativeModulePath(modulePath: string): string {
  if (!modulePath.startsWith("file://")) {
    return modulePath;
  }
  try {
    return fileURLToPath(modulePath);
  } catch {
    return modulePath;
  }
}

function isMissingTargetModuleError(error: unknown, modulePath: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== "MODULE_NOT_FOUND" || typeof candidate.message !== "string") {
    return false;
  }
  const firstLine = candidate.message.split("\n", 1)[0] ?? "";
  const normalizedPath = normalizeNativeModulePath(modulePath);
  return (
    firstLine.includes(`'${modulePath}'`) ||
    firstLine.includes(`"${modulePath}"`) ||
    firstLine.includes(`'${normalizedPath}'`) ||
    firstLine.includes(`"${normalizedPath}"`)
  );
}

function isSourceTransformFallbackError(error: unknown, modulePath: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  const code = candidate.code;
  return (
    code === "ERR_REQUIRE_ESM" ||
    code === "ERR_REQUIRE_ASYNC_MODULE" ||
    code === "ERR_REQUIRE_ESM_RACE_CONDITION" ||
    code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ||
    isMissingTargetModuleError(candidate, modulePath)
  );
}

type NativeLoadErrorOrigin = "TOP_LEVEL_ENTRY" | "TRANSITIVE_DEPENDENCY" | "UNKNOWN";

function readErrorString(
  error: unknown,
  key: "path" | "modulePath" | "request",
): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readErrorPackage(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const match = error.message.match(
    /(?:defined in|defined by .* in) (.+?package\.json)(?:$|\r?\n)/u,
  );
  return match?.[1];
}

function isEntryPathMentioned(error: unknown, modulePath: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const normalizedPath = normalizeNativeModulePath(modulePath);
  return [error.message, error.stack ?? ""].some(
    (value) => value.includes(modulePath) || value.includes(normalizedPath),
  );
}

function classifyNativeLoadError(error: unknown, modulePath: string): NativeLoadErrorOrigin {
  if (isMissingTargetModuleError(error, modulePath)) {
    return "TOP_LEVEL_ENTRY";
  }
  const errorModule =
    readErrorString(error, "modulePath") ??
    readErrorString(error, "request") ??
    readErrorString(error, "path");
  if (
    errorModule &&
    normalizeNativeModulePath(errorModule) !== normalizeNativeModulePath(modulePath)
  ) {
    return "TRANSITIVE_DEPENDENCY";
  }
  const errorPackage = readErrorPackage(error);
  if (errorPackage) {
    let entryPackage = path.join(
      path.dirname(normalizeNativeModulePath(modulePath)),
      "package.json",
    );
    let cursor = path.dirname(normalizeNativeModulePath(modulePath));
    for (let depth = 0; depth < 12; depth += 1) {
      const candidate = path.join(cursor, "package.json");
      if (fs.existsSync(candidate)) {
        entryPackage = candidate;
        break;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
    if (path.resolve(errorPackage) !== path.resolve(entryPackage)) {
      return "TRANSITIVE_DEPENDENCY";
    }
  }
  if (
    error &&
    typeof error === "object" &&
    Array.isArray((error as { requireStack?: unknown }).requireStack)
  ) {
    return "TRANSITIVE_DEPENDENCY";
  }
  if (isEntryPathMentioned(error, modulePath)) {
    return "TOP_LEVEL_ENTRY";
  }
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "ERR_REQUIRE_ESM_RACE_CONDITION") {
    return "TOP_LEVEL_ENTRY";
  }
  return "UNKNOWN";
}

/** Attempts native require before falling back to source transform paths. */
export function tryNativeRequireJavaScriptModule(
  modulePath: string,
  options: {
    allowWindows?: boolean;
    aliasMap?: Record<string, string>;
    fallbackOnMissingDependency?: boolean;
    fallbackOnNativeError?: boolean;
  } = {},
): { ok: true; moduleExport: unknown } | { ok: false } {
  if (process.platform === "win32" && options.allowWindows !== true) {
    return { ok: false };
  }
  const nativeModulePath = normalizeNativeModulePath(modulePath);
  if (!isJavaScriptModulePath(nativeModulePath)) {
    return { ok: false };
  }
  try {
    emitPluginModuleLoaderDiagnostic({
      stage: "native-module-load-entered",
      modulePath,
    });
    const moduleExport = requireWithOptionalAliases(nativeModulePath, options.aliasMap);
    emitPluginModuleLoaderDiagnostic({
      stage: "native-module-load-complete",
      modulePath,
    });
    return { ok: true, moduleExport };
  } catch (error) {
    const code =
      error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    const errorOrigin = classifyNativeLoadError(error, modulePath);
    const errorModule =
      readErrorString(error, "modulePath") ??
      readErrorString(error, "request") ??
      readErrorString(error, "path");
    const errorPackage = readErrorPackage(error);
    emitPluginModuleLoaderDiagnostic({
      stage: "native-module-load-error",
      modulePath,
      ...(typeof code === "string" ? { code } : {}),
      errorOrigin,
      ...(errorPackage ? { errorPackage } : {}),
      ...(errorModule ? { errorModule } : {}),
      ...(error instanceof Error ? { errorName: error.name } : {}),
    });
    emitPluginModuleLoaderDiagnostic({
      stage: "fallback-decision-entered",
      modulePath,
      ...(typeof code === "string" ? { code } : {}),
      errorOrigin,
      ...(errorPackage ? { errorPackage } : {}),
      ...(errorModule ? { errorModule } : {}),
    });
    const fallbackSelected =
      errorOrigin === "TOP_LEVEL_ENTRY" &&
      (isSourceTransformFallbackError(error, modulePath) ||
        options.fallbackOnNativeError ||
        (options.fallbackOnMissingDependency === true &&
          (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND")));
    emitPluginModuleLoaderDiagnostic({
      stage: "fallback-decision-complete",
      modulePath,
      selected: fallbackSelected,
      ...(typeof code === "string" ? { code } : {}),
      errorOrigin,
    });
    if (fallbackSelected) {
      return { ok: false };
    }
    throw error;
  }
}

/** Clears a native-loaded module and dependency subtree under the plugin dependency root. */
export function clearNativeRequireJavaScriptModuleCache(
  modulePath: string,
  options: { dependencyRoot?: string } = {},
): void {
  if (!isJavaScriptModulePath(modulePath)) {
    return;
  }
  try {
    const resolved = nodeRequire.resolve(normalizeNativeModulePath(modulePath));
    clearRequireCacheSubtree(
      resolved,
      resolveRequireCachePath(options.dependencyRoot ?? path.dirname(resolved)),
      new Set(),
    );
  } catch {
    // Best-effort lifecycle cleanup: unresolved paths were not native-loaded.
  }
}

function resolveRequireCachePath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function clearRequireCacheSubtree(
  resolvedPath: string,
  dependencyRoot: string,
  seen: Set<string>,
): void {
  if (seen.has(resolvedPath)) {
    return;
  }
  seen.add(resolvedPath);
  const cached = nodeRequire.cache[resolvedPath];
  if (cached) {
    for (const child of cached.children) {
      if (isPathInside(dependencyRoot, child.id)) {
        clearRequireCacheSubtree(child.id, dependencyRoot, seen);
      }
    }
  }
  delete nodeRequire.cache[resolvedPath];
}

function requireWithOptionalAliases(
  modulePath: string,
  aliasMap: Record<string, string> | undefined,
): unknown {
  return withNativeRequireAliases(aliasMap, () => nodeRequire(modulePath));
}

/** Runs a native require block with temporary CJS/ESM alias hooks and restores both afterward. */
function withNativeRequireAliases<T>(
  aliasMap: Record<string, string> | undefined,
  run: () => T,
): T {
  if (!aliasMap || Object.keys(aliasMap).length === 0 || !moduleWithResolver["_resolveFilename"]) {
    return run();
  }
  const originalResolveFilename = moduleWithResolver["_resolveFilename"];
  const esmHooks = moduleWithResolver.registerHooks?.({
    resolve(specifier, context, nextResolve) {
      const aliasTarget = aliasMap[specifier];
      if (aliasTarget) {
        return {
          shortCircuit: true,
          url: pathToFileURL(aliasTarget).href,
        };
      }
      return nextResolve(specifier, context);
    },
  });
  moduleWithResolver["_resolveFilename"] = ((request, parent, isMain, options) => {
    const aliasTarget = aliasMap[request];
    if (aliasTarget) {
      return aliasTarget;
    }
    return originalResolveFilename(request, parent, isMain, options);
  }) satisfies ResolveFilename;
  try {
    return run();
  } finally {
    moduleWithResolver["_resolveFilename"] = originalResolveFilename;
    esmHooks?.deregister();
  }
}
