import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ServerProvider,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";

export interface CodexUsageDependencies {
  readonly homePath?: string;
  readonly homeDir?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
}

interface RolloutLine {
  readonly timestamp?: string;
  readonly type?: string;
  readonly payload?: unknown;
}

interface RawWindow {
  readonly used_percent?: unknown;
  readonly resets_at?: unknown;
  readonly window_minutes?: unknown;
}

interface RawRateLimits {
  readonly limit_id?: unknown;
  readonly limit_name?: unknown;
  readonly primary?: RawWindow;
  readonly secondary?: RawWindow;
}

function getCodexHome(deps: CodexUsageDependencies): string {
  if (deps.homePath && deps.homePath.trim().length > 0) return deps.homePath;
  const env = deps.env ?? process.env;
  const fromEnv = env.CODEX_HOME?.trim();
  if (fromEnv) return fromEnv;
  const homeDir = deps.homeDir?.() ?? os.homedir();
  return path.join(homeDir, ".codex");
}

function findLatestRollout(codexHome: string): string | undefined {
  const sessionsDir = path.join(codexHome, "sessions");
  if (!fs.existsSync(sessionsDir)) return undefined;

  let latestPath: string | undefined;
  let latestMtime = 0;

  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (
        !entry.isFile() ||
        !entry.name.startsWith("rollout-") ||
        !entry.name.endsWith(".jsonl")
      ) {
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs > latestMtime) {
          latestMtime = stat.mtimeMs;
          latestPath = full;
        }
      } catch {
        // ignore stat errors
      }
    }
  }

  return latestPath;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function resetsAtIso(value: unknown): string | null {
  const num = toNumber(value);
  if (num !== undefined) {
    // Rollout files use unix seconds.
    return new Date(num * 1000).toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function windowLabel(windowMinutes: number | undefined, fallback: string): string {
  if (windowMinutes === undefined) return fallback;
  if (windowMinutes >= 60 * 24) {
    const days = Math.round(windowMinutes / (60 * 24));
    return `${days}d`;
  }
  if (windowMinutes >= 60) {
    const hours = Math.round(windowMinutes / 60);
    return `${hours}h`;
  }
  return `${windowMinutes}m`;
}

function levelFromPercent(
  percentUsed: number,
  exhausted: boolean,
): ServerProviderUsageWindow["level"] {
  if (exhausted || percentUsed >= 100) return "exhausted";
  if (percentUsed >= 85) return "critical";
  if (percentUsed >= 70) return "warning";
  return "normal";
}

function toUsageWindow(
  id: string,
  fallbackLabel: string,
  raw: RawWindow | undefined,
): ServerProviderUsageWindow | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const percent = toNumber(raw.used_percent);
  if (percent === undefined) return undefined;
  const clamped = Math.max(0, Math.min(100, percent));
  const windowMinutes = toNumber(raw.window_minutes);
  const label = windowLabel(windowMinutes, fallbackLabel);
  const exhausted = clamped >= 100;
  return {
    id,
    label,
    percentUsed: clamped,
    resetsAt: resetsAtIso(raw.resets_at),
    exhausted,
    level: levelFromPercent(clamped, exhausted),
  };
}

function findLastTokenCountRateLimits(
  rolloutPath: string,
): { readonly rateLimits: RawRateLimits; readonly at: string } | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(rolloutPath, "utf8");
  } catch {
    return undefined;
  }

  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let parsed: RolloutLine;
    try {
      parsed = JSON.parse(line) as RolloutLine;
    } catch {
      continue;
    }
    if (parsed.type !== "event_msg" || !parsed.payload || typeof parsed.payload !== "object") {
      continue;
    }
    const event = parsed.payload as Record<string, unknown>;
    if (event.type !== "token_count") continue;
    const rateLimits = event.rate_limits;
    if (!rateLimits || typeof rateLimits !== "object") continue;
    return {
      rateLimits: rateLimits as RawRateLimits,
      at: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
    };
  }

  return undefined;
}

export function readCodexUsageFromRollout(
  rolloutPath: string,
): ServerProvider["usage"] | undefined {
  const found = findLastTokenCountRateLimits(rolloutPath);
  if (!found) return undefined;

  const primary = toUsageWindow("primary", "Primary", found.rateLimits.primary);
  const secondary = toUsageWindow("secondary", "Secondary", found.rateLimits.secondary);
  const windows = [primary, secondary].filter(
    (entry): entry is ServerProviderUsageWindow => entry !== undefined,
  );
  if (windows.length === 0) return undefined;

  return {
    state: "available",
    checkedAt: found.at,
    windows,
  };
}

export function resolveCodexUsageSnapshot(
  dependencies: CodexUsageDependencies = {},
): ServerProvider["usage"] | undefined {
  const codexHome = getCodexHome(dependencies);
  const rollout = findLatestRollout(codexHome);
  if (!rollout) return undefined;
  return readCodexUsageFromRollout(rollout);
}
