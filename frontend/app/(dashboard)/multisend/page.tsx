"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUpDown,
  CheckCircle2,
  Download,
  ExternalLink,
  FileUp,
  Loader2,
  Plus,
  Send,
  Trash2,
  Upload,
  Users,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import type { Abi } from "viem";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import {
  useArcLendContractWrite,
  resultHash,
} from "@/hooks/useArcLendContractWrite";
import { PageTransition } from "@/components/layout/PageTransition";
import { PageHeader } from "@/components/layout/PageHeader";
import { GlassButton } from "@/components/ui/GlassButton";
import { cn } from "@/lib/utils";
import { ARCSCAN_TX } from "@/components/modals/modalUtils";
import { ARC_TESTNET_CONTRACTS } from "@/constants/contracts";
import erc20Abi from "@/constants/abis/ERC20.json";
import multiSendAbi from "@/constants/abis/MultiSend.json";
import deployments from "@/constants/deployments.json";

// ─── Constants ──────────────────────────────────────────────────────────

const MAX_RECIPIENTS = 200;
const USDC_ADDRESS = ARC_TESTNET_CONTRACTS.USDC as `0x${string}`;
const EURC_ADDRESS = ARC_TESTNET_CONTRACTS.EURC as `0x${string}`;
const MULTISEND_ADDRESS = (
  deployments as Record<string, unknown>
).MultiSend as `0x${string}` | undefined;
// ─── Types ──────────────────────────────────────────────────────────────

interface RecipientRow {
  id: string;
  address: string;
  usdcAmount: string;
  eurcAmount: string;
  error?: string;
}

type TabId = "manual" | "csv";
type ExecStep = "idle" | "approving" | "sending" | "success" | "error";

// ─── Helpers ────────────────────────────────────────────────────────────

let _rowCounter = 0;
function nextId(): string {
  _rowCounter += 1;
  return `row-${_rowCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

function newRow(): RecipientRow {
  return { id: nextId(), address: "", usdcAmount: "", eurcAmount: "" };
}

function parseTokenAmount(value: string): bigint {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized || !/^(?:\d+|\d*\.\d{0,6})$/.test(normalized)) return 0n;
  try {
    const [whole = "0", frac = ""] = normalized.split(".");
    const padded = frac.padEnd(6, "0").slice(0, 6);
    return BigInt(whole) * 1_000_000n + BigInt(padded);
  } catch {
    return 0n;
  }
}

function formatTokenAmount(value: bigint, digits = 2): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, digits);
  const formatted = `${whole.toLocaleString()}.${fracStr}`;
  // drop trailing zeros & dot
  return formatted.replace(/\.?0+$/, "") || "0";
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// CSV template content
const CSV_TEMPLATE = `address,usdc_amount,eurc_amount
0xAbC123...def,100.50,0
0xDeF456...abc,0,200.75
0x789012...345,50.00,75.00`;

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-white/32">
      {children}
    </span>
  );
}

function AmountWell({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div
        className={cn(
          "rounded-xl border bg-black/25 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
          invalid ? "border-red-400/25" : "border-white/[0.08]",
        )}
      >
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/20",
            invalid && "text-red-200",
          )}
        />
      </div>
    </label>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────

export default function MultiSendPage() {
  const { address: walletAddress, isConnected } = useAccount();
  const { writeContractAsync } = useArcLendContractWrite();

  // ── State ────────────────────────────────────────────────────────
  const [rows, setRows] = useState<RecipientRow[]>([newRow()]);
  const [activeTab, setActiveTab] = useState<TabId>("manual");
  const [step, setStep] = useState<ExecStep>("idle");
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [txHashes, setTxHashes] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [csvError, setCsvError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Derived: validated valid rows ─────────────────────────────────
  const validation = useMemo(() => {
    const seen = new Map<string, number>(); // address → first index
    const validRows: RecipientRow[] = [];
    const invalidRows: RecipientRow[] = [];
    const duplicates: { address: string; indices: number[] }[] = [];
    let hasAnyData = false;

    const validated = rows.map((row, idx) => {
      const addr = row.address.trim();
      const usdc = row.usdcAmount.trim();
      const eurc = row.eurcAmount.trim();

      if (!addr && !usdc && !eurc) return { ...row }; // empty row, skip

      hasAnyData = true;
      let error: string | undefined;

      if (!addr) {
        error = "Address is required";
      } else if (!isAddress(addr)) {
        error = "Invalid EVM address";
      } else if (
        addr.toLowerCase() === "0x0000000000000000000000000000000000000000"
      ) {
        error = "Cannot send to zero address";
      }

      const usdcParsed = usdc ? parseTokenAmount(usdc) : 0n;
      const eurcParsed = eurc ? parseTokenAmount(eurc) : 0n;

      if (addr && isAddress(addr) && usdcParsed === 0n && eurcParsed === 0n) {
        if (usdc || eurc) {
          error = "At least one amount must be positive";
        } else {
          error = "Enter at least one amount";
        }
      }

      if (usdc && usdcParsed === 0n && usdc !== "0" && usdc !== "0.0") {
        error = error || "Invalid USDC amount";
      }
      if (eurc && eurcParsed === 0n && eurc !== "0" && eurc !== "0.0") {
        error = error || "Invalid EURC amount";
      }

      // Track duplicates
      if (addr && isAddress(addr) && !error) {
        const lower = addr.toLowerCase();
        if (seen.has(lower)) {
          const firstIdx = seen.get(lower)!;
          const existing = duplicates.find(
            (d) => d.address === lower,
          );
          if (existing) {
            existing.indices.push(idx);
          } else {
            duplicates.push({ address: lower, indices: [firstIdx, idx] });
          }
        } else {
          seen.set(lower, idx);
        }
      }

      const validatedRow = { ...row, error };
      if (error) {
        invalidRows.push(validatedRow);
      } else if (addr) {
        validRows.push(validatedRow);
      }
      return validatedRow;
    });

    return { validated, validRows, invalidRows, duplicates, hasAnyData };
  }, [rows]);

  // Mark duplicate rows
  const rowsWithDuplicates = useMemo(() => {
    const dupAddrs = new Set(
      validation.duplicates.flatMap((d) =>
        d.indices.map((i) => validation.validated[i]?.address?.toLowerCase()),
      ),
    );
    return validation.validated.map((row) => {
      if (
        row.address &&
        dupAddrs.has(row.address.toLowerCase()) &&
        !row.error
      ) {
        return {
          ...row,
          error: "⚠ Duplicate address (check if intentional)",
        };
      }
      return row;
    });
  }, [validation]);

  // ── Derived: batch info ──────────────────────────────────────────
  const batches = useMemo(() => {
    const usable = rowsWithDuplicates.filter(
      (r) => r.address.trim() && !r.error?.startsWith("Invalid") && !r.error?.startsWith("Address is required") && !r.error?.startsWith("Enter") && !r.error?.startsWith("Cannot send"),
    );
    const valid = usable.filter(
      (r) =>
        isAddress(r.address.trim()) &&
        !r.error?.startsWith("Invalid EVM") &&
        !r.error?.startsWith("Cannot send to zero"),
    );
    return chunkArray(valid, MAX_RECIPIENTS);
  }, [rowsWithDuplicates]);

  // Totals per batch
  const batchTotals = useMemo(() => {
    return batches.map((batch) => {
      let usdc = 0n;
      let eurc = 0n;
      for (const row of batch) {
        usdc += parseTokenAmount(row.usdcAmount);
        eurc += parseTokenAmount(row.eurcAmount);
      }
      return { usdc, eurc, count: batch.length };
    });
  }, [batches]);

  // ── Row manipulation ─────────────────────────────────────────────
  const addRow = useCallback(() => {
    setRows((prev) => [...prev, newRow()]);
  }, []);

  const updateRow = useCallback(
    (id: string, field: keyof RecipientRow, value: string) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev; // keep at least one row
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  // ── CSV parsing ──────────────────────────────────────────────────
  const handleCsvFile = useCallback(
    async (file: File) => {
      setCsvError("");
      try {
        const Papa = (await import("papaparse")).default;
        const text = await file.text();
        const result = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h: string) => h.trim().toLowerCase(),
        });

        if (result.errors.length > 0) {
          const firstErr = result.errors[0];
          setCsvError(
            `CSV parse error at row ${firstErr.row ?? "?"}: ${firstErr.message}`,
          );
          return;
        }

        const headers = Object.keys(result.data[0] ?? {});
        const hasAddress =
          headers.includes("address") ||
          headers.includes("wallet") ||
          headers.includes("recipient");
        const hasUsdc =
          headers.includes("usdc_amount") ||
          headers.includes("usdc") ||
          headers.includes("usdcamount");
        const hasEurc =
          headers.includes("eurc_amount") ||
          headers.includes("eurc") ||
          headers.includes("eurcamount");

        if (!hasAddress) {
          setCsvError(
            'CSV must have an "address" column. Expected columns: address, usdc_amount, eurc_amount',
          );
          return;
        }

        if (!hasUsdc && !hasEurc) {
          setCsvError(
            'CSV must have at least one amount column: "usdc_amount" or "eurc_amount"',
          );
          return;
        }

        const parsedRows: RecipientRow[] = result.data.map(
          (record: Record<string, string>) => {
            const addrKey =
              headers.find(
                (h) =>
                  h === "address" || h === "wallet" || h === "recipient",
              ) ?? "address";
            const usdcKey =
              headers.find(
                (h) =>
                  h === "usdc_amount" ||
                  h === "usdc" ||
                  h === "usdcamount",
              ) ?? "usdc_amount";
            const eurcKey =
              headers.find(
                (h) =>
                  h === "eurc_amount" ||
                  h === "eurc" ||
                  h === "eurcamount",
              ) ?? "eurc_amount";

            return {
              id: nextId(),
              address: (record[addrKey] ?? "").trim(),
              usdcAmount: hasUsdc
                ? (record[usdcKey] ?? "0").trim()
                : "0",
              eurcAmount: hasEurc
                ? (record[eurcKey] ?? "0").trim()
                : "0",
            };
          },
        );

        // Filter out completely empty rows
        const filtered = parsedRows.filter(
          (r) => r.address || r.usdcAmount !== "0" || r.eurcAmount !== "0",
        );

        if (filtered.length === 0) {
          setCsvError("CSV file contains no data rows.");
          return;
        }

        setRows(filtered);
        setActiveTab("manual"); // switch to manual tab to show the preview table
      } catch (err) {
        setCsvError(
          err instanceof Error ? err.message : "Failed to parse CSV file",
        );
      }
    },
    [],
  );

  const handleFileDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
        handleCsvFile(file);
      } else {
        setCsvError("Please upload a .csv file");
      }
    },
    [handleCsvFile],
  );

  const handleFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleCsvFile(file);
      // reset so re-selecting the same file triggers again
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleCsvFile],
  );

  const downloadTemplate = useCallback(() => {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "multisend_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Execution ────────────────────────────────────────────────────
  const canExecute = useMemo(() => {
    const usable = rowsWithDuplicates.filter(
      (r) => r.address.trim() && !r.error,
    );
    return usable.length > 0 && isConnected && MULTISEND_ADDRESS;
  }, [rowsWithDuplicates, isConnected]);

  const execute = useCallback(async () => {
    if (!MULTISEND_ADDRESS || !walletAddress) return;

    setStep("approving");
    setErrorMessage("");
    setTxHashes([]);
    setTotalBatches(batches.length);
    setCurrentBatch(0);

    const hashes: string[] = [];

    try {
      for (let b = 0; b < batches.length; b++) {
        setCurrentBatch(b + 1);
        const batch = batches[b];
        const recipients = batch.map((r) => r.address.trim() as `0x${string}`);
        const usdcAmounts = batch.map((r) => parseTokenAmount(r.usdcAmount));
        const eurcAmounts = batch.map((r) => parseTokenAmount(r.eurcAmount));

        const totalUsdc = usdcAmounts.reduce((a, v) => a + v, 0n);
        const totalEurc = eurcAmounts.reduce((a, v) => a + v, 0n);
        const hasUsdc = totalUsdc > 0n;
        const hasEurc = totalEurc > 0n;
        const isDual = hasUsdc && hasEurc;
        const tokenForSingle = hasUsdc ? USDC_ADDRESS : EURC_ADDRESS;
        const amountsForSingle = hasUsdc ? usdcAmounts : eurcAmounts;

        // ── Step 1: Approve ──────────────────────────────────────
        setStep("approving");

        if (isDual) {
          // Dual asset — approve both USDC and EURC
          if (totalUsdc > 0n) {
            await writeContractAsync({
              chainId: 5042002,
              address: USDC_ADDRESS,
              abi: erc20Abi as Abi,
              functionName: "approve",
              args: [MULTISEND_ADDRESS, totalUsdc],
            });
            // wait briefly between approvals
            await new Promise((r) => setTimeout(r, 1500));
          }
          if (totalEurc > 0n) {
            await writeContractAsync({
              chainId: 5042002,
              address: EURC_ADDRESS,
              abi: erc20Abi as Abi,
              functionName: "approve",
              args: [MULTISEND_ADDRESS, totalEurc],
            });
            await new Promise((r) => setTimeout(r, 1500));
          }
        } else {
          // Single asset
          const tokenAddr = tokenForSingle;
          const total = hasUsdc ? totalUsdc : totalEurc;
          await writeContractAsync({
            chainId: 5042002,
            address: tokenAddr as `0x${string}`,
            abi: erc20Abi as Abi,
            functionName: "approve",
            args: [MULTISEND_ADDRESS, total],
          });
          await new Promise((r) => setTimeout(r, 1500));
        }

        // ── Step 2: MultiSend ────────────────────────────────────
        setStep("sending");

        let result;
        if (isDual) {
          result = await writeContractAsync({
            chainId: 5042002,
            address: MULTISEND_ADDRESS,
            abi: multiSendAbi as Abi,
            functionName: "multiSendDual",
            args: [
              recipients,
              usdcAmounts,
              eurcAmounts,
              USDC_ADDRESS,
              EURC_ADDRESS,
            ],
          });
        } else {
          result = await writeContractAsync({
            chainId: 5042002,
            address: MULTISEND_ADDRESS,
            abi: multiSendAbi as Abi,
            functionName: "multiSend",
            args: [tokenForSingle, recipients, amountsForSingle],
          });
        }

        const hash = resultHash(result);
        if (hash) {
          hashes.push(hash);
          setTxHashes([...hashes]);
        }
      }

      setStep("success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Transaction failed";
      // Try to extract a useful reason
      const revertMatch = msg.match(
        /MultiSend:\s*([^\n"\\]+)/i,
      );
      setErrorMessage(revertMatch?.[1]?.trim() ?? msg.split("\n")[0]);
      setStep("error");
    }
  }, [batches, walletAddress, writeContractAsync]);

  const reset = useCallback(() => {
    setStep("idle");
    setCurrentBatch(0);
    setTotalBatches(0);
    setTxHashes([]);
    setErrorMessage("");
  }, []);

  // ── Totals display ──────────────────────────────────────────────
  const grandTotal = useMemo(() => {
    let usdc = 0n;
    let eurc = 0n;
    for (const bt of batchTotals) {
      usdc += bt.usdc;
      eurc += bt.eurc;
    }
    return { usdc, eurc };
  }, [batchTotals]);

  const validCount = rowsWithDuplicates.filter(
    (r) => r.address.trim() && !r.error?.startsWith("Invalid") && !r.error?.startsWith("Address is required") && !r.error?.startsWith("Enter") && !r.error?.startsWith("Cannot send"),
  ).length;
  const hasWarnings = rowsWithDuplicates.some(
    (r) => r.error?.startsWith("⚠"),
  );

  // ── Render ──────────────────────────────────────────────────────
  const hardError = (error?: string) =>
    Boolean(error && !error.startsWith("⚠"));

  return (
    <PageTransition>
      <PageHeader
        icon={<Users className="h-4 w-4" />}
        title="MultiSend"
        description="Send USDC and EURC to many wallets in a single signed batch."
        stats={[
          { label: "Recipients", value: String(validCount) },
          {
            label: "USDC",
            value: formatTokenAmount(grandTotal.usdc),
          },
          {
            label: "EURC",
            value: formatTokenAmount(grandTotal.eurc),
          },
        ]}
      />

      <div className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-[28px] border border-white/[0.08] bg-white/[0.03] p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.38)]">
          <div className="overflow-hidden rounded-[22px] border border-white/[0.07] bg-black/25">
            <div className="flex flex-col gap-4 border-b border-white/[0.06] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <p className="font-display text-lg text-white">Recipients</p>
                <p className="mt-1 text-sm text-white/40">
                  Build the list by hand or import a CSV.
                </p>
              </div>
              <div className="flex w-full rounded-full border border-white/[0.08] bg-white/[0.03] p-1 sm:w-auto">
                {([
                  ["manual", "Manual"],
                  ["csv", "CSV"],
                ] as [TabId, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setActiveTab(id)}
                    className={cn(
                      "min-h-10 flex-1 rounded-full px-4 text-sm font-medium transition sm:flex-none",
                      activeTab === id
                        ? "bg-white text-black"
                        : "text-white/45 hover:text-white",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 sm:p-5">
              {activeTab === "manual" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-3"
                >
                  <AnimatePresence>
                    {rowsWithDuplicates.map((row, idx) => (
                      <motion.div
                        key={row.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className={cn(
                          "rounded-2xl border p-4",
                          hardError(row.error)
                            ? "border-red-400/20 bg-red-500/[0.05]"
                            : row.error?.startsWith("⚠")
                              ? "border-amber-400/20 bg-amber-400/[0.04]"
                              : "border-white/[0.07] bg-white/[0.025]",
                        )}
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/28">
                            {String(idx + 1).padStart(2, "0")}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            className="rounded-lg p-1.5 text-white/25 transition hover:bg-red-500/15 hover:text-red-300"
                            aria-label="Remove row"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <label className="block">
                          <FieldLabel>Wallet</FieldLabel>
                          <div
                            className={cn(
                              "rounded-xl border bg-black/25 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                              hardError(row.error)
                                ? "border-red-400/25"
                                : "border-white/[0.08]",
                            )}
                          >
                            <input
                              type="text"
                              placeholder="0x..."
                              value={row.address}
                              onChange={(event) =>
                                updateRow(row.id, "address", event.target.value)
                              }
                              className={cn(
                                "w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-white/20",
                                hardError(row.error) && "text-red-200",
                              )}
                            />
                          </div>
                        </label>
                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <AmountWell
                            label="USDC"
                            value={row.usdcAmount}
                            invalid={hardError(row.error)}
                            onChange={(value) =>
                              updateRow(row.id, "usdcAmount", value)
                            }
                          />
                          <AmountWell
                            label="EURC"
                            value={row.eurcAmount}
                            invalid={hardError(row.error)}
                            onChange={(value) =>
                              updateRow(row.id, "eurcAmount", value)
                            }
                          />
                        </div>
                        {row.error ? (
                          <p
                            className={cn(
                              "mt-2 text-[11px]",
                              row.error.startsWith("⚠")
                                ? "text-amber-200/80"
                                : "text-red-300/80",
                            )}
                          >
                            {row.error}
                          </p>
                        ) : null}
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  <GlassButton variant="ghost" onClick={addRow} className="w-full">
                    <Plus className="h-4 w-4" />
                    Add recipient
                  </GlassButton>
                </motion.div>
              )}

              {activeTab === "csv" && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-4"
                >
                  <div
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleFileDrop}
                    className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/[0.14] bg-white/[0.02] px-6 py-14 text-center transition hover:border-white/25 hover:bg-white/[0.035]"
                  >
                    <div className="rounded-full border border-white/[0.10] bg-white/[0.05] p-3">
                      <Upload className="h-5 w-5 text-white/55" />
                    </div>
                    <div>
                      <p className="text-sm text-white/70">
                        Drop a CSV here, or{" "}
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-[#86efac] underline underline-offset-2 hover:text-emerald-100"
                        >
                          browse
                        </button>
                      </p>
                      <p className="mt-2 font-mono text-[11px] text-white/30">
                        address, usdc_amount, eurc_amount
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleFilePick}
                    />
                  </div>

                  <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3 sm:flex-row sm:items-center">
                    <FileUp className="h-4 w-4 shrink-0 text-white/40" />
                    <p className="min-w-0 flex-1 text-sm text-white/50">
                      Download the sample file if you need the column layout.
                    </p>
                    <GlassButton variant="ghost" onClick={downloadTemplate}>
                      <Download className="h-3.5 w-3.5" />
                      Template
                    </GlassButton>
                  </div>

                  {csvError ? (
                    <div className="flex items-start gap-3 rounded-2xl border border-red-400/25 bg-red-400/[0.06] px-4 py-3">
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                      <p className="text-sm text-red-300/85">{csvError}</p>
                    </div>
                  ) : null}

                  {rowsWithDuplicates.filter((row) => row.address.trim()).length > 0 ? (
                    <div className="rounded-2xl border border-[#86efac]/20 bg-[#86efac]/[0.05] px-4 py-3">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#86efac]" />
                        <p className="text-sm text-[#86efac]/85">
                          Parsed{" "}
                          {rowsWithDuplicates.filter((row) => row.address.trim()).length}{" "}
                          recipients.{" "}
                          <button
                            type="button"
                            onClick={() => setActiveTab("manual")}
                            className="underline underline-offset-2 hover:text-emerald-100"
                          >
                            Review in Manual
                          </button>
                        </p>
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              )}
            </div>
          </div>
        </section>

        <aside className="xl:sticky xl:top-28">
          <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.03] p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.38)]">
            <div className="rounded-[22px] border border-white/[0.07] bg-black/25 p-5">
              <p className="font-display text-lg text-white">Settlement</p>
              <p className="mt-1 text-sm text-white/40">
                Review totals, then sign once per batch.
              </p>

              <dl className="mt-6 space-y-4">
                <div className="flex items-end justify-between gap-4 border-b border-white/[0.06] pb-4">
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-white/32">
                    USDC
                  </dt>
                  <dd className="font-mono text-2xl text-white">
                    {formatTokenAmount(grandTotal.usdc)}
                  </dd>
                </div>
                <div className="flex items-end justify-between gap-4 border-b border-white/[0.06] pb-4">
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-white/32">
                    EURC
                  </dt>
                  <dd className="font-mono text-2xl text-white">
                    {formatTokenAmount(grandTotal.eurc)}
                  </dd>
                </div>
                <div className="flex items-end justify-between gap-4">
                  <dt className="text-[10px] uppercase tracking-[0.16em] text-white/32">
                    Wallets
                  </dt>
                  <dd className="font-mono text-2xl text-white">{validCount}</dd>
                </div>
              </dl>

              {batches.length > 1 ? (
                <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-xs text-amber-100/80">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    This list needs {batches.length} transactions
                    ({batches.map((batch) => batch.length).join(" + ")} recipients).
                  </span>
                </div>
              ) : null}

              {hasWarnings ? (
                <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-xs text-amber-100/80">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Duplicate addresses detected
                </div>
              ) : null}

              <div className="mt-6">
                {step === "idle" && validCount === 0 ? (
                  <p className="text-sm leading-6 text-white/35">
                    Add at least one valid recipient to unlock sending.
                  </p>
                ) : null}

                {step === "idle" && validCount > 0 && !isConnected ? (
                  <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-sm text-amber-100/80">
                    Connect a wallet to send this batch.
                  </p>
                ) : null}

                {step === "idle" && validCount > 0 && isConnected && !MULTISEND_ADDRESS ? (
                  <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2.5 text-sm text-amber-100/80">
                    MultiSend contract is not deployed yet.
                  </p>
                ) : null}

                {step === "idle" && canExecute ? (
                  <GlassButton
                    variant="primary"
                    onClick={execute}
                    className="w-full"
                  >
                    <Send className="h-4 w-4" />
                    {batches.length > 1
                      ? `Send ${batches.length} batches`
                      : "Send now"}
                  </GlassButton>
                ) : null}

                {step === "approving" ? (
                  <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3">
                    <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-white/70" />
                    <div>
                      <p className="text-sm text-white">
                        Approving spend
                        {totalBatches > 1
                          ? ` (batch ${currentBatch} of ${totalBatches})`
                          : ""}
                      </p>
                      <p className="mt-1 text-xs text-white/40">
                        Confirm the approval in your wallet.
                      </p>
                    </div>
                  </div>
                ) : null}

                {step === "sending" ? (
                  <div className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3">
                    <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-white/70" />
                    <div>
                      <p className="text-sm text-white">
                        Sending batch {currentBatch} of {totalBatches}
                      </p>
                      <p className="mt-1 text-xs text-white/40">
                        Confirm the transaction in your wallet.
                      </p>
                    </div>
                  </div>
                ) : null}

                {step === "success" ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[#86efac]/20 bg-[#86efac]/[0.06] px-3 py-3">
                      <div className="flex items-center gap-2 text-[#86efac]">
                        <CheckCircle2 className="h-4 w-4" />
                        <p className="text-sm font-medium">Batch complete</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-[#86efac]/70">
                        {validCount} recipient{validCount !== 1 ? "s" : ""}
                        {grandTotal.usdc > 0n
                          ? ` / ${formatTokenAmount(grandTotal.usdc)} USDC`
                          : ""}
                        {grandTotal.eurc > 0n
                          ? ` / ${formatTokenAmount(grandTotal.eurc)} EURC`
                          : ""}
                      </p>
                    </div>
                    {txHashes.map((hash, index) => (
                      <a
                        key={hash}
                        href={`${ARCSCAN_TX}${hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 transition hover:bg-white/[0.05]"
                      >
                        <span className="text-[11px] text-white/35">
                          {txHashes.length > 1 ? `Batch ${index + 1}` : "Tx"}
                        </span>
                        <span className="font-mono text-xs text-[#86efac]/80">
                          {hash.slice(0, 8)}...{hash.slice(-6)}
                        </span>
                        <ExternalLink className="ml-auto h-3.5 w-3.5 text-white/30" />
                      </a>
                    ))}
                    <GlassButton variant="ghost" onClick={reset} className="w-full">
                      <ArrowUpDown className="h-4 w-4" />
                      New batch
                    </GlassButton>
                  </div>
                ) : null}

                {step === "error" ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-red-400/20 bg-red-400/[0.06] px-3 py-3">
                      <div className="flex items-center gap-2 text-red-300">
                        <XCircle className="h-4 w-4" />
                        <p className="text-sm font-medium">Transaction failed</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-red-300/70">
                        {errorMessage}
                      </p>
                      {currentBatch > 0 && txHashes.length > 0 ? (
                        <p className="mt-2 text-xs text-white/40">
                          {txHashes.length} batch
                          {txHashes.length !== 1 ? "es" : ""} completed before the error.
                        </p>
                      ) : null}
                    </div>
                    <GlassButton variant="ghost" onClick={reset} className="w-full">
                      Try again
                    </GlassButton>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </PageTransition>
  );
}
