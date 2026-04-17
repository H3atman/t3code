import { type ServerProviderUsageWindow } from "@t3tools/contracts";

function normalizeUsageWindowKey(window: Pick<ServerProviderUsageWindow, "id" | "label">): string {
  return `${window.id} ${window.label}`.replace(/[\s_-]+/g, "").toLowerCase();
}

function resolveUsageWindowSortRank(
  window: Pick<ServerProviderUsageWindow, "id" | "label">,
): number {
  const normalized = normalizeUsageWindowKey(window);

  if (
    normalized.includes("hourly") ||
    normalized.includes("onehour") ||
    normalized.includes("1hour") ||
    normalized.includes("1h")
  ) {
    return 0;
  }

  if (
    normalized.includes("fivehour") ||
    normalized.includes("5hour") ||
    normalized.includes("5h")
  ) {
    return 1;
  }

  if (
    normalized.includes("daily") ||
    normalized.includes("oneday") ||
    normalized.includes("1day") ||
    normalized.includes("1d")
  ) {
    return 2;
  }

  if (
    normalized.includes("weekly") ||
    normalized.includes("sevenday") ||
    normalized.includes("7day") ||
    normalized.includes("7d")
  ) {
    return 3;
  }

  return 4;
}

export function sortUsageWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  return [...windows].toSorted((left, right) => {
    const rankDifference = resolveUsageWindowSortRank(left) - resolveUsageWindowSortRank(right);
    if (rankDifference !== 0) {
      return rankDifference;
    }
    return left.label.localeCompare(right.label);
  });
}

export function formatUsagePercent(percentUsed: number | null): string {
  if (percentUsed === null) {
    return "--";
  }
  return `${Math.round(percentUsed)}%`;
}

export function resolveUsageBarClassName(level: ServerProviderUsageWindow["level"]): string {
  switch (level) {
    case "warning":
      return "bg-amber-500";
    case "critical":
      return "bg-orange-500";
    case "exhausted":
      return "bg-red-500";
    default:
      return "bg-emerald-500";
  }
}
