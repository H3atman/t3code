import { describe, expect, it } from "vitest";
import type { ProviderRuntimeEvent, ServerProvider } from "@t3tools/contracts";

import {
  mergeProviderRuntimeEventIntoSnapshot,
  normalizeProviderUsageSnapshot,
} from "./providerUsage";

function makeProvider(
  provider: ServerProvider["provider"],
  overrides?: Partial<ServerProvider>,
): ServerProvider {
  return {
    provider,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-04-17T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("providerUsage", () => {
  it("normalizes named usage windows from runtime rate-limit payloads", () => {
    const usage = normalizeProviderUsageSnapshot(
      {
        five_hour: {
          utilization: 0.42,
          resets_at: "2026-04-17T05:00:00.000Z",
        },
        seven_day: {
          utilization: 0.88,
          resets_at: "2026-04-24T00:00:00.000Z",
        },
      },
      "2026-04-17T01:00:00.000Z",
    );

    expect(usage).toEqual({
      state: "available",
      checkedAt: "2026-04-17T01:00:00.000Z",
      windows: [
        {
          id: "five-hour",
          label: "5h",
          percentUsed: 42,
          resetsAt: "2026-04-17T05:00:00.000Z",
          level: "normal",
          exhausted: false,
        },
        {
          id: "seven-day",
          label: "7d",
          percentUsed: 88,
          resetsAt: "2026-04-24T00:00:00.000Z",
          level: "critical",
          exhausted: false,
        },
      ],
    });
  });

  it("merges runtime rate-limit updates into provider snapshots", () => {
    const provider = makeProvider("codex");
    const event: ProviderRuntimeEvent = {
      type: "account.rate-limits.updated",
      eventId: "evt-rate-limits-1" as never,
      provider: "codex",
      createdAt: "2026-04-17T02:00:00.000Z",
      threadId: "thread-1" as never,
      payload: {
        rateLimits: {
          windows: [
            {
              id: "tokens",
              label: "Tokens",
              percentUsed: 72,
              resetsAt: "2026-04-17T03:00:00.000Z",
            },
          ],
        },
      },
    };

    expect(mergeProviderRuntimeEventIntoSnapshot(provider, event)).toMatchObject({
      usage: {
        state: "available",
        checkedAt: "2026-04-17T02:00:00.000Z",
        windows: [
          {
            id: "tokens",
            label: "Tokens",
            percentUsed: 72,
            resetsAt: "2026-04-17T03:00:00.000Z",
            level: "warning",
            exhausted: false,
          },
        ],
      },
    });
  });

  it("updates codex auth metadata from account updates and clears stale usage for api keys", () => {
    const provider = makeProvider("codex", {
      usage: {
        state: "available",
        checkedAt: "2026-04-17T02:00:00.000Z",
        windows: [],
      },
    });
    const event: ProviderRuntimeEvent = {
      type: "account.updated",
      eventId: "evt-account-1" as never,
      provider: "codex",
      createdAt: "2026-04-17T03:00:00.000Z",
      threadId: "thread-1" as never,
      payload: {
        account: {
          type: "apiKey",
        },
      },
    };

    expect(mergeProviderRuntimeEventIntoSnapshot(provider, event)).toMatchObject({
      auth: {
        status: "authenticated",
        type: "apiKey",
        label: "OpenAI API Key",
      },
    });
    expect(mergeProviderRuntimeEventIntoSnapshot(provider, event).usage).toBeUndefined();
  });
});
