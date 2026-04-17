import { describe, expect, it } from "vitest";

import type { ServerProviderUsageWindow } from "@t3tools/contracts";

import { formatUsagePercent, resolveUsageBarClassName, sortUsageWindows } from "./Sidebar.usage";

function makeWindow(
  overrides: Partial<ServerProviderUsageWindow> & Pick<ServerProviderUsageWindow, "id" | "label">,
): ServerProviderUsageWindow {
  return {
    id: overrides.id,
    label: overrides.label,
    percentUsed: overrides.percentUsed ?? null,
    resetsAt: overrides.resetsAt ?? null,
    level: overrides.level ?? "normal",
    exhausted: overrides.exhausted ?? false,
  };
}

describe("sortUsageWindows", () => {
  it("prioritizes the 5h window above the 7d window", () => {
    const sorted = sortUsageWindows([
      makeWindow({ id: "seven-day", label: "7d" }),
      makeWindow({ id: "five-hour", label: "5h" }),
    ]);

    expect(sorted.map((window) => window.label)).toEqual(["5h", "7d"]);
  });

  it("keeps shorter windows ahead of longer windows before falling back to labels", () => {
    const sorted = sortUsageWindows([
      makeWindow({ id: "weekly", label: "7d" }),
      makeWindow({ id: "daily", label: "1d" }),
      makeWindow({ id: "hourly", label: "1h" }),
      makeWindow({ id: "five-hour", label: "5h" }),
      makeWindow({ id: "custom-burst", label: "Burst" }),
    ]);

    expect(sorted.map((window) => window.label)).toEqual(["1h", "5h", "1d", "7d", "Burst"]);
  });
});

describe("formatUsagePercent", () => {
  it("returns a fallback marker when utilization is unavailable", () => {
    expect(formatUsagePercent(null)).toBe("--");
  });

  it("rounds the utilization percentage for display", () => {
    expect(formatUsagePercent(84.6)).toBe("85%");
  });
});

describe("resolveUsageBarClassName", () => {
  it("maps warning states to the expected accent colors", () => {
    expect(resolveUsageBarClassName("normal")).toBe("bg-emerald-500");
    expect(resolveUsageBarClassName("warning")).toBe("bg-amber-500");
    expect(resolveUsageBarClassName("critical")).toBe("bg-orange-500");
    expect(resolveUsageBarClassName("exhausted")).toBe("bg-red-500");
  });
});
