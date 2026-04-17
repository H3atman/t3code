import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";

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
