import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type LocalApi,
  type ServerConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { __resetLocalApiForTests } from "../../localApi";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { SidebarProviderUsageCard } from "./SidebarProviderUsageCard";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const NOW_ISO = "2026-04-19T00:00:00.000Z";

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
    checkedAt: NOW_ISO,
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

function createServerConfig(providers: ReadonlyArray<ServerProvider>): ServerConfig {
  return {
    environment: {
      environmentId: LOCAL_ENVIRONMENT_ID,
      label: "Local environment",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    keybindings: [],
    issues: [],
    providers: [...providers],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

describe("SidebarProviderUsageCard", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(async () => {
    resetServerStateForTests();
    await __resetLocalApiForTests();
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    resetServerStateForTests();
    await __resetLocalApiForTests();
  });

  it("renders both providers and keeps 5h above 7d with extra windows afterward", async () => {
    setServerConfigSnapshot(
      createServerConfig([
        makeProvider("codex", {
          auth: { status: "authenticated", label: "ChatGPT Pro Subscription" },
          usage: {
            state: "available",
            checkedAt: NOW_ISO,
            windows: [
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
                percentUsed: 68,
                resetsAt: "2026-04-26T00:00:00.000Z",
                level: "normal",
                exhausted: false,
              },
              {
                id: "primary",
                label: "5h",
                percentUsed: 41,
                resetsAt: "2026-04-19T05:00:00.000Z",
                level: "normal",
                exhausted: false,
              },
            ],
          },
        }),
        makeProvider("claudeAgent", {
          auth: { status: "authenticated", label: "Claude Max Subscription" },
          usage: {
            state: "available",
            checkedAt: NOW_ISO,
            windows: [
              {
                id: "seven-day",
                label: "7d",
                percentUsed: 77,
                resetsAt: "2026-04-26T00:00:00.000Z",
                level: "warning",
                exhausted: false,
              },
              {
                id: "five-hour",
                label: "5h",
                percentUsed: 22,
                resetsAt: "2026-04-19T05:00:00.000Z",
                level: "normal",
                exhausted: false,
              },
            ],
          },
        }),
      ]),
    );

    mounted = await render(
      <AppAtomRegistryProvider>
        <SidebarProviderUsageCard />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Usage limits")).toBeInTheDocument();
    await expect.element(page.getByText("Codex")).toBeInTheDocument();
    await expect.element(page.getByText("Claude")).toBeInTheDocument();

    const codexSection = document.querySelector('[data-provider-usage="codex"]');
    if (!(codexSection instanceof HTMLElement)) {
      throw new Error("Expected the Codex usage section to render.");
    }

    const codexWindowLabels = Array.from(
      codexSection.querySelectorAll<HTMLElement>("[data-provider-usage-window-label]"),
    ).map((element) => element.textContent?.trim());

    expect(codexWindowLabels).toEqual(["5h", "7d", "Monthly"]);
  });

  it("refreshes provider usage from the sidebar header button", async () => {
    const refreshControl: { finish?: () => void } = {};
    const refreshProviders = vi.fn<LocalApi["server"]["refreshProviders"]>().mockImplementation(
      () =>
        new Promise((resolve) => {
          refreshControl.finish = () => resolve({ providers: [] });
        }),
    );
    window.nativeApi = {
      server: {
        refreshProviders,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(
      createServerConfig([
        makeProvider("codex", {
          usage: {
            state: "available",
            checkedAt: NOW_ISO,
            windows: [
              {
                id: "primary",
                label: "5h",
                percentUsed: 41,
                resetsAt: "2026-04-19T05:00:00.000Z",
                level: "normal",
                exhausted: false,
              },
            ],
          },
        }),
      ]),
    );

    mounted = await render(
      <AppAtomRegistryProvider>
        <SidebarProviderUsageCard />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Refresh usage limits" }).click();

    await vi.waitFor(() => {
      expect(refreshProviders).toHaveBeenCalledTimes(1);
    });
    await expect
      .element(page.getByRole("button", { name: "Refreshing usage limits" }))
      .toBeDisabled();

    refreshControl.finish?.();

    await vi.waitFor(async () => {
      await expect
        .element(page.getByRole("button", { name: "Refresh usage limits" }))
        .toBeEnabled();
    });
  });

  it("shows syncing copy inline while provider limits refresh", async () => {
    setServerConfigSnapshot(
      createServerConfig([
        makeProvider("codex", {
          usage: {
            state: "syncing",
            checkedAt: NOW_ISO,
            windows: [
              {
                id: "primary",
                label: "5h",
                percentUsed: 41,
                resetsAt: "2026-04-19T05:00:00.000Z",
                level: "normal",
                exhausted: false,
              },
              {
                id: "secondary",
                label: "7d",
                percentUsed: 62,
                resetsAt: "2026-04-26T00:00:00.000Z",
                level: "normal",
                exhausted: false,
              },
            ],
          },
        }),
        makeProvider("claudeAgent", {
          usage: {
            state: "available",
            checkedAt: NOW_ISO,
            windows: [],
          },
        }),
      ]),
    );

    mounted = await render(
      <AppAtomRegistryProvider>
        <SidebarProviderUsageCard />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByText("Refreshing the latest account limits."))
      .toBeInTheDocument();
  });

  it("shows compact unavailable and missing-usage fallback messages", async () => {
    setServerConfigSnapshot(
      createServerConfig([
        makeProvider("codex"),
        makeProvider("claudeAgent", {
          usage: {
            state: "unavailable",
            checkedAt: NOW_ISO,
            windows: [],
            message: "Claude usage telemetry is temporarily unavailable.",
          },
        }),
      ]),
    );

    mounted = await render(
      <AppAtomRegistryProvider>
        <SidebarProviderUsageCard />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByText("Usage telemetry has not been reported yet."))
      .toBeInTheDocument();
    await expect
      .element(page.getByText("Claude usage telemetry is temporarily unavailable."))
      .toBeInTheDocument();
  });
});
