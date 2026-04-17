import type {
  ProviderRuntimeEvent,
  ServerProvider,
  ServerProviderUsage,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";

import { codexAuthSubLabel, codexAuthSubType, readCodexAccountSnapshot } from "./codexAccount.ts";

type UnknownRecord = Record<string, unknown>;

const WINDOW_CONTAINER_KEYS = ["windows", "limits", "rateLimits", "rate_limits"] as const;
const WINDOW_PERCENT_KEYS = [
  "percentUsed",
  "usedPercent",
  "percentageUsed",
  "used_percentage",
  "used_percent",
  "percentage",
  "percent",
  "pct",
  "currentPercent",
  "current_percent",
] as const;
const WINDOW_RATIO_KEYS = [
  "utilization",
  "utilisation",
  "ratio",
  "usageRatio",
  "usedRatio",
] as const;
const WINDOW_RESET_KEYS = [
  "resetsAt",
  "resetAt",
  "resets_at",
  "reset_at",
  "retryAt",
  "retry_at",
] as const;
const WINDOW_MESSAGE_KEYS = ["message", "detail", "error", "reason"] as const;
const WINDOW_STATE_KEYS = ["state", "status"] as const;

function asRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as UnknownRecord;
}

function asArray(value: unknown): ReadonlyArray<unknown> | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function toPercent(value: number, fractional: boolean): number {
  return clampPercent(fractional ? value * 100 : value);
}

function normalizeUsageState(value: unknown): ServerProviderUsage["state"] | undefined {
  const normalized = asString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.includes("sync")) {
    return "syncing";
  }
  if (
    normalized.includes("unavailable") ||
    normalized.includes("error") ||
    normalized.includes("failed")
  ) {
    return "unavailable";
  }
  if (
    normalized.includes("available") ||
    normalized.includes("ready") ||
    normalized.includes("ok")
  ) {
    return "available";
  }
  return undefined;
}

function levelFromPercent(
  percentUsed: number | null,
  exhausted: boolean,
): ServerProviderUsageWindow["level"] {
  if (exhausted || (percentUsed ?? 0) >= 100) {
    return "exhausted";
  }
  if ((percentUsed ?? 0) >= 85) {
    return "critical";
  }
  if ((percentUsed ?? 0) >= 70) {
    return "warning";
  }
  return "normal";
}

function formatKeyLabel(key: string): string {
  const normalized = key.replace(/[\s_-]+/g, "").toLowerCase();
  switch (normalized) {
    case "fivehour":
    case "5hour":
    case "5h":
      return "5h";
    case "sevenday":
    case "7day":
    case "7d":
      return "7d";
    case "hourly":
    case "onehour":
    case "1hour":
    case "1h":
      return "1h";
    case "daily":
    case "oneday":
    case "1day":
    case "1d":
      return "1d";
    default:
      return key
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim();
  }
}

function sanitizeWindowId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "usage"
  );
}

function parseIsoDate(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function readPercent(record: UnknownRecord): number | null {
  for (const key of WINDOW_PERCENT_KEYS) {
    const value = asNumber(record[key]);
    if (value !== undefined) {
      return toPercent(value, false);
    }
  }
  for (const key of WINDOW_RATIO_KEYS) {
    const value = asNumber(record[key]);
    if (value !== undefined) {
      return toPercent(value, true);
    }
  }
  return null;
}

function readWindowLabel(record: UnknownRecord, fallbackKey?: string): string {
  const explicit =
    asString(record.label) ??
    asString(record.name) ??
    asString(record.window) ??
    asString(record.id);
  if (explicit) {
    return explicit;
  }
  return fallbackKey ? formatKeyLabel(fallbackKey) : "Usage";
}

function hasWindowShape(record: UnknownRecord): boolean {
  return (
    WINDOW_PERCENT_KEYS.some((key) => asNumber(record[key]) !== undefined) ||
    WINDOW_RATIO_KEYS.some((key) => asNumber(record[key]) !== undefined) ||
    WINDOW_RESET_KEYS.some((key) => parseIsoDate(record[key]) !== null) ||
    asBoolean(record.exhausted) === true ||
    asBoolean(record.is_exhausted) === true
  );
}

function collectWindowCandidates(
  value: unknown,
): ReadonlyArray<{ readonly key?: string; readonly record: UnknownRecord }> {
  const directArray = asArray(value);
  if (directArray) {
    return directArray
      .map((entry) => asRecord(entry))
      .filter((entry): entry is UnknownRecord => entry !== undefined)
      .map((record) => ({ record }));
  }

  const root = asRecord(value);
  if (!root) {
    return [];
  }

  const candidates: Array<{ readonly key?: string; readonly record: UnknownRecord }> = [];

  if (hasWindowShape(root)) {
    candidates.push({ record: root });
  }

  for (const key of WINDOW_CONTAINER_KEYS) {
    const nestedArray = asArray(root[key]);
    if (!nestedArray) {
      continue;
    }
    for (const entry of nestedArray) {
      const record = asRecord(entry);
      if (record && hasWindowShape(record)) {
        candidates.push({ record });
      }
    }
  }

  for (const [key, nested] of Object.entries(root)) {
    const record = asRecord(nested);
    if (!record || !hasWindowShape(record)) {
      continue;
    }
    candidates.push({ key, record });
  }

  return candidates;
}

export function normalizeProviderUsageSnapshot(
  value: unknown,
  checkedAt: string,
): ServerProvider["usage"] | undefined {
  const root = asRecord(value);
  const windows = new Map<string, ServerProviderUsageWindow>();

  for (const candidate of collectWindowCandidates(value)) {
    const label = readWindowLabel(candidate.record, candidate.key);
    const id = sanitizeWindowId(candidate.key ?? label);
    const percentUsed = readPercent(candidate.record);
    const exhausted =
      asBoolean(candidate.record.exhausted) ??
      asBoolean(candidate.record.is_exhausted) ??
      (percentUsed !== null ? percentUsed >= 100 : false);
    const resetsAt =
      WINDOW_RESET_KEYS.map((key) => parseIsoDate(candidate.record[key])).find(
        (entry) => entry !== null,
      ) ?? null;

    windows.set(id, {
      id,
      label,
      percentUsed,
      resetsAt,
      exhausted,
      level: levelFromPercent(percentUsed, exhausted),
    });
  }

  const message = root
    ? WINDOW_MESSAGE_KEYS.map((key) => asString(root[key])).find((entry) => entry !== undefined)
    : undefined;
  const state =
    (root
      ? WINDOW_STATE_KEYS.map((key) => normalizeUsageState(root[key])).find(
          (entry) => entry !== undefined,
        )
      : undefined) ?? (windows.size > 0 ? "available" : undefined);

  if (windows.size === 0 && !message && !state) {
    return undefined;
  }

  return {
    state: state ?? "available",
    checkedAt,
    windows: [...windows.values()],
    ...(message ? { message } : {}),
  };
}

function mergeCodexAccount(provider: ServerProvider, payload: unknown): ServerProvider {
  if (provider.provider !== "codex") {
    return provider;
  }

  const account = readCodexAccountSnapshot(payload);
  const nextAuthType = codexAuthSubType(account);
  const nextAuthLabel = codexAuthSubLabel(account);
  const shouldClearUsage = account.type !== "chatgpt";

  return {
    ...provider,
    auth: {
      ...provider.auth,
      status: "authenticated",
      ...(nextAuthType ? { type: nextAuthType } : {}),
      ...(nextAuthLabel ? { label: nextAuthLabel } : {}),
    },
    ...(shouldClearUsage ? { usage: undefined } : {}),
  };
}

export function mergeProviderRuntimeEventIntoSnapshot(
  provider: ServerProvider,
  event: ProviderRuntimeEvent,
): ServerProvider {
  if (provider.provider !== event.provider) {
    return provider;
  }

  switch (event.type) {
    case "account.updated":
      return mergeCodexAccount(provider, event.payload.account);

    case "account.rate-limits.updated": {
      const usage = normalizeProviderUsageSnapshot(event.payload.rateLimits, event.createdAt);
      if (!usage) {
        return provider;
      }
      return {
        ...provider,
        usage,
      };
    }

    default:
      return provider;
  }
}
