import { PROVIDER_DISPLAY_NAMES, type ProviderKind, type ServerProvider } from "@t3tools/contracts";

import {
  formatProviderUsagePercent,
  formatProviderUsageResetAt,
  selectPrimaryProviderUsageWindow,
  shortProviderPlanLabel,
} from "~/lib/providerUsage";
import { cn } from "~/lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useServerProviders } from "../../rpc/serverState";

const SIDEBAR_PROVIDER_ORDER: readonly ProviderKind[] = ["codex", "claudeAgent"];

function progressToneClasses(provider: ServerProvider): string {
  const primaryWindow = selectPrimaryProviderUsageWindow(provider);
  const usageState = provider.usage?.state;

  if (usageState === "syncing") {
    return "bg-sky-500/65";
  }

  switch (primaryWindow?.level) {
    case "warning":
      return "bg-amber-500";
    case "critical":
    case "exhausted":
      return "bg-red-500";
    default:
      return "bg-emerald-500";
  }
}

function barWidth(provider: ServerProvider): string {
  const usageState = provider.usage?.state;
  const primaryWindow = selectPrimaryProviderUsageWindow(provider);
  if (typeof primaryWindow?.percentUsed === "number") {
    return `${Math.max(4, Math.min(primaryWindow.percentUsed, 100))}%`;
  }
  if (usageState === "syncing") {
    return "35%";
  }
  return "0%";
}

function summaryLabel(provider: ServerProvider): string {
  const usage = provider.usage;
  const primaryWindow = selectPrimaryProviderUsageWindow(provider);

  if (!usage) {
    return "No data";
  }

  if (!primaryWindow) {
    if (usage.state === "syncing") {
      return "Syncing";
    }
    if (usage.state === "unavailable") {
      return "Unavailable";
    }
    return "Usage";
  }

  const percent = formatProviderUsagePercent(primaryWindow.percentUsed) ?? "--";
  return `${primaryWindow.label} ${percent}`;
}

function detailLabel(provider: ServerProvider): string {
  const usage = provider.usage;
  const primaryWindow = selectPrimaryProviderUsageWindow(provider);
  if (!usage) {
    return "Usage telemetry has not been reported yet.";
  }
  if (!primaryWindow) {
    if (usage.state === "syncing") {
      return "Refreshing the latest account limits.";
    }
    if (usage.state === "unavailable") {
      return usage.message ?? "Limit telemetry is currently unavailable.";
    }
    return usage.message ?? "Usage telemetry is available.";
  }

  const resetsIn = formatProviderUsageResetAt(primaryWindow.resetsAt);
  if (resetsIn) {
    return `Resets in ${resetsIn}`;
  }
  return usage.message ?? "Latest account usage snapshot.";
}

function ProviderUsageDetails(props: { provider: ServerProvider }) {
  const { provider } = props;
  const usage = provider.usage;
  const providerLabel =
    provider.auth.label ?? PROVIDER_DISPLAY_NAMES[provider.provider] ?? provider.provider;

  if (!usage) {
    return (
      <div className="space-y-1.5">
        <div className="text-sm font-medium text-foreground">{providerLabel}</div>
        <div className="text-xs text-muted-foreground">
          Usage telemetry has not been reported yet for this provider.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 leading-tight">
      <div className="space-y-0.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Usage limits
        </div>
        <div className="text-sm font-medium text-foreground">{providerLabel}</div>
      </div>

      {usage.message ? <div className="text-xs text-muted-foreground">{usage.message}</div> : null}

      {usage.state === "syncing" ? (
        <div className="text-xs text-muted-foreground">Refreshing the latest account limits.</div>
      ) : null}

      {usage.state === "unavailable" && usage.windows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          Limit telemetry is currently unavailable for this provider session.
        </div>
      ) : null}

      {usage.windows.length > 0 ? (
        <div className="space-y-1.5">
          {usage.windows.map((window) => {
            const percent = formatProviderUsagePercent(window.percentUsed) ?? "--";
            const resetsIn = formatProviderUsageResetAt(window.resetsAt);
            return (
              <div key={window.id} className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{window.label}</div>
                  {resetsIn ? (
                    <div className="text-muted-foreground">Resets in {resetsIn}</div>
                  ) : null}
                </div>
                <div
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 font-medium",
                    window.level === "warning" &&
                      "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    (window.level === "critical" || window.level === "exhausted") &&
                      "bg-red-500/10 text-red-700 dark:text-red-300",
                    window.level === "normal" && "bg-muted text-foreground",
                  )}
                >
                  {percent}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SidebarProviderUsageRow(props: { provider: ServerProvider }) {
  const { provider } = props;
  const providerName = PROVIDER_DISPLAY_NAMES[provider.provider] ?? provider.provider;
  const compactPlanLabel = shortProviderPlanLabel(provider);
  const usage = provider.usage;
  const summary = summaryLabel(provider);
  const detail = detailLabel(provider);

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
            aria-label={`${providerName} limits ${summary}`.trim()}
          >
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-foreground">{providerName}</span>
                  {compactPlanLabel ? (
                    <span className="truncate text-muted-foreground/75">{compactPlanLabel}</span>
                  ) : null}
                </div>
              </div>
              <span className="shrink-0 text-muted-foreground">{summary}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sidebar-border/80">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  progressToneClasses(provider),
                  usage?.state === "syncing" && "animate-pulse",
                )}
                style={{ width: barWidth(provider) }}
              />
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground/80">{detail}</div>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="right"
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)] px-3 py-2"
      >
        <ProviderUsageDetails provider={provider} />
      </PopoverPopup>
    </Popover>
  );
}

export function SidebarProviderUsageCard() {
  const providers = useServerProviders();
  const usageProviders = SIDEBAR_PROVIDER_ORDER.flatMap((providerKind) => {
    const provider = providers.find((candidate) => candidate.provider === providerKind);
    return provider ? [provider] : [];
  });

  if (usageProviders.length === 0) {
    return null;
  }

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <div className="rounded-xl border border-sidebar-border/70 bg-sidebar-accent/25 p-1.5">
        <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80">
          Usage limits
        </div>
        <div className="space-y-1">
          {usageProviders.map((provider) => (
            <SidebarProviderUsageRow key={provider.provider} provider={provider} />
          ))}
        </div>
      </div>
    </div>
  );
}
