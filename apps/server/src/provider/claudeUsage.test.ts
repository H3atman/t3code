import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveClaudeUsageSnapshot } from "./claudeUsage";

const tempDirs = new Set<string>();

function makeTempHomeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-claude-usage-"));
  tempDirs.add(dir);
  return dir;
}

function writeClaudeCredentials(
  homeDir: string,
  overrides?: Partial<{ accessToken: string; expiresAt: number; subscriptionType: string }>,
): void {
  const configDir = path.join(homeDir, ".claude");
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: overrides?.accessToken ?? "token-123",
        expiresAt: overrides?.expiresAt ?? Date.UTC(2027, 0, 1, 0, 0, 0),
        subscriptionType: overrides?.subscriptionType ?? "pro",
      },
    }),
    "utf8",
  );
}

function mockFetch(response: Response) {
  return async () => response;
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("resolveClaudeUsageSnapshot", () => {
  it("treats malformed credentials JSON as missing credentials", async () => {
    const homeDir = makeTempHomeDir();
    const configDir = path.join(homeDir, ".claude");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, ".credentials.json"), "{invalid json", "utf8");

    const usage = await resolveClaudeUsageSnapshot({
      homeDir: () => homeDir,
      now: () => Date.UTC(2026, 3, 17, 2, 0, 0),
      fetchImpl: async () => {
        throw new Error("fetch should not be called when credentials are invalid");
      },
    });

    expect(usage).toBeUndefined();
  });

  it("normalizes direct Claude usage responses into provider usage windows", async () => {
    const homeDir = makeTempHomeDir();
    writeClaudeCredentials(homeDir);

    const usage = await resolveClaudeUsageSnapshot({
      homeDir: () => homeDir,
      now: () => Date.UTC(2026, 3, 17, 2, 0, 0),
      fetchImpl: mockFetch(
        new Response(
          JSON.stringify({
            five_hour: {
              utilization: 42,
              resets_at: "2026-04-17T05:00:00.000Z",
            },
            seven_day: {
              utilization: 88,
              resets_at: "2026-04-24T00:00:00.000Z",
            },
          }),
          { status: 200 },
        ),
      ),
    });

    expect(usage).toEqual({
      state: "available",
      checkedAt: "2026-04-17T02:00:00.000Z",
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

  it("serves the last synced usage during rate limiting", async () => {
    const homeDir = makeTempHomeDir();
    writeClaudeCredentials(homeDir);
    const firstNow = Date.UTC(2026, 3, 17, 2, 0, 0);

    await resolveClaudeUsageSnapshot({
      homeDir: () => homeDir,
      now: () => firstNow,
      fetchImpl: mockFetch(
        new Response(
          JSON.stringify({
            five_hour: {
              utilization: 40,
              resets_at: "2026-04-17T05:00:00.000Z",
            },
          }),
          { status: 200 },
        ),
      ),
    });

    const usage = await resolveClaudeUsageSnapshot({
      homeDir: () => homeDir,
      now: () => firstNow + 6 * 60_000,
      fetchImpl: mockFetch(
        new Response(null, {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      ),
    });

    expect(usage).toEqual({
      state: "syncing",
      checkedAt: "2026-04-17T02:06:00.000Z",
      windows: [
        {
          id: "five-hour",
          label: "5h",
          percentUsed: 40,
          resetsAt: "2026-04-17T05:00:00.000Z",
          level: "normal",
          exhausted: false,
        },
      ],
      message: "Claude usage is temporarily rate limited; showing the last synced values.",
    });
  });
});
