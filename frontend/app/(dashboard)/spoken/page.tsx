"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Loader2, Play, Trash2 } from "lucide-react";
import { formatUnits, isAddress, type Address } from "viem";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTransition } from "@/components/layout/PageTransition";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import { AssetMark, SectionLabel } from "@/components/ui/MarketVisuals";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import {
  cadenceFromInterval,
  formatHealthFloor,
  spokenPayAddress,
  useSpokenPayActions,
  useSpokenPayPlans,
  type SpokenPayPlan,
} from "@/hooks/useSpokenPay";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import { usePrimaryDomain } from "@/hooks/usePrimaryDomain";
import {
  DAY_SECONDS,
  WEEK_SECONDS,
  healthFactorToWad,
  nextWeekdayAtHour,
} from "@/lib/spokenPay";
import {
  displayPayDomain,
  normalizeDomainLabel,
  truncatePayAddress,
} from "@/lib/payRequest";
import { showToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const CADENCES = [
  { id: "friday", label: "Every Friday, 9:00", weekday: 5, interval: WEEK_SECONDS },
  { id: "monday", label: "Every Monday, 9:00", weekday: 1, interval: WEEK_SECONDS },
  { id: "daily", label: "Every day, 9:00", weekday: null, interval: DAY_SECONDS },
  { id: "weekly", label: "Every week, 9:00", weekday: null, interval: WEEK_SECONDS },
] as const;

function formatWhen(seconds: bigint) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function blockerCopy(plan: SpokenPayPlan) {
  if (!plan.active) {
    return plan.lastOutcome === "domain"
      ? "Halted — the .lendora name moved. Create a new plan to confirm the new owner."
      : "Cancelled";
  }
  if (plan.blocker === "domain") {
    return plan.due
      ? "Name moved — the next relayer run will halt this plan"
      : "Name moved — plan will halt on the next scheduled run";
  }
  if (plan.blocker === "not-due") return `Next run ${formatWhen(plan.nextRunAt)}`;
  if (plan.blocker === "health") return "Last run skipped — health factor too low";
  if (plan.blocker === "balance") {
    return plan.fromYieldOnly
      ? "Last run skipped — not enough claimed yield in the wallet"
      : "Last run skipped — wallet balance too low";
  }
  if (plan.due) return "Due now";
  return `Next run ${formatWhen(plan.nextRunAt)}`;
}

export default function SpokenPayPage() {
  const { plans, isLoading, isConnected, refetch } = useSpokenPayPlans();
  const actions = useSpokenPayActions();
  const { address } = useArcLendAccount();
  const { primaryDomain } = usePrimaryDomain(address);
  const [asset, setAsset] = useState<"USDC" | "EURC">("USDC");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [cadenceId, setCadenceId] = useState<(typeof CADENCES)[number]["id"]>("friday");
  const [health, setHealth] = useState("1.50");
  const [fromYield, setFromYield] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cadence = CADENCES.find((item) => item.id === cadenceId) ?? CADENCES[0];
  const canCreate = isConnected && Boolean(amount) && Boolean(recipient) && !actions.isPending;

  async function resolveRecipient() {
    const trimmed = recipient.trim();
    if (isAddress(trimmed)) {
      return { address: trimmed as Address, domainName: "" };
    }
    const label = normalizeDomainLabel(trimmed);
    if (!label) throw new Error("Enter a .lendora name or 0x address.");
    const response = await fetch(`/api/pay-resolve?name=${encodeURIComponent(label)}`);
    const body = (await response.json()) as { address?: string };
    if (!response.ok || !body.address || !isAddress(body.address)) {
      throw new Error(`The .lendora name "${label}.lendora" is not registered.`);
    }
    return { address: body.address as Address, domainName: label };
  }

  async function handleCreate() {
    setBusyId("create");
    try {
      const resolved = await resolveRecipient();
      const healthWad = healthFactorToWad(health);
      if (!healthWad) throw new Error("Health floor must be 1.10 or higher.");
      const firstRunAt = BigInt(
        nextWeekdayAtHour(
          cadence.weekday ?? new Date().getDay(),
          9,
          cadence.id === "daily" ? "daily" : "weekly",
        ),
      );
      await actions.createPlan({
        asset,
        amount,
        recipient: resolved.address,
        domainName: resolved.domainName,
        intervalSeconds: BigInt(cadence.interval),
        firstRunAt,
        minHealthFactorWad: healthWad,
        fromYieldOnly: fromYield,
      });
      showToast("success", "Spoken payment armed.");
      setAmount("");
      await refetch();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Could not create that plan.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(plan: SpokenPayPlan) {
    setBusyId(`cancel-${plan.id}`);
    try {
      await actions.cancelPlan(plan.id);
      showToast("success", "Plan cancelled.");
      await refetch();
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "Could not cancel.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleRun(plan: SpokenPayPlan) {
    setBusyId(`run-${plan.id}`);
    try {
      await actions.runPlan(plan);
      showToast("success", "Plan run submitted.");
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      showToast(
        "error",
        message.includes("HealthTooLow")
          ? "Health factor is below this plan's floor."
          : message.includes("InsufficientWalletBalance")
            ? plan.fromYieldOnly
              ? "Not enough claimed yield in the wallet. Claim yield, then run."
              : "Wallet balance is too low for this payment."
            : message || "Could not run plan.",
      );
    } finally {
      setBusyId(null);
    }
  }

  const activeCount = useMemo(
    () => plans.filter((plan) => plan.active).length,
    [plans],
  );

  return (
    <PageTransition>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={<CalendarClock />}
          title="Spoken pay"
          description="Authorize a recurring payout to a .lendora name. Runs skip if health factor would fall, and halt if the name moves."
          stats={[
            { label: "Active plans", value: String(activeCount), tone: "positive" },
            { label: "Relayer", value: "daily 9:00 UTC" },
          ]}
        />

        {!spokenPayAddress ? (
          <GlassCard className="p-6 text-sm text-white/55">
            SpokenPay is not deployed on this network yet.
          </GlassCard>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
            <GlassCard depth="foreground" className="p-5 sm:p-7">
              <SectionLabel>New plan</SectionLabel>
              <h2 className="mt-2 font-display text-2xl text-white">
                Pay {asset} on a schedule
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/50">
                The name is pinned when you create the plan. Yield-only runs spend
                claimed interest in your wallet, never supplied principal.
              </p>

              <div className="mt-6 grid gap-4">
                <div className="flex rounded-xl border border-white/10 bg-black/25 p-1">
                  {(["USDC", "EURC"] as const).map((token) => (
                    <button
                      key={token}
                      type="button"
                      onClick={() => setAsset(token)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm transition",
                        asset === token
                          ? "bg-white text-black"
                          : "text-white/55 hover:text-white",
                      )}
                    >
                      <AssetMark symbol={token} size="sm" />
                      {token}
                    </button>
                  ))}
                </div>

                <label className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-white/40">
                    Amount each run
                  </span>
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    placeholder=""
                    className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-2xl text-white outline-none focus:border-emerald-200/40"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-white/40">
                    Recipient
                  </span>
                  <input
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder={primaryDomain ? `${primaryDomain}` : "ada.lendora"}
                    className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-emerald-200/40"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  {CADENCES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCadenceId(item.id)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition",
                        cadenceId === item.id
                          ? "border-white/80 bg-white text-black"
                          : "border-white/10 text-white/50 hover:text-white",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <label className="grid gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-white/40">
                    Skip if health below
                  </span>
                  <input
                    value={health}
                    onChange={(event) => setHealth(event.target.value)}
                    className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none focus:border-emerald-200/40"
                  />
                </label>

                <label className="flex items-center gap-3 text-sm text-white/70">
                  <input
                    type="checkbox"
                    checked={fromYield}
                    onChange={(event) => setFromYield(event.target.checked)}
                    className="h-4 w-4 accent-white"
                  />
                  Pay from claimed yield only — never supplied principal
                </label>

                {isConnected ? (
                  <GlassButton
                    variant="primary"
                    disabled={!canCreate}
                    onClick={() => void handleCreate()}
                  >
                    {busyId === "create" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CalendarClock className="h-4 w-4" />
                    )}
                    Arm spoken payment
                  </GlassButton>
                ) : (
                  <ConnectWalletButton />
                )}
              </div>
            </GlassCard>

            <GlassCard className="p-5 sm:p-7">
              <SectionLabel>Your plans</SectionLabel>
              {isLoading ? (
                <p className="mt-6 text-sm text-white/45">Loading plans…</p>
              ) : plans.length === 0 ? (
                <p className="mt-6 text-sm leading-6 text-white/45">
                  No spoken payments yet. Create one here or tell the assistant
                  “send 40 USDC to ada.lendora every Friday from my yield, keep
                  health above 1.5”.
                </p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {plans.map((plan) => (
                    <li
                      key={plan.id.toString()}
                      className="rounded-2xl border border-white/[0.08] bg-black/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-sm text-white">
                            {formatUnits(plan.amount, 6)} {plan.asset}
                          </p>
                          <p className="mt-1 text-xs text-white/50">
                            {plan.domainName
                              ? displayPayDomain(plan.domainName)
                              : truncatePayAddress(plan.recipient)}
                            {" · "}
                            {cadenceFromInterval(plan.interval)}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-wide",
                            plan.active ? "text-emerald-200/80" : "text-white/35",
                          )}
                        >
                          {plan.active ? "Active" : "Stopped"}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-white/45">
                        {blockerCopy(plan)}
                        {" · "}HF floor {formatHealthFloor(plan.minHealthFactorWad)}
                        {plan.fromYieldOnly ? " · yield only" : ""}
                      </p>
                      {plan.active ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <GlassButton
                            variant="primary"
                            disabled={actions.isPending}
                            onClick={() => void handleRun(plan)}
                          >
                            {busyId === `run-${plan.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            Run now
                          </GlassButton>
                          <GlassButton
                            variant="danger"
                            disabled={actions.isPending}
                            onClick={() => void handleCancel(plan)}
                          >
                            {busyId === `cancel-${plan.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            Cancel
                          </GlassButton>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </GlassCard>
          </div>
        )}
      </div>
    </PageTransition>
  );
}
