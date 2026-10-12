import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import type { PluginDiscoveryResult } from "./discovery.js";
import type { PluginManifestRegistry } from "./manifest-registry.js";
import type { PluginRegistryParams } from "./registry-types.js";
import type { CreatePluginRuntimeOptions } from "./runtime/types.js";
import type { PluginSdkResolutionPreference } from "./sdk-alias.js";
import type { PluginLogger } from "./types.js";

export type PluginRuntimeSubagentMode = "default" | "explicit" | "gateway-bindable";
export type ChannelPluginLoadIntent = "full" | "setup";

export type PluginRegistryLoadTraceStage =
  | "runtime-registry-entered"
  | "runtime-registry-key-built"
  | "runtime-registry-cache-lookup-entered"
  | "runtime-registry-cache-lookup-complete"
  | "runtime-registry-cache-hit"
  | "runtime-registry-cache-miss"
  | "runtime-registry-build-started"
  | "runtime-registry-builder-created"
  | "runtime-registry-discovery-started"
  | "runtime-registry-discovery-completed"
  | "runtime-registry-registration-started"
  | "runtime-registry-candidate-entered"
  | "runtime-registry-candidate-artifact-resolution-started"
  | "runtime-registry-candidate-artifact-resolution-completed"
  | "runtime-registry-candidate-file-open-started"
  | "runtime-registry-candidate-file-open-completed"
  | "runtime-registry-candidate-module-load-started"
  | "runtime-registry-candidate-module-load-completed"
  | "runtime-registry-candidate-setup-started"
  | "runtime-registry-candidate-setup-completed"
  | "runtime-registry-candidate-register-started"
  | "runtime-registry-candidate-register-completed"
  | "runtime-registry-candidate-completed"
  | "runtime-registry-registration-completed"
  | "runtime-registry-finalization-started"
  | "runtime-registry-finalization-completed"
  | "runtime-registry-completed"
  | "runtime-registry-failed"
  | "runtime-registry-build-finished";

export type PluginRegistryLoadTraceEvent = Readonly<{
  stage: PluginRegistryLoadTraceStage;
  cacheKeyHash?: string;
  cachePresent?: boolean;
  loadInFlight?: boolean;
  activeBuildCount?: number;
  waitingCallers?: number;
  existingPromise?: boolean;
  promiseAgeMs?: number | null;
  registryInstanceId?: string;
  pluginId?: string;
  pluginOrigin?: string;
  stateScope: "process-local";
}>;

/** Inputs shared by runtime, snapshot, and CLI-metadata plugin loading. */
export type PluginLoadOptions = {
  config?: OpenClawConfig;
  activationSourceConfig?: OpenClawConfig;
  autoEnabledReasons?: Readonly<Record<string, string[]>>;
  workspaceDir?: string;
  installRecords?: Record<string, PluginInstallRecord>;
  /** Resolve plugin roots and load paths against an explicit environment. */
  env?: NodeJS.ProcessEnv;
  /** Apply the config IO env-substitution pass to direct raw-config callers. */
  resolveRawConfigEnvVars?: boolean;
  logger?: PluginLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  coreGatewayMethodNames?: readonly string[];
  /** Registry-construction fact supplied by the process composition root. */
  allowProcessHomeSessionCatalogs?: boolean;
  hostServices?: PluginRegistryParams["hostServices"];
  runtimeOptions?: CreatePluginRuntimeOptions;
  startupTrace?: {
    detail: (name: string, metrics: ReadonlyArray<readonly [string, number | string]>) => void;
  };
  registryTrace?: {
    event: (event: PluginRegistryLoadTraceEvent) => void;
  };
  pluginSdkResolution?: PluginSdkResolutionPreference;
  cache?: boolean;
  mode?: "full" | "validate";
  onlyPluginIds?: string[];
  includeSetupOnlyChannelPlugins?: boolean;
  forceSetupOnlyChannelPlugins?: boolean;
  requireSetupEntryForSetupOnlyChannelPlugins?: boolean;
  /** Select full runtime registration or the lightweight unconfigured-channel setup path. */
  channelPluginLoadIntent?: ChannelPluginLoadIntent;
  /** Prefer bundled JavaScript artifacts over source TypeScript entrypoints. */
  preferBuiltPluginArtifacts?: boolean;
  toolDiscovery?: boolean;
  activate?: boolean;
  loadModules?: boolean;
  throwOnLoadError?: boolean;
  manifestRegistry?: PluginManifestRegistry;
  discovery?: PluginDiscoveryResult;
};
