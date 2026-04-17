import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ServerProvider } from "./server";

const decodeServerProvider = Schema.decodeUnknownSync(ServerProvider);

describe("ServerProvider", () => {
  it("defaults capability arrays when decoding legacy snapshots", () => {
    const parsed = decodeServerProvider({
      provider: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
    });

    expect(parsed.slashCommands).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.usage).toBeUndefined();
  });

  it("decodes provider usage windows with defaults", () => {
    const parsed = decodeServerProvider({
      provider: "codex",
      enabled: true,
      installed: true,
      version: "1.0.0",
      status: "ready",
      auth: {
        status: "authenticated",
      },
      checkedAt: "2026-04-10T00:00:00.000Z",
      models: [],
      usage: {
        state: "available",
        checkedAt: "2026-04-10T00:05:00.000Z",
        windows: [
          {
            id: "5h",
            label: "5h",
          },
        ],
      },
    });

    expect(parsed.usage).toEqual({
      state: "available",
      checkedAt: "2026-04-10T00:05:00.000Z",
      windows: [
        {
          id: "5h",
          label: "5h",
          percentUsed: null,
          resetsAt: null,
          level: "normal",
          exhausted: false,
        },
      ],
    });
  });
});
