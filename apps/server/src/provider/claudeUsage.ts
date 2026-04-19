import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";

const CLAUDE_USAGE_CACHE_TTL_MS = 5 * 60_000;
const CLAUDE_USAGE_FAILURE_TTL_MS = 15_000;
const CLAUDE_USAGE_RATE_LIMIT_BASE_MS = 60_000;
const CLAUDE_USAGE_RATE_LIMIT_MAX_MS = 5 * 60_000;
const CLAUDE_USAGE_API_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_USAGE_API_BETA = "oauth-2025-04-20";
const CLAUDE_USAGE_USER_AGENT = "t3code/desktop";

interface ClaudeOauthCredentials {
  readonly accessToken: string;
  readonly expiresAt?: number;
  readonly subscriptionType?: string;
}

interface ClaudeUsageCacheRecord {
  readonly usage: ServerProvider["usage"];
  readonly timestamp: number;
  readonly retryAfterUntil?: number;
  readonly rateLimitedCount?: number;
  readonly lastGoodUsage?: ServerProvider["usage"];
}

export interface ClaudeUsageDependencies {
  readonly homeDir?: () => string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

function getClaudeConfigDir(homeDir: string, env: NodeJS.ProcessEnv): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured && configured.length > 0 ? configured : path.join(homeDir, ".claude");
}

function getClaudeUsageCachePath(homeDir: string): string {
  return path.join(homeDir, ".t3code", "cache", "claude-usage.json");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isUsingCustomAnthropicEndpoint(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = env.ANTHROPIC_BASE_URL?.trim() || env.ANTHROPIC_API_BASE_URL?.trim();
  if (!baseUrl) {
    return false;
  }

  try {
    return new URL(baseUrl).origin !== "https://api.anthropic.com";
  } catch {
    return true;
  }
}

function readClaudeOauthCredentials(
  configDir: string,
  now: number,
): ClaudeOauthCredentials | undefined {
  const credentialsPath = path.join(configDir, ".credentials.json");
  if (!fs.existsSync(credentialsPath)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(credentialsPath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
  const oauth = asRecord(asRecord(parsed)?.claudeAiOauth);
  const accessToken = asString(oauth?.accessToken);

  if (!accessToken) {
    return undefined;
  }

  const expiresAt = asNumber(oauth?.expiresAt);
  if (expiresAt !== undefined && expiresAt <= now) {
    return undefined;
  }
  const subscriptionType = asString(oauth?.subscriptionType);

  return {
    accessToken,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(subscriptionType ? { subscriptionType } : {}),
  };
}

function readUsageCache(cachePath: string, now: number): ServerProvider["usage"] | undefined {
  if (!fs.existsSync(cachePath)) {
    return undefined;
  }

  const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as ClaudeUsageCacheRecord;
  if (!parsed.usage) {
    return undefined;
  }

  if (parsed.retryAfterUntil && parsed.retryAfterUntil > now) {
    return parsed.usage;
  }

  const ttl =
    parsed.usage.state === "unavailable" ? CLAUDE_USAGE_FAILURE_TTL_MS : CLAUDE_USAGE_CACHE_TTL_MS;
  return now - parsed.timestamp < ttl ? parsed.usage : undefined;
}

function ensureCacheDir(cachePath: string): void {
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeUsageCache(cachePath: string, record: ClaudeUsageCacheRecord): void {
  ensureCacheDir(cachePath);
  fs.writeFileSync(cachePath, JSON.stringify(record), "utf8");
}

function readPreviousCache(cachePath: string): ClaudeUsageCacheRecord | undefined {
  if (!fs.existsSync(cachePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(cachePath, "utf8")) as ClaudeUsageCacheRecord;
}

function getRateLimitedBackoffMs(count: number): number {
  return Math.min(
    CLAUDE_USAGE_RATE_LIMIT_BASE_MS * 2 ** Math.max(0, count - 1),
    CLAUDE_USAGE_RATE_LIMIT_MAX_MS,
  );
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric * 1000;
  }

  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}

async function fetchClaudeUsageApi(
  accessToken: string,
  fetchImpl: NonNullable<ClaudeUsageDependencies["fetchImpl"]>,
): Promise<
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string; readonly retryAfterMs?: number }
> {
  const response = await fetchImpl(CLAUDE_USAGE_API_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": CLAUDE_USAGE_API_BETA,
      "User-Agent": CLAUDE_USAGE_USER_AGENT,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    return {
      ok: false,
      error: response.status === 429 ? "rate-limited" : `http-${response.status}`,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }

  return {
    ok: true,
    data: (await response.json()) as unknown,
  };
}

function buildUnavailableUsage(
  checkedAt: string,
  message: string,
  windows?: ReadonlyArray<NonNullable<ServerProvider["usage"]>["windows"][number]>,
): NonNullable<ServerProvider["usage"]> {
  return {
    state: windows && windows.length > 0 ? "syncing" : "unavailable",
    checkedAt,
    windows: windows ? [...windows] : [],
    message,
  };
}

// ── Claude OAuth usage response parser ─────────────────────────────
//
// The Anthropic OAuth usage endpoint returns `utilization` as a 0–100
// percentage (NOT a 0–1 ratio) and may include many extra fields beyond
// the two windows the sidebar surfaces (e.g. seven_day_omelette,
// extra_usage). We only extract `five_hour` and `seven_day` and treat
// their `utilization` as an already-scaled percentage, matching the
// claude-hud reference implementation.

interface ClaudeUsageWindowResponse {
  readonly utilization?: number;
  readonly resets_at?: string | null;
}

interface ClaudeUsageResponse {
  readonly five_hour?: ClaudeUsageWindowResponse | null;
  readonly seven_day?: ClaudeUsageWindowResponse | null;
}

function parseUtilizationPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function levelFromPercent(percentUsed: number | null): ServerProviderUsageWindow["level"] {
  if ((percentUsed ?? 0) >= 100) return "exhausted";
  if ((percentUsed ?? 0) >= 85) return "critical";
  if ((percentUsed ?? 0) >= 70) return "warning";
  return "normal";
}

function buildClaudeWindow(
  id: string,
  label: string,
  raw: ClaudeUsageWindowResponse | null | undefined,
): ServerProviderUsageWindow | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const percentUsed = parseUtilizationPercent(raw.utilization);
  const resetsAt = parseIsoDate(raw.resets_at);
  if (percentUsed === null && !resetsAt) {
    return undefined;
  }
  const exhausted = percentUsed !== null && percentUsed >= 100;
  return {
    id,
    label,
    percentUsed,
    resetsAt,
    exhausted,
    level: levelFromPercent(percentUsed),
  };
}

function parseClaudeUsageSnapshot(
  value: unknown,
  checkedAt: string,
): ServerProvider["usage"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const response = value as ClaudeUsageResponse;
  const windows: ServerProviderUsageWindow[] = [];
  const fiveHour = buildClaudeWindow("five-hour", "5h", response.five_hour);
  if (fiveHour) windows.push(fiveHour);
  const sevenDay = buildClaudeWindow("seven-day", "7d", response.seven_day);
  if (sevenDay) windows.push(sevenDay);

  if (windows.length === 0) {
    return undefined;
  }

  return {
    state: "available",
    checkedAt,
    windows,
  };
}

export async function resolveClaudeUsageSnapshot(
  dependencies: ClaudeUsageDependencies = {},
): Promise<ServerProvider["usage"] | undefined> {
  const homeDir = dependencies.homeDir?.() ?? os.homedir();
  const env = dependencies.env ?? process.env;
  const now = dependencies.now?.() ?? Date.now();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const cachePath = getClaudeUsageCachePath(homeDir);

  if (isUsingCustomAnthropicEndpoint(env)) {
    return undefined;
  }

  const cachedUsage = readUsageCache(cachePath, now);
  if (cachedUsage) {
    return cachedUsage;
  }

  const credentials = readClaudeOauthCredentials(getClaudeConfigDir(homeDir, env), now);
  if (!credentials?.subscriptionType) {
    return undefined;
  }

  const checkedAt = new Date(now).toISOString();

  try {
    const result = await fetchClaudeUsageApi(credentials.accessToken, fetchImpl);
    if (!result.ok) {
      const previous = readPreviousCache(cachePath);
      const rateLimitedCount =
        result.error === "rate-limited" ? (previous?.rateLimitedCount ?? 0) + 1 : 0;
      const fallbackUsage =
        result.error === "rate-limited" ? (previous?.lastGoodUsage ?? previous?.usage) : undefined;
      const usage = buildUnavailableUsage(
        checkedAt,
        result.error === "rate-limited"
          ? "Claude usage is temporarily rate limited; showing the last synced values."
          : "Claude usage telemetry is temporarily unavailable.",
        fallbackUsage?.windows,
      );

      writeUsageCache(cachePath, {
        usage,
        timestamp: now,
        rateLimitedCount,
        ...(result.error === "rate-limited"
          ? {
              retryAfterUntil:
                now + (result.retryAfterMs ?? getRateLimitedBackoffMs(rateLimitedCount)),
            }
          : {}),
        ...(fallbackUsage ? { lastGoodUsage: fallbackUsage } : {}),
      });

      return usage;
    }

    const usage = parseClaudeUsageSnapshot(result.data, checkedAt);
    if (!usage) {
      return undefined;
    }

    writeUsageCache(cachePath, {
      usage,
      timestamp: now,
      lastGoodUsage: usage,
    });
    return usage;
  } catch {
    const previous = readPreviousCache(cachePath);
    const usage = buildUnavailableUsage(
      checkedAt,
      "Claude usage telemetry is temporarily unavailable.",
      previous?.lastGoodUsage?.windows,
    );
    writeUsageCache(cachePath, {
      usage,
      timestamp: now,
      ...(previous?.lastGoodUsage ? { lastGoodUsage: previous.lastGoodUsage } : {}),
    });
    return usage;
  }
}
