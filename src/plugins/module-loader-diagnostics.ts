import fs from "node:fs";
import path from "node:path";

export type PluginModuleLoaderDiagnostic = Readonly<{
  stage: string;
  modulePath?: string;
  code?: string;
  errorOrigin?: "TOP_LEVEL_ENTRY" | "TRANSITIVE_DEPENDENCY" | "UNKNOWN";
  errorPackage?: string;
  errorModule?: string;
  errorName?: string;
  selected?: boolean;
}>;

function diagnosticPath(): string | undefined {
  const value = process.env.OPENCLAW_PLUGIN_LOADER_DIAGNOSTICS_FILE?.trim();
  return value || undefined;
}

/** Emits opt-in loader facts without changing the normal loader path. */
export function emitPluginModuleLoaderDiagnostic(event: PluginModuleLoaderDiagnostic): void {
  const outputPath = diagnosticPath();
  if (!outputPath) {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.appendFileSync(
      outputPath,
      `${JSON.stringify({
        ...event,
        timestamp: new Date().toISOString(),
        pid: process.pid,
      })}\n`,
      "utf8",
    );
  } catch {
    // Diagnostics must never turn a loader observation into a runtime failure.
  }
}
