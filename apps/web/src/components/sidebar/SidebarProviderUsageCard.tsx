import { PROVIDER_DISPLAY_NAMES, type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { LoaderIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ensureLocalApi } from "~/localApi";
import {
  formatProviderUsagePercent,
  formatProviderUsageResetAt,
  orderProviderUsageWindows,
  shortProviderPlanLabel,
} from "~/lib/providerUsage";
import { cn } from "~/lib/utils";
import { useServerProviders } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const SIDEBAR_PROVIDER_ORDER: readonly ProviderKind[] = ["codex", "claudeAgent"];
type ProviderUsageState = NonNullable<ServerProvider["usage"]>["state"];

function windowToneClasses(
  window: NonNullable<ServerProvider["usage"]>["windows"][number],
  usageState: ProviderUsageState,
): string {
  if (usageState === "syncing") {
    return "bg-sky-500/65";
  }

  switch (window.level) {
    case "warning":
      return "bg-amber-500";
    case "critical":
    case "exhausted":
      return "bg-red-500";
    default:
      return "bg-emerald-500";
  }
}

function windowBarWidth(
  window: NonNullable<ServerProvider["usage"]>["windows"][number],
  usageState: ProviderUsageState,
): string {
  if (typeof window.percentUsed === "number") {
    return `${Math.max(4, Math.min(window.percentUsed, 100))}%`;
  }

  if (usageState === "syncing") {
    return "35%";
  }

  return "0%";
}

function providerStatusMessage(provider: ServerProvider): string | null {
  const usage = provider.usage;
  if (!usage) {
    return "Usage telemetry has not been reported yet.";
  }

  if (usage.state === "syncing") {
    return usage.message ?? "Refreshing the latest account limits.";
  }

  if (usage.state === "unavailable") {
    return usage.message ?? "Limit telemetry is currently unavailable.";
  }

  return usage.message ?? null;
}

function ProviderUsageWindowRow(props: {
  provider: ServerProvider;
  usageState: NonNullable<ServerProvider["usage"]>["state"];
  window: NonNullable<ServerProvider["usage"]>["windows"][number];
}) {
  const { provider, usageState, window } = props;
  const percent = formatProviderUsagePercent(window.percentUsed) ?? "--";
  const resetsIn = formatProviderUsageResetAt(window.resetsAt);

  return (
    <div
      className="space-y-1"
      data-provider-usage-window={window.id}
      aria-label={`${PROVIDER_DISPLAY_NAMES[provider.provider] ?? provider.provider} ${window.label} ${percent}`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] leading-none">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="shrink-0 font-medium text-foreground/90"
            data-provider-usage-window-label
          >
            {window.label}
          </span>
          {resetsIn ? (
            <span className="truncate text-muted-foreground/75">Resets in {resetsIn}</span>
          ) : null}
        </div>
        <span className="shrink-0 text-muted-foreground">{percent}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-sidebar-border/80">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            windowToneClasses(window, usageState),
            usageState === "syncing" && "animate-pulse",
          )}
          style={{ width: windowBarWidth(window, usageState) }}
        />
      </div>
    </div>
  );
}

function SidebarProviderUsageRow(props: { provider: ServerProvider }) {
  const { provider } = props;
  const providerName = PROVIDER_DISPLAY_NAMES[provider.provider] ?? provider.provider;
  const compactPlanLabel = shortProviderPlanLabel(provider);
  const usage = provider.usage;
  const orderedWindows = usage ? orderProviderUsageWindows(usage.windows) : [];
  const statusMessage = providerStatusMessage(provider);

  return (
    <section className="space-y-1.5 py-2" data-provider-usage={provider.provider}>
      <div className="flex items-center gap-1.5 px-1 text-[11px] leading-none">
        <span className="font-medium text-foreground">{providerName}</span>
        {compactPlanLabel ? (
          <span className="truncate text-muted-foreground/75">{compactPlanLabel}</span>
        ) : null}
      </div>

      {statusMessage ? (
        <div className="px-1 text-[11px] text-muted-foreground">{statusMessage}</div>
      ) : null}

      {orderedWindows.length > 0 ? (
        <div className="space-y-1.5 px-1">
          {orderedWindows.map((window) => (
            <ProviderUsageWindowRow
              key={window.id}
              provider={provider}
              usageState={usage?.state ?? "available"}
              window={window}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SidebarProviderUsageCard() {
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshingRef = useRef(false);
  const providers = useServerProviders();

  const usageProviders = SIDEBAR_PROVIDER_ORDER.flatMap((providerKind) => {
    const provider = providers.find((candidate) => candidate.provider === providerKind);
    return provider ? [provider] : [];
  });

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) {
      return;
    }

    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void ensureLocalApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh provider usage", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  if (usageProviders.length === 0) {
    return null;
  }

  return (
    <div className="group-data-[collapsible=icon]:hidden px-2 pb-1">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
          Usage limits
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                disabled={isRefreshingProviders}
                onClick={() => void refreshProviders()}
                aria-label={
                  isRefreshingProviders ? "Refreshing usage limits" : "Refresh usage limits"
                }
              >
                {isRefreshingProviders ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3" />
                )}
              </Button>
            }
          />
          <TooltipPopup side="top">
            {isRefreshingProviders ? "Refreshing usage limits" : "Refresh usage limits"}
          </TooltipPopup>
        </Tooltip>
      </div>
      <div className="divide-y divide-sidebar-border/60">
        {usageProviders.map((provider) => (
          <SidebarProviderUsageRow key={provider.provider} provider={provider} />
        ))}
      </div>
    </div>
  );
}
