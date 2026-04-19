import { describe, expect, it, vi } from "vitest";
import type { ServerProvider } from "@t3tools/contracts";

import {
  formatProviderUsagePercent,
  formatProviderUsageResetAt,
  orderProviderUsageWindows,
  selectPrimaryProviderUsageWindow,
  shortProviderPlanLabel,
} from "./providerUsage";

function makeProvider(overrides?: Partial<ServerProvider>): ServerProvider {
  return {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated", label: "ChatGPT Pro Subscription" },
    checkedAt: "2026-04-17T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("providerUsage", () => {
  it("chooses the highest-usage window for compact display", () => {
    const provider = makeProvider({
      usage: {
        state: "available",
        checkedAt: "2026-04-17T00:05:00.000Z",
        windows: [
          {
            id: "5h",
            label: "5h",
            percentUsed: 41,
            resetsAt: null,
            level: "normal",
            exhausted: false,
          },
          {
            id: "7d",
            label: "7d",
            percentUsed: 84,
            resetsAt: null,
            level: "warning",
            exhausted: false,
          },
        ],
      },
    });

    expect(selectPrimaryProviderUsageWindow(provider)?.id).toBe("7d");
  });

  it("shortens provider plan labels for compact HUD chips", () => {
    expect(shortProviderPlanLabel(makeProvider())).toBe("Pro");
    expect(
      shortProviderPlanLabel(
        makeProvider({
          auth: { status: "authenticated", label: "Claude Max Subscription" },
        }),
      ),
    ).toBe("Max");
  });

  it("formats percentages and reset timers for hover details", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T00:00:00.000Z"));

    expect(formatProviderUsagePercent(9.4)).toBe("9.4%");
    expect(formatProviderUsagePercent(42)).toBe("42%");
    expect(formatProviderUsageResetAt("2026-04-17T01:30:00.000Z")).toBe("1h 30m");

    vi.useRealTimers();
  });

  it("orders sidebar usage windows with 5h first and 7d second", () => {
    const ordered = orderProviderUsageWindows([
      {
        id: "monthly",
        label: "Monthly",
        percentUsed: 12,
        resetsAt: null,
        level: "normal",
        exhausted: false,
      },
      {
        id: "secondary",
        label: "7d",
        percentUsed: 84,
        resetsAt: null,
        level: "warning",
        exhausted: false,
      },
      {
        id: "primary",
        label: "5h",
        percentUsed: 41,
        resetsAt: null,
        level: "normal",
        exhausted: false,
      },
    ]);

    expect(ordered.map((window) => window.label)).toEqual(["5h", "7d", "Monthly"]);
  });
});
