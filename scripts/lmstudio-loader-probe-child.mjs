import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const root = process.cwd();
const sourceEntryPath = path.resolve(root, "extensions/lmstudio/index.ts");
const builtEntryPath = path.resolve(root, "dist/extensions/lmstudio/index.js");
const entryPath = fs.existsSync(builtEntryPath) ? builtEntryPath : sourceEntryPath;
const entrySpecifier = pathToFileURL(entryPath).href;

function marker(stage, details = {}) {
  process.stdout.write(
    `${JSON.stringify({ stage, timestamp: new Date().toISOString(), pid: process.pid, ...details })}\n`,
  );
}

function errorDetails(error) {
  return {
    errorName: error instanceof Error ? error.name : undefined,
    errorCode:
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined,
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

async function installTransitiveModuleTrace() {
  const moduleNamespace = await import("node:module");
  const moduleApi = moduleNamespace.default;
  const originalLoad = Reflect.get(moduleApi, "_load");
  if (typeof originalLoad !== "function") {
    return;
  }
  Reflect.set(moduleApi, "_load", function tracedLoad(request, parent, isMain) {
    const parentFilename = parent?.filename;
    const interesting =
      !request.startsWith("node:") &&
      (request.includes("lmstudio") ||
        request.startsWith("openclaw") ||
        parentFilename?.includes(`${path.sep}extensions${path.sep}lmstudio${path.sep}`) === true);
    if (interesting) {
      marker("transitive-module-load-entered", { request, parentFilename });
    }
    try {
      const loaded = Reflect.apply(originalLoad, this, [request, parent, isMain]);
      if (interesting) {
        marker("transitive-module-load-complete", { request, parentFilename });
      }
      return loaded;
    } catch (error) {
      if (interesting) {
        marker("transitive-module-load-error", { request, parentFilename, ...errorDetails(error) });
      }
      throw error;
    }
  });
}

async function installResourceOperationTrace() {
  const childProcess = await import("node:child_process");
  for (const method of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) {
    const original = Reflect.get(childProcess, method);
    if (typeof original !== "function") {
      continue;
    }
    Reflect.set(childProcess, method, function tracedChildProcess(...args) {
      marker("child-process-created", { method, command: String(args[0] ?? "") });
      try {
        const result = Reflect.apply(original, this, args);
        marker("child-process-call-complete", { method });
        return result;
      } catch (error) {
        marker("child-process-call-error", { method, ...errorDetails(error) });
        throw error;
      }
    });
  }
  const fsModule = await import("node:fs");
  for (const method of ["readFileSync", "openSync", "statSync", "existsSync", "accessSync"]) {
    const original = Reflect.get(fsModule, method);
    if (typeof original !== "function") {
      continue;
    }
    Reflect.set(fsModule, method, function tracedSyncFs(...args) {
      const target = String(args[0] ?? "");
      const normalizedTarget = target.replaceAll("\\", "/");
      const relevant =
        normalizedTarget.includes("/extensions/lmstudio/") ||
        normalizedTarget.includes("/dist/extensions/lmstudio/") ||
        normalizedTarget.includes("/node_modules/unicorn-magic/");
      if (relevant) {
        marker("sync-fs-operation-entered", { method, target });
      }
      try {
        const result = Reflect.apply(original, this, args);
        if (relevant) {
          marker("sync-fs-operation-complete", { method, target });
        }
        return result;
      } catch (error) {
        if (relevant) {
          marker("sync-fs-operation-error", { method, target, ...errorDetails(error) });
        }
        throw error;
      }
    });
  }
}

async function loadWithJiti(asyncMode) {
  const { createJiti } = await import("jiti");
  const { buildPluginLoaderAliasMap, buildPluginLoaderJitiOptions } = await import(
    pathToFileURL(path.resolve(root, "src/plugins/sdk-alias.ts")).href
  );
  const aliasMap = buildPluginLoaderAliasMap(entryPath);
  const options = buildPluginLoaderJitiOptions(aliasMap, { modulePath: entryPath });
  marker("jiti-loader-create-entered", { modulePath: entryPath });
  const jiti = createJiti(
    pathToFileURL(path.resolve(root, "scripts/lmstudio-loader-probe-child.mjs")).href,
    {
      ...options,
      tryNative: false,
    },
  );
  marker("jiti-loader-create-complete", { modulePath: entryPath });
  marker("jiti-module-load-entered", { modulePath: entrySpecifier, async: asyncMode });
  const loaded = asyncMode ? await jiti.import(entrySpecifier) : jiti(entrySpecifier);
  marker("jiti-module-load-complete", { modulePath: entrySpecifier, async: asyncMode });
  return loaded;
}

async function loadWithCurrentLoader(forceNative) {
  const { createPluginModuleLoader, resolvePluginModuleExport } = await import(
    pathToFileURL(path.resolve(root, "src/plugins/loader-module-runtime.ts")).href
  );
  const loader = forceNative
    ? createPluginModuleLoader({ tryNative: true })
    : createPluginModuleLoader({});
  marker("production-loader-created", { forceNative });
  marker("jiti-module-load-entered", { modulePath: entrySpecifier, productionLoader: true });
  const loaded = loader(entryPath);
  marker("jiti-module-load-complete", { modulePath: entrySpecifier, productionLoader: true });
  marker("module-export-validation-entered", { modulePath: entryPath });
  resolvePluginModuleExport(loaded);
  marker("module-export-validation-complete", { modulePath: entryPath });
  return loaded;
}

async function loadWithRuntimeRegistry() {
  const { loadOpenClawPlugins } = await import(
    pathToFileURL(path.resolve(root, "src/plugins/loader-runtime-load.ts")).href
  );
  marker("runtime-registry-load-entered", { pluginId: "lmstudio" });
  const registry = loadOpenClawPlugins({
    activate: false,
    cache: false,
    onlyPluginIds: ["lmstudio"],
    throwOnLoadError: true,
    config: { plugins: { allow: ["lmstudio"] } },
  });
  marker("runtime-registry-load-complete", { pluginCount: registry.plugins.length });
  return registry;
}

async function main() {
  marker("child-started", {
    mode,
    moduleSpecifier: entrySpecifier,
    resolvedPath: entryPath,
    sourceEntryPath,
    builtEntryPath,
  });
  await installTransitiveModuleTrace();
  await installResourceOperationTrace();
  if (!mode) {
    throw new Error("missing probe mode");
  }
  if (mode === "native-import") {
    marker("native-module-load-entered", { modulePath: entrySpecifier });
    const loaded = await import(entrySpecifier);
    marker("native-module-load-complete", { modulePath: entrySpecifier });
    return loaded;
  }
  if (mode === "require") {
    marker("native-module-load-entered", { modulePath: entryPath });
    const loaded = createRequire(import.meta.url)(entryPath);
    marker("native-module-load-complete", { modulePath: entryPath });
    return loaded;
  }
  if (mode === "current-loader") {
    return await loadWithCurrentLoader(false);
  }
  if (mode === "current-native-loader") {
    return await loadWithCurrentLoader(true);
  }
  if (mode === "jiti-sync") {
    return await loadWithJiti(false);
  }
  if (mode === "jiti-async") {
    return await loadWithJiti(true);
  }
  if (mode === "runtime-registry") {
    return await loadWithRuntimeRegistry();
  }
  throw new Error(`unknown probe mode: ${mode}`);
}

try {
  await main();
  marker("probe-complete", { mode });
} catch (error) {
  marker("probe-error", { mode, ...errorDetails(error) });
  process.exitCode = 1;
}
