import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";

const FIVE_HOUR_WINDOW_KEYS = new Set(["5h", "5-hour", "five-hour", "fivehour"]);
const SEVEN_DAY_WINDOW_KEYS = new Set(["7d", "7-day", "seven-day", "sevenday"]);

function normalizeWindowKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalWindowOrder(window: ServerProviderUsageWindow): number {
  const keys = [window.id, window.label].map(normalizeWindowKey);

  if (keys.some((key) => FIVE_HOUR_WINDOW_KEYS.has(key))) {
    return 0;
  }

  if (keys.some((key) => SEVEN_DAY_WINDOW_KEYS.has(key))) {
    return 1;
  }

  return 2;
}

export function orderProviderUsageWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ServerProviderUsageWindow[] {
  return windows
    .map((window, index) => ({ window, index }))
    .toSorted((left, right) => {
      const rankDifference = canonicalWindowOrder(left.window) - canonicalWindowOrder(right.window);
      if (rankDifference !== 0) {
        return rankDifference;
      }
      return left.index - right.index;
    })
    .map(({ window }) => window);
}

export function selectPrimaryProviderUsageWindow(
  provider: Pick<ServerProvider, "usage">,
): ServerProviderUsageWindow | null {
  const windows = provider.usage?.windows ?? [];
  if (windows.length === 0) {
    return null;
  }

  const ranked = windows.toSorted((left, right) => {
    const leftPercent = left.percentUsed ?? -1;
    const rightPercent = right.percentUsed ?? -1;
    return rightPercent - leftPercent;
  });

  return ranked[0] ?? null;
}

export function shortProviderPlanLabel(provider: Pick<ServerProvider, "auth">): string | null {
  const label = provider.auth.label?.trim();
  if (!label) {
    return null;
  }

  return label
    .replace(/^ChatGPT\s+/i, "")
    .replace(/^Claude\s+/i, "")
    .replace(/\s+Subscription$/i, "")
    .trim();
}

export function formatProviderUsagePercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

export function formatProviderUsageResetAt(
  value: string | null,
  now: Date = new Date(),
): string | null {
  if (!value) {
    return null;
  }

  const resetAt = new Date(value);
  if (Number.isNaN(resetAt.getTime())) {
    return null;
  }

  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) {
    return null;
  }

  const diffMins = Math.ceil(diffMs / 60_000);
  if (diffMins < 60) {
    return `${diffMins}m`;
  }

  const hours = Math.floor(diffMins / 60);
  const minutes = diffMins % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}
