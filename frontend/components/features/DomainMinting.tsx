"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { usePublicClient } from "wagmi";
import { erc20Abi, formatUnits, parseAbi, parseAbiItem, parseUnits, toHex, type Address } from "viem";
import deployments from "@/constants/deployments.json";
import {
  Globe,
  Search,
  ArrowLeftRight,
  Loader2,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  BookOpen,
  Sparkles,
  AlertCircle,
  X,
  Star,
  User,
  RefreshCcw,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
  type ArcLendContractWriteRequest,
} from "@/hooks/useArcLendContractWrite";
import { announcePrimaryDomainChanged } from "@/lib/domainEvents";
import { showToast } from "@/lib/toast";

// ── Contract config ────────────────────────────────────────────────────────
// Lendora WalletDomain contract on Arc Testnet
const WALLET_DOMAIN_ADDRESS = deployments.WalletDomain as Address;
const ARC_EXPLORER = "https://testnet.arcscan.app";
const DISPLAY_DOMAIN_SUFFIX = ".lendora";
const DOMAIN_SUFFIX_PATTERN = /\.(?:lendora|arclend|arc)$/;
const DOMAIN_MARKETPLACE_ADDRESS = (
  deployments as typeof deployments & {
    DomainMarketplace?: Address;
  }
).DomainMarketplace;
const USDC_ADDRESS = deployments.markets.USDC.asset as Address;
// Deployment block (scan logs from here to avoid scanning the whole chain)
const DEPLOYMENT_BLOCK = BigInt(
  (
    deployments as {
      deploymentBlock: number;
      walletDomainDeploymentBlock?: number;
    }
  ).walletDomainDeploymentBlock ?? deployments.deploymentBlock
);
const DOMAIN_MARKETPLACE_DEPLOYMENT_BLOCK = BigInt(
  (
    deployments as typeof deployments & {
      domainMarketplaceDeploymentBlock?: number;
    }
  ).domainMarketplaceDeploymentBlock ?? deployments.deploymentBlock
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const abi = parseAbi([
  "function makeCommitment(string name,address owner,bytes32 secret) view returns (bytes32)",
  "function commitDomain(bytes32 commitment) external",
  "function mintDomain(string name,bytes32 secret) external returns (uint256)",
  "error InvalidDomainName()",
  "error DomainNotOwned()",
  "error InvalidCommitment()",
  "error CommitmentTooNew()",
  "error CommitmentExpired()",
  "function setPrimaryDomain(string name) external",
  "function burnDomain(string name) external",
  "function approve(address to, uint256 tokenId) external",
  "function resolveDomain(string name) view returns (address)",
  "function isRegistered(string name) view returns (bool)",
  "function primaryDomainOf(address owner) view returns (string)",
  "function domainNames(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256 index) view returns (uint256)",
  "event DomainMinted(address indexed owner, string domainName, uint256 indexed tokenId)",
]);
const marketplaceAbi = parseAbi([
  "function list(uint256 tokenId, uint256 price) external",
  "function cancelListing(uint256 tokenId) external",
  "function buy(uint256 tokenId,uint256 maxPrice) external",
  "function listings(uint256 tokenId) view returns (address seller, uint256 price)",
  "event DomainListed(uint256 indexed tokenId, address indexed seller, uint256 price)",
  "event DomainListingCancelled(uint256 indexed tokenId, address indexed seller)",
  "event DomainPurchased(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)",
]);

interface DomainEntry {
  tokenId: bigint;
  name: string;
  owner: string;
}

type CachedDomainEntry = Omit<DomainEntry, "tokenId"> & {
  tokenId: string;
};

interface DomainListing extends DomainEntry {
  seller: string;
  price: bigint;
}

type MarketplacePurchaseReceipt = {
  domainName: string;
  buyer: string;
  seller: string;
  price: string;
  hash?: string;
};

// localStorage key for per-wallet primary domain
function primaryKey(address: string) {
  return `arclend:primary:${address.toLowerCase()}`;
}

function shortenAddress(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function normalizeDomainInput(value: string) {
  return value.trim().toLowerCase().replace(DOMAIN_SUFFIX_PATTERN, "");
}

function displayDomainName(name: string) {
  const normalized = normalizeDomainInput(name);
  return normalized ? `${normalized}${DISPLAY_DOMAIN_SUFFIX}` : "";
}

async function waitForPrimaryDomain(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  owner: Address,
  expectedName: string,
) {
  const normalizedExpectedName = normalizeDomainInput(expectedName);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const primary = (await publicClient.readContract({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "primaryDomainOf",
        args: [owner],
      })) as string;

      if (normalizeDomainInput(primary) === normalizedExpectedName) return;
    } catch {
      // The next retry handles brief RPC propagation delays after confirmation.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }

  throw new Error("The primary-domain transaction was not confirmed on Arc.");
}

async function fetchDomainEntry(
  publicClient: ReturnType<typeof usePublicClient>,
  tokenId: bigint
): Promise<DomainEntry | null> {
  if (!publicClient) return null;

  const [name, owner] = await Promise.all([
    publicClient.readContract({
      address: WALLET_DOMAIN_ADDRESS,
      abi,
      functionName: "domainNames",
      args: [tokenId],
    }) as Promise<string>,
    publicClient.readContract({
      address: WALLET_DOMAIN_ADDRESS,
      abi,
      functionName: "ownerOf",
      args: [tokenId],
    }) as Promise<string>,
  ]);

  if (!name || !owner || owner === ZERO_ADDRESS) return null;
  return { tokenId, name, owner };
}

async function fetchOwnedDomains(
  publicClient: ReturnType<typeof usePublicClient>,
  owner: Address
): Promise<DomainEntry[]> {
  if (!publicClient) return [];

  try {
    const balance = (await publicClient.readContract({
      address: WALLET_DOMAIN_ADDRESS,
      abi,
      functionName: "balanceOf",
      args: [owner],
    })) as bigint;

    const entries = await Promise.all(
      Array.from({ length: Number(balance) }, async (_, index) => {
        const tokenId = (await publicClient.readContract({
          address: WALLET_DOMAIN_ADDRESS,
          abi,
          functionName: "tokenOfOwnerByIndex",
          args: [owner, BigInt(index)],
        })) as bigint;
        return fetchDomainEntry(publicClient, tokenId);
      })
    );

    return entries.filter((entry): entry is DomainEntry => Boolean(entry));
  } catch {
    const all = await fetchAllDomainEvents(publicClient);
    const minted = all.filter((d) => d.owner.toLowerCase() === owner.toLowerCase());
    const liveEntries = await Promise.all(
      minted.map((entry) =>
        fetchDomainEntry(publicClient, entry.tokenId).catch(() => null)
      )
    );

    return liveEntries
      .filter((entry): entry is DomainEntry => Boolean(entry))
      .filter((entry) => entry.owner.toLowerCase() === owner.toLowerCase());
  }
}

async function fetchRegistryDomains(
  publicClient: ReturnType<typeof usePublicClient>
): Promise<DomainEntry[]> {
  if (!publicClient) return [];

  try {
    const totalSupply = (await publicClient.readContract({
      address: WALLET_DOMAIN_ADDRESS,
      abi,
      functionName: "totalSupply",
    })) as bigint;

    const entries = await Promise.all(
      Array.from({ length: Number(totalSupply) }, async (_, index) => {
        const tokenId = (await publicClient.readContract({
          address: WALLET_DOMAIN_ADDRESS,
          abi,
          functionName: "tokenByIndex",
          args: [BigInt(index)],
        })) as bigint;
        return fetchDomainEntry(publicClient, tokenId);
      })
    );

    return entries.filter((entry): entry is DomainEntry => Boolean(entry));
  } catch {
    return fetchAllDomainEvents(publicClient);
  }
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="text-white/30 hover:text-white/60 transition-colors">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ── Fetch all DomainMinted events (with chunking for large ranges) ───────────
async function fetchAllDomainEvents(
  publicClient: ReturnType<typeof usePublicClient>
): Promise<DomainEntry[]> {
  if (!publicClient) return [];

  const CACHE_KEY = `arclend:domains:cache:${WALLET_DOMAIN_ADDRESS.toLowerCase()}`;
  let lastScannedBlock = DEPLOYMENT_BLOCK - 1n;
  let cachedEntries: DomainEntry[] = [];

  // Try to load from cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        lastBlock: string;
        entries: CachedDomainEntry[];
      };
      lastScannedBlock = BigInt(parsed.lastBlock);
      cachedEntries = parsed.entries.map((e) => ({
        ...e,
        tokenId: BigInt(e.tokenId),
      }));
    }
  } catch (e) {
    console.warn("Failed to load domain cache:", e);
  }

  const latestBlock = await publicClient.getBlockNumber();
  if (latestBlock <= lastScannedBlock) {
    return cachedEntries;
  }

  const CHUNK = 2000n; // stay within RPC limits
  const newEntries: DomainEntry[] = [];

  for (let from = lastScannedBlock + 1n; from <= latestBlock; from += CHUNK) {
    const to = from + CHUNK - 1n > latestBlock ? latestBlock : from + CHUNK - 1n;
    const logs = await publicClient.getLogs({
      address: WALLET_DOMAIN_ADDRESS,
      event: parseAbiItem(
        "event DomainMinted(address indexed owner, string domainName, uint256 indexed tokenId)"
      ),
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      if (log.args.owner && log.args.domainName && log.args.tokenId !== undefined) {
        newEntries.push({
          tokenId: log.args.tokenId,
          name: log.args.domainName,
          owner: log.args.owner,
        });
      }
    }
  }

  const allEntries = [...cachedEntries, ...newEntries];

  // Save back to cache
  if (newEntries.length > 0 || latestBlock > lastScannedBlock) {
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          lastBlock: latestBlock.toString(),
          entries: allEntries.map((e) => ({
            ...e,
            tokenId: e.tokenId.toString(),
          })),
        })
      );
    } catch (e) {
      console.warn("Failed to save domain cache:", e);
    }
  }

  return allEntries;
}

// ── Mint success popup ───────────────────────────────────────────────────────
function MintSuccessModal({
  name,
  wallet,
  hash,
  onClose,
  onSetPrimary,
  settingPrimary,
}: {
  name: string;
  wallet: string;
  hash?: string;
  onClose: () => void;
  onSetPrimary: () => void;
  settingPrimary: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[1000] overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-md sm:py-8"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex min-h-full items-start justify-center sm:items-center">
      <div className="relative w-full max-w-[340px] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-emerald-400/30 bg-[#030705] shadow-[0_0_70px_rgba(16,185,129,0.22)] animate-in fade-in zoom-in-95 duration-200">
        <div className="absolute inset-x-0 top-0 h-1 bg-emerald-400" />
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-white/35 transition-colors hover:text-white"
          aria-label="Close mint receipt"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/75">
                Domain Minted
              </p>
              <h3 className="mt-1 text-xl font-semibold text-white">Mint Receipt</h3>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06]">
            <div className="border-b border-emerald-400/15 p-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                Domain Name
              </p>
              <p className="mt-2 break-words text-2xl font-bold text-white">
                {displayDomainName(name)}
              </p>
            </div>

            <div className="border-b border-emerald-400/15 p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                Minted To
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate font-mono text-xs text-white">{wallet}</p>
                <CopyButton text={wallet} />
              </div>
            </div>

            {hash ? <div className="p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                Transaction
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate font-mono text-xs text-white">{hash}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <CopyButton text={hash} />
                  <a
                    href={`${ARC_EXPLORER}/tx/${hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-white/35 transition-colors hover:text-emerald-300"
                    aria-label="View transaction"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div> : null}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              onClick={onSetPrimary}
              disabled={settingPrimary}
              className="flex items-center justify-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-500 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
            >
              {settingPrimary ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Star className="h-4 w-4" />
              )}
              {settingPrimary ? "Setting primary…" : "Set Primary"}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-emerald-400/20 bg-black py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/10"
            >
              Close
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function MarketplacePurchaseReceiptModal({
  receipt,
  onClose,
}: {
  receipt: MarketplacePurchaseReceipt;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!mounted) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[1000] overflow-y-auto bg-black/80 px-4 py-6 backdrop-blur-md sm:py-8"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex min-h-full items-start justify-center sm:items-center">
        <div className="relative w-full max-w-[360px] max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-emerald-400/30 bg-[#030705] shadow-[0_0_70px_rgba(16,185,129,0.22)] animate-in fade-in zoom-in-95 duration-200">
          <div className="absolute inset-x-0 top-0 h-1 bg-emerald-400" />
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-white/35 transition-colors hover:text-white"
            aria-label="Close purchase receipt"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10">
                <ShoppingCart className="h-5 w-5 text-emerald-300" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/75">
                  Domain Purchased
                </p>
                <h3 className="mt-1 text-xl font-semibold text-white">Purchase Receipt</h3>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06]">
              <div className="border-b border-emerald-400/15 p-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                  Domain Name
                </p>
                <p className="mt-2 break-words text-2xl font-bold text-white">
                  {receipt.domainName}
                </p>
              </div>

              <div className="border-b border-emerald-400/15 p-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                  Purchased For
                </p>
                <p className="mt-2 font-mono text-sm font-semibold text-white">
                  {receipt.price} USDC
                </p>
              </div>

              <div className="border-b border-emerald-400/15 p-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                  Buyer
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-mono text-xs text-white">{receipt.buyer}</p>
                  <CopyButton text={receipt.buyer} />
                </div>
              </div>

              <div className="border-b border-emerald-400/15 p-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                  Seller
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-mono text-xs text-white">{receipt.seller}</p>
                  <CopyButton text={receipt.seller} />
                </div>
              </div>

              {receipt.hash ? <div className="p-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/70">
                  Transaction
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-mono text-xs text-white">{receipt.hash}</p>
                  <div className="flex shrink-0 items-center gap-2">
                    <CopyButton text={receipt.hash} />
                    <a
                      href={`${ARC_EXPLORER}/tx/${receipt.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white/35 transition-colors hover:text-emerald-300"
                      aria-label="View transaction"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div> : null}
            </div>

            <button
              onClick={onClose}
              className="rounded-lg border border-emerald-400/20 bg-black py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/10"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ── Forward lookup (domain → owner) ─────────────────────────────────────────
function ForwardLookup() {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "found" | "notfound" | "error">(
    "idle"
  );
  const [result, setResult] = useState<{ owner: string } | null>(null);

  const lookup = useCallback(async () => {
    if (!publicClient || !input.trim()) return;
    const name = normalizeDomainInput(input);
    setStatus("loading");
    setResult(null);
    try {
      const owner = (await publicClient.readContract({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "resolveDomain",
        args: [name],
      })) as string;

      if (owner && owner !== "0x0000000000000000000000000000000000000000") {
        setResult({ owner });
        setStatus("found");
      } else {
        setStatus("notfound");
      }
    } catch {
      setStatus("notfound");
    }
  }, [publicClient, input]);

  const displayName = displayDomainName(input);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-white/40">
        Enter a <span className="text-blue-300 font-medium">.lendora</span> domain name to find its
        owner.
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setStatus("idle");
              setResult(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="name.lendora"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg py-3 pl-4 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 transition-all text-sm"
          />
        </div>
        <button
          onClick={lookup}
          disabled={!input.trim() || status === "loading"}
          className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 text-white transition-colors flex items-center gap-2 text-sm font-medium"
        >
          {status === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Resolve
        </button>
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-2 text-white/40 text-xs py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Looking up domain…
        </div>
      )}

      {status === "found" && result && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="text-emerald-100 font-semibold text-sm">{displayName}</span>
          </div>
          <div className="flex items-center justify-between bg-black/20 rounded-md px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs text-white/40 mb-0.5">Owner</p>
              <p className="text-white font-mono text-xs break-all">{result.owner}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
              <CopyButton text={result.owner} />
              <a
                href={`${ARC_EXPLORER}/address/${result.owner}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/30 hover:text-white/60 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}

      {status === "notfound" && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 flex items-center gap-2 text-white/50 text-sm">
          <XCircle className="h-4 w-4 text-red-400/70 shrink-0" />
          <span>
            <span className="text-white/70 font-medium">{displayName}</span> is not registered.
          </span>
        </div>
      )}

      {status === "error" && (
        <p className="text-xs text-red-400/80 text-center">Something went wrong. Check the console.</p>
      )}
    </div>
  );
}

// ── Reverse lookup (wallet → domains) ───────────────────────────────────────
function ReverseLookup() {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { address: connectedAddress } = useArcLendAccount();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "found" | "notfound">("idle");
  const [domains, setDomains] = useState<DomainEntry[]>([]);

  const lookup = useCallback(
    async (addr?: string) => {
      const target = (addr ?? input).trim();
      if (!publicClient || !target) return;
      setStatus("loading");
      setDomains([]);
      try {
        const owned = await fetchOwnedDomains(publicClient, target as Address);
        if (owned.length > 0) {
          setDomains(owned);
          setStatus("found");
        } else {
          setStatus("notfound");
        }
      } catch {
        setStatus("notfound");
      }
    },
    [publicClient, input]
  );

  const useMyAddress = () => {
    if (!connectedAddress) return;
    setInput(connectedAddress);
    setStatus("idle");
    setDomains([]);
    lookup(connectedAddress);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-white/40">
        Enter a wallet address to find all its{" "}
        <span className="text-blue-300 font-medium">.lendora</span> domains.
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setStatus("idle");
              setDomains([]);
            }}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
            placeholder="0x..."
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg py-3 pl-4 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 transition-all text-sm font-mono"
          />
        </div>
        <button
          onClick={() => lookup()}
          disabled={!input.trim() || status === "loading"}
          className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-3 text-white transition-colors flex items-center gap-2 text-sm font-medium"
        >
          {status === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Lookup
        </button>
      </div>

      {connectedAddress && (
        <button
          onClick={useMyAddress}
          className="text-xs text-blue-300/60 hover:text-blue-300 transition-colors text-left"
        >
          Use my address ({shortenAddress(connectedAddress)})
        </button>
      )}

      {status === "loading" && (
        <div className="flex items-center gap-2 text-white/40 text-xs py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Scanning event logs…
        </div>
      )}

      {status === "found" && domains.length > 0 && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span className="text-emerald-100 font-semibold text-sm">
              {domains.length} domain{domains.length !== 1 ? "s" : ""} found
            </span>
          </div>
          {domains.map((d) => (
            <div key={d.tokenId.toString()} className="flex items-center justify-between bg-black/20 rounded-md px-3 py-2">
              <span className="text-white font-medium text-sm">{displayDomainName(d.name)}</span>
              <span className="text-white/30 text-xs">#{d.tokenId.toString().slice(0, 8)}…</span>
            </div>
          ))}
        </div>
      )}

      {status === "notfound" && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 flex items-center gap-2 text-white/50 text-sm">
          <XCircle className="h-4 w-4 text-red-400/70 shrink-0" />
          <span>No .lendora domains found for this address.</span>
        </div>
      )}
    </div>
  );
}

// ── Registry directory ───────────────────────────────────────────────────────
function Registry() {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const scan = useCallback(async () => {
    if (!publicClient) return;
    setLoading(true);
    try {
      const entries = await fetchRegistryDomains(publicClient);
      setDomains(entries);
    } catch {
      setDomains([]);
    } finally {
      setLoading(false);
    }
  }, [publicClient]);

  useEffect(() => {
    scan();
  }, [scan]);

  const filtered = search.trim()
    ? domains.filter(
        (d) =>
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.owner.toLowerCase().includes(search.toLowerCase())
      )
    : domains;

  return (
    <div className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/40">
          All registered <span className="text-blue-300 font-medium">.lendora</span> domains on-chain.
        </p>
        {!loading && (
          <span className="text-xs text-white/30">
            {filtered.length}
            {search ? ` / ${domains.length}` : ""} registered
          </span>
        )}
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/25 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or address…"
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg py-2.5 pl-9 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 transition-all text-xs"
          />
        </div>
        {search && (
          <button
            onClick={() => setSearch("")}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 text-white/40 hover:text-white/70 text-xs transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-white/30 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scanning event logs…
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-white/30 text-center py-8">
          {search ? "No domains match your search." : "No domains registered yet."}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-white/[0.05]">
          {filtered.map((d) => (
            <div key={d.tokenId.toString()} className="flex items-center justify-between py-3 group">
              <div className="flex items-center gap-3">
                <span className="text-white font-medium text-sm">{displayDomainName(d.name)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white/40 font-mono text-xs hidden sm:block">
                  {shortenAddress(d.owner)}
                </span>
                <CopyButton text={d.owner} />
                <a
                  href={`${ARC_EXPLORER}/address/${d.owner}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/20 hover:text-white/60 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function fetchMarketplaceListings(
  publicClient: ReturnType<typeof usePublicClient>
): Promise<DomainListing[]> {
  if (!publicClient || !DOMAIN_MARKETPLACE_ADDRESS) return [];

  const CACHE_KEY = `arclend:domain-marketplace:cache:${DOMAIN_MARKETPLACE_ADDRESS?.toLowerCase() ?? "none"}`;
  type MarketplaceLog = {
    args: {
      tokenId?: bigint;
      seller?: string;
      price?: bigint;
    };
    blockNumber: bigint;
    logIndex: number;
  };
  type ActiveListing = {
    tokenId: bigint;
    seller: string;
    price: bigint;
  };
  type MarketplaceEvent = {
    type: "listed" | "cancelled" | "purchased";
    tokenId?: bigint;
    seller?: string;
    price?: bigint;
    blockNumber: bigint;
    logIndex: number;
  };

  const listedEvent = parseAbiItem(
    "event DomainListed(uint256 indexed tokenId, address indexed seller, uint256 price)"
  );
  const cancelledEvent = parseAbiItem(
    "event DomainListingCancelled(uint256 indexed tokenId, address indexed seller)"
  );
  const purchasedEvent = parseAbiItem(
    "event DomainPurchased(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)"
  );
  const latestBlock = await publicClient.getBlockNumber();
  const active = new Map<string, ActiveListing>();
  let lastScannedBlock = DOMAIN_MARKETPLACE_DEPLOYMENT_BLOCK - 1n;

  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        lastBlock?: string;
        active?: Array<{ tokenId: string; seller: string; price: string }>;
      };
      if (parsed.lastBlock) {
        lastScannedBlock = BigInt(parsed.lastBlock);
      }
      for (const listing of parsed.active ?? []) {
        active.set(listing.tokenId, {
          tokenId: BigInt(listing.tokenId),
          seller: listing.seller,
          price: BigInt(listing.price),
        });
      }
    }
  } catch {
    active.clear();
    lastScannedBlock = DOMAIN_MARKETPLACE_DEPLOYMENT_BLOCK - 1n;
  }

  const fromBlock =
    lastScannedBlock + 1n > DOMAIN_MARKETPLACE_DEPLOYMENT_BLOCK
      ? lastScannedBlock + 1n
      : DOMAIN_MARKETPLACE_DEPLOYMENT_BLOCK;

  if (fromBlock <= latestBlock) {
    const CHUNK = 9_500n;
    const CONCURRENCY = 6;
    const ranges: Array<{ from: bigint; to: bigint }> = [];
    for (let from = fromBlock; from <= latestBlock; from += CHUNK) {
      ranges.push({
        from,
        to: from + CHUNK - 1n > latestBlock ? latestBlock : from + CHUNK - 1n,
      });
    }

    const events: MarketplaceEvent[] = [];
    for (let index = 0; index < ranges.length; index += CONCURRENCY) {
      const batch = ranges.slice(index, index + CONCURRENCY);
      const batchEvents = await Promise.all(
        batch.map(async ({ from, to }) => {
          const [listed, cancelled, purchased] = await Promise.all([
            publicClient.getLogs({
              address: DOMAIN_MARKETPLACE_ADDRESS,
              event: listedEvent,
              fromBlock: from,
              toBlock: to,
            }),
            publicClient.getLogs({
              address: DOMAIN_MARKETPLACE_ADDRESS,
              event: cancelledEvent,
              fromBlock: from,
              toBlock: to,
            }),
            publicClient.getLogs({
              address: DOMAIN_MARKETPLACE_ADDRESS,
              event: purchasedEvent,
              fromBlock: from,
              toBlock: to,
            }),
          ]);

          return [
            ...(listed as MarketplaceLog[]).map((log) => ({
              type: "listed" as const,
              tokenId: log.args.tokenId,
              seller: log.args.seller,
              price: log.args.price,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
            })),
            ...(cancelled as MarketplaceLog[]).map((log) => ({
              type: "cancelled" as const,
              tokenId: log.args.tokenId,
              seller: log.args.seller,
              price: 0n,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
            })),
            ...(purchased as MarketplaceLog[]).map((log) => ({
              type: "purchased" as const,
              tokenId: log.args.tokenId,
              seller: log.args.seller,
              price: log.args.price,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
            })),
          ] satisfies MarketplaceEvent[];
        }),
      );
      events.push(...batchEvents.flat());
    }

    events.sort((a, b) => {
      if (a.blockNumber === b.blockNumber) return a.logIndex - b.logIndex;
      return a.blockNumber < b.blockNumber ? -1 : 1;
    });

    for (const event of events) {
      if (event.tokenId === undefined || !event.seller) continue;
      const key = event.tokenId.toString();
      if (event.type === "listed" && event.price !== undefined) {
        active.set(key, {
          tokenId: event.tokenId,
          seller: event.seller,
          price: event.price,
        });
      } else {
        active.delete(key);
      }
    }

    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          lastBlock: latestBlock.toString(),
          active: Array.from(active.values()).map((listing) => ({
            tokenId: listing.tokenId.toString(),
            seller: listing.seller,
            price: listing.price.toString(),
          })),
        }),
      );
    } catch {
      // Cache is an optimization only.
    }
  }

  const hydrated = await Promise.all(
    Array.from(active.values()).map(async (listing) => {
      const entry = await fetchDomainEntry(publicClient, listing.tokenId).catch(() => null);
      if (!entry) return null;
      if (entry.owner.toLowerCase() !== listing.seller.toLowerCase()) return null;
      return {
        ...entry,
        seller: listing.seller,
        price: listing.price,
      };
    })
  );

  return hydrated.filter((listing): listing is DomainListing => Boolean(listing));
}

function DomainMarketplace() {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { address, isConnected } = useArcLendAccount();
  const contractWrite = useArcLendContractWrite();
  const writeContractAsync = async (request: ArcLendContractWriteRequest) =>
    resultHash(await contractWrite.writeContractAsync(request));
  const [owned, setOwned] = useState<DomainEntry[]>([]);
  const [listings, setListings] = useState<DomainListing[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [purchaseReceipt, setPurchaseReceipt] =
    useState<MarketplacePurchaseReceipt | null>(null);

  const refresh = useCallback(async () => {
    if (!publicClient) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [marketListings, ownedDomains] = await Promise.all([
        fetchMarketplaceListings(publicClient),
        address ? fetchOwnedDomains(publicClient, address) : Promise.resolve([]),
      ]);
      setListings(marketListings);
      setOwned(ownedDomains);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Could not load marketplace listings.",
      );
    } finally {
      setLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    window.addEventListener("arclend:domain-marketplace-updated", refresh);
    return () =>
      window.removeEventListener(
        "arclend:domain-marketplace-updated",
        refresh,
      );
  }, [refresh]);

  if (!DOMAIN_MARKETPLACE_ADDRESS) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-xs text-white/40">
          The domain marketplace contract has not been deployed yet.
        </p>
        <div className="rounded-lg border border-amber-200/15 bg-amber-200/[0.06] p-4 text-sm leading-6 text-amber-100/70">
          Deploy `DomainMarketplace`, then add its address to the deployment file to enable listing
          and buying domains with USDC.
        </div>
      </div>
    );
  }

  const listedTokenIds = new Set(listings.map((listing) => listing.tokenId.toString()));
  const sellable = owned.filter((domain) => !listedTokenIds.has(domain.tokenId.toString()));

  const handleList = async (domain: DomainEntry) => {
    if (!publicClient || !address) return;
    const tokenKey = domain.tokenId.toString();
    const price = prices[tokenKey]?.trim();
    if (!price) return;
    setPendingToken(tokenKey);
    setMessage(`Approving ${displayDomainName(domain.name)} for marketplace listing...`);
    try {
      const parsedPrice = parseUnits(price, 6);
      const approveHash = await writeContractAsync({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "approve",
        args: [DOMAIN_MARKETPLACE_ADDRESS, domain.tokenId],
      });
      if (approveHash) await publicClient.waitForTransactionReceipt({ hash: approveHash });
      setMessage(`Listing ${displayDomainName(domain.name)} for ${price} USDC...`);
      const listHash = await writeContractAsync({
        address: DOMAIN_MARKETPLACE_ADDRESS,
        abi: marketplaceAbi,
        functionName: "list",
        args: [domain.tokenId, parsedPrice],
      });
      if (listHash) await publicClient.waitForTransactionReceipt({ hash: listHash });
      setPrices((current) => ({ ...current, [tokenKey]: "" }));
      setMessage(`${displayDomainName(domain.name)} listed for ${price} USDC.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Listing failed.");
    } finally {
      setPendingToken(null);
    }
  };

  const handleCancel = async (listing: DomainListing) => {
    if (!publicClient) return;
    const tokenKey = listing.tokenId.toString();
    setPendingToken(tokenKey);
    setMessage(`Cancelling ${displayDomainName(listing.name)} listing...`);
    try {
      const hash = await writeContractAsync({
        address: DOMAIN_MARKETPLACE_ADDRESS,
        abi: marketplaceAbi,
        functionName: "cancelListing",
        args: [listing.tokenId],
      });
      if (hash) await publicClient.waitForTransactionReceipt({ hash });
      setMessage(`${displayDomainName(listing.name)} listing cancelled.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancel failed.");
    } finally {
      setPendingToken(null);
    }
  };

  const handleBuy = async (listing: DomainListing) => {
    if (!publicClient || !address) return;
    const tokenKey = listing.tokenId.toString();
    const displayName = displayDomainName(listing.name);
    const price = formatUnits(listing.price, 6);
    setPendingToken(tokenKey);
    setMessage(`Approving ${price} USDC purchase...`);
    try {
      const approveHash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [DOMAIN_MARKETPLACE_ADDRESS, listing.price],
      });
      if (approveHash) await publicClient.waitForTransactionReceipt({ hash: approveHash });
      setMessage(`Buying ${displayDomainName(listing.name)}...`);
      const buyHash = await writeContractAsync({
        address: DOMAIN_MARKETPLACE_ADDRESS,
        abi: marketplaceAbi,
        functionName: "buy",
        args: [listing.tokenId, listing.price],
      });
      if (buyHash) await publicClient.waitForTransactionReceipt({ hash: buyHash });
      setPurchaseReceipt({
        domainName: displayName,
        buyer: address,
        seller: listing.seller,
        price,
        hash: buyHash,
      });
      setMessage(`${displayName} purchased.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Purchase failed.");
    } finally {
      setPendingToken(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {purchaseReceipt ? (
        <MarketplacePurchaseReceiptModal
          receipt={purchaseReceipt}
          onClose={() => setPurchaseReceipt(null)}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-white/40">
          List owned domains for USDC or buy domains listed by other users.
        </p>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/50 transition-colors hover:text-white disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {message ? (
        <div className="rounded-lg border border-blue-300/15 bg-blue-300/[0.06] p-3 text-xs leading-5 text-blue-100/75">
          {message}
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-lg border border-red-300/15 bg-red-300/[0.06] p-3 text-xs leading-5 text-red-100/75">
          {loadError}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-white">List your domains</h3>
        {!isConnected ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
            Connect your wallet to list domains you own.
          </p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-white/35">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading your domains...
          </div>
        ) : sellable.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
            You have no unlisted domains available to sell.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
            {sellable.map((domain) => {
              const tokenKey = domain.tokenId.toString();
              const pending = pendingToken === tokenKey;
              return (
                <div key={tokenKey} className="grid gap-3 p-3 sm:grid-cols-[1fr_130px_80px] sm:items-center">
                  <span className="text-sm font-medium text-white">{displayDomainName(domain.name)}</span>
                  <input
                    value={prices[tokenKey] ?? ""}
                    onChange={(event) =>
                      setPrices((current) => ({
                        ...current,
                        [tokenKey]: event.target.value,
                      }))
                    }
                    inputMode="decimal"
                    placeholder="Price USDC"
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-blue-500/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleList(domain)}
                    disabled={pending || !prices[tokenKey]?.trim()}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "List"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Marketplace</h3>
          <span className="text-xs text-white/30">{listings.length} listed</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-white/35">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading listings...
          </div>
        ) : listings.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
            No domains are listed for sale yet.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
            {listings.map((listing) => {
              const tokenKey = listing.tokenId.toString();
              const isSeller =
                address?.toLowerCase() === listing.seller.toLowerCase();
              const pending = pendingToken === tokenKey;
              return (
                <div key={tokenKey} className="grid gap-3 p-3 sm:grid-cols-[1fr_90px_90px] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {displayDomainName(listing.name)}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-white/30">
                      Seller {shortenAddress(listing.seller)}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-emerald-200">
                    {formatUnits(listing.price, 6)} USDC
                  </span>
                  {isSeller ? (
                    <button
                      type="button"
                      onClick={() => handleCancel(listing)}
                      disabled={pending}
                      className="rounded-lg border border-red-300/20 bg-red-300/[0.07] px-3 py-2 text-xs font-semibold text-red-200 transition-colors hover:bg-red-300/[0.12] disabled:opacity-40"
                    >
                      {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Cancel"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleBuy(listing)}
                      disabled={!isConnected || pending}
                      className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {pending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Buy"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Mint domain ──────────────────────────────────────────────────────────────
function describeMintError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("rejected the request")) {
    return "Transaction rejected.";
  }
  if (lower.includes("commitmenttoonew") || lower.includes("too new")) {
    return "The registry needs one confirmed block after commit. Wait a moment and try again.";
  }
  if (lower.includes("invalidcommitment") || lower.includes("commitmentexpired")) {
    return "The mint commit did not confirm in time. Try again.";
  }
  if (lower.includes("already") || lower.includes("erc721invalidsender")) {
    return "Domain already registered. Try another name.";
  }
  if (lower.includes("insufficient") || lower.includes("exceeds the balance")) {
    return "Mint failed — not enough USDC for gas.";
  }
  return "Mint failed — check your USDC balance for gas or try again.";
}

async function waitForBlock(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  blockNumber: bigint,
) {
  while ((await publicClient.getBlockNumber()) < blockNumber) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
}

function MintDomain({ onMinted }: { onMinted?: () => void }) {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { address, isConnected } = useArcLendAccount();
  const [input, setInput] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [mintedName, setMintedName] = useState("");
  const [settingPrimary, setSettingPrimary] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const {
    txHash: hash,
    writeContractAsync,
    isPending,
    error: writeError,
    reset,
  } = useArcLendContractWrite();

  // Debounced availability check using resolveDomain
  useEffect(() => {
    const name = normalizeDomainInput(input);
    if (!name || !publicClient) {
      setAvailable(null);
      return;
    }
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const owner = (await publicClient.readContract({
          address: WALLET_DOMAIN_ADDRESS,
          abi,
          functionName: "resolveDomain",
          args: [name],
        })) as string;
        // If owner is zero address, domain is available
        setAvailable(owner === "0x0000000000000000000000000000000000000000");
      } catch {
        // readContract throws when token doesn't exist → domain is available
        setAvailable(true);
      } finally {
        setChecking(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [input, publicClient]);

  const handleMint = async () => {
    if (!address || !input.trim() || !available || !publicClient) return;
    const name = normalizeDomainInput(input);
    setMintedName(name);
    setMintError(null);
    setIsWorking(true);
    try {
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secret = toHex(secretBytes, { size: 32 });
      const commitment = await publicClient.readContract({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "makeCommitment",
        args: [name, address, secret],
      });
      const commitResult = await writeContractAsync({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "commitDomain",
        args: [commitment],
      });
      const commitHash = resultHash(commitResult);
      if (!commitHash) {
        throw new Error("Commit/reveal domain minting currently requires a browser wallet.");
      }
      const commitReceipt = await publicClient.waitForTransactionReceipt({
        hash: commitHash,
      });
      await waitForBlock(publicClient, commitReceipt.blockNumber + 1n);
      const revealResult = await writeContractAsync({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "mintDomain",
        args: [name, secret],
      });
      const revealHash = resultHash(revealResult);
      if (revealHash) {
        await publicClient.waitForTransactionReceipt({ hash: revealHash });
      }
      setShowModal(true);
    } catch (error) {
      setMintError(describeMintError(error));
    } finally {
      setIsWorking(false);
    }
  };

  const handleSetPrimary = async () => {
    if (!address || !mintedName || !publicClient || settingPrimary) return;
    setSettingPrimary(true);

    try {
      const result = await writeContractAsync({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "setPrimaryDomain",
        args: [mintedName],
      });
      const primaryHash = resultHash(result);
      if (primaryHash) {
        await publicClient.waitForTransactionReceipt({ hash: primaryHash });
      }
      await waitForPrimaryDomain(publicClient, address, mintedName);

      const displayName = displayDomainName(mintedName);
      localStorage.setItem(primaryKey(address), displayName);
      announcePrimaryDomainChanged(address, displayName);
      showToast("success", `${displayName} is now your primary domain.`);
      handleRegisterAnother();
    } catch (error) {
      const rejected =
        error instanceof Error && error.message.toLowerCase().includes("rejected");
      showToast(
        "error",
        rejected
          ? "Primary-domain transaction rejected."
          : "Could not set the primary domain. Confirm ownership and try again.",
      );
    } finally {
      setSettingPrimary(false);
    }
  };

  const handleRegisterAnother = () => {
    reset();
    setInput("");
    setAvailable(null);
    setShowModal(false);
    onMinted?.();
  };

  const isMinting = isPending || isWorking;
  const name = normalizeDomainInput(input);

  return (
    <>
      {/* Success popup */}
        {showModal && address && (
        <MintSuccessModal
          name={mintedName}
          wallet={address}
          hash={hash}
          onClose={handleRegisterAnother}
          onSetPrimary={handleSetPrimary}
          settingPrimary={settingPrimary}
        />
      )}

      <div className="flex flex-col gap-5">
        <p className="text-xs text-white/40">
          Register a <span className="text-blue-300 font-medium">.lendora</span> domain on Arc Testnet.
          <span className="ml-1 text-white/30">
            Gas is paid in <span className="text-white/60 font-medium">USDC</span>.
          </span>
        </p>

        {/* Input */}
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(normalizeDomainInput(e.target.value).replace(/[^a-z0-9-]/g, ""));
              reset();
              setMintError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleMint()}
            placeholder="yourname"
            disabled={isMinting}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg py-3 pl-4 pr-28 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 transition-all text-sm disabled:opacity-50"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 text-sm font-medium">
            .lendora
          </span>

        </div>
        <div className="min-h-5 text-xs">
          {name.length > 0 && checking ? (
            <span className="flex items-center gap-1 text-white/30">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking…
            </span>
          ) : name.length > 0 && available === true ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <Check className="h-3 w-3" /> Available
            </span>
          ) : name.length > 0 && available === false ? (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3" /> Already taken
            </span>
          ) : null}
        </div>

        {/* Mint button */}
        {!isConnected ? (
          <button
            disabled
            className="w-full rounded-lg bg-white/5 py-3 text-sm font-medium text-white/30 cursor-not-allowed"
          >
            Connect Wallet to Mint
          </button>
        ) : (
          <button
            onClick={handleMint}
            disabled={!name || !available || isMinting || checking}
            className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.25)]"
          >
            {isMinting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Minting…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Mint {name ? displayDomainName(name) : "Domain"}
              </>
            )}
          </button>
        )}

        {/* Error */}
        {(mintError || writeError) && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] p-3 text-xs text-red-200">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{mintError ?? describeMintError(writeError)}</span>
          </div>
        )}
      </div>
    </>
  );
}

// ── My Domains ───────────────────────────────────────────────────────────────
function MyDomains({ refreshKey }: { refreshKey: number }) {
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { address, isConnected } = useArcLendAccount();
  const { writeContractAsync } = useArcLendContractWrite();
  const [owned, setOwned] = useState<DomainEntry[]>([]);
  const [currentPrimary, setCurrentPrimary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [burningName, setBurningName] = useState<string | null>(null);
  const [settingPrimaryName, setSettingPrimaryName] = useState<string | null>(null);

  // Load primary from localStorage
  const loadPrimary = useCallback(async () => {
    if (!address) return;
    try {
      const primary = (await publicClient?.readContract({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "primaryDomainOf",
        args: [address],
      })) as string | undefined;

      if (primary) {
        const displayName = displayDomainName(primary);
        setCurrentPrimary(displayName);
        localStorage.setItem(primaryKey(address), displayName);
        return;
      }
      setCurrentPrimary(null);
      localStorage.removeItem(primaryKey(address));
      return;
    } catch {
      // Older WalletDomain deployments only support local primary-domain state.
    }

    const storedPrimary = localStorage.getItem(primaryKey(address));
    setCurrentPrimary(storedPrimary ? displayDomainName(storedPrimary) : null);
  }, [address, publicClient]);

  const fetchOwned = useCallback(async () => {
    if (!publicClient || !address) return;
    setLoading(true);
    try {
      const mine = await fetchOwnedDomains(publicClient, address);
      setOwned(mine);
    } catch {
      setOwned([]);
    } finally {
      setLoading(false);
    }
  }, [publicClient, address]);

  useEffect(() => {
    loadPrimary();
    fetchOwned();
  }, [loadPrimary, fetchOwned, refreshKey]);



  const handleSetPrimary = async (name: string) => {
    if (!address || !publicClient || settingPrimaryName) return;
    const normalizedName = normalizeDomainInput(name);
    setSettingPrimaryName(normalizedName);

    try {
      const result = await writeContractAsync({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "setPrimaryDomain",
        args: [normalizedName],
      });
      const hash = resultHash(result);
      if (hash) await publicClient.waitForTransactionReceipt({ hash });
      await waitForPrimaryDomain(publicClient, address, normalizedName);

      const displayName = displayDomainName(normalizedName);
      localStorage.setItem(primaryKey(address), displayName);
      setCurrentPrimary(displayName);
      announcePrimaryDomainChanged(address, displayName);
      showToast("success", `${displayName} is now your primary domain.`);
    } catch (error) {
      const rejected =
        error instanceof Error && error.message.toLowerCase().includes("rejected");
      showToast(
        "error",
        rejected
          ? "Primary-domain transaction rejected."
          : "Could not set the primary domain. Confirm ownership and try again.",
      );
    } finally {
      setSettingPrimaryName(null);
    }
  };

  const handleBurnDomain = async (name: string) => {
    if (!address || !publicClient) return;
    const normalized = normalizeDomainInput(name);
    const displayName = displayDomainName(normalized);
    const confirmed = window.confirm(
      `Burn ${displayName}? This permanently destroys the domain NFT and frees the name for minting again.`,
    );
    if (!confirmed) return;

    setBurningName(normalized);
    try {
      const result = await writeContractAsync({
        address: WALLET_DOMAIN_ADDRESS,
        abi,
        functionName: "burnDomain",
        args: [normalized],
      });
      const hash = resultHash(result);
      if (hash) await publicClient.waitForTransactionReceipt({ hash });
      if (currentPrimary === displayName) {
        localStorage.removeItem(primaryKey(address));
        setCurrentPrimary(null);
      }
      await Promise.all([fetchOwned(), loadPrimary()]);
    } finally {
      setBurningName(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <User className="h-8 w-8 text-white/20" />
        <p className="text-white/40 text-sm">Connect your wallet to view your domains.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-white/30 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Scanning event logs for your domains…
      </div>
    );
  }

  if (owned.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Globe className="h-8 w-8 text-white/20" />
        <p className="text-white/40 text-sm">You don&apos;t own any .lendora domains yet.</p>
        <p className="text-xs text-white/25">Head to the Mint Domain tab to register one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/40">
          Your <span className="text-blue-300 font-medium">.lendora</span> domains.
        </p>
        <span className="text-xs text-white/30">{owned.length} owned</span>
      </div>

      {/* Current primary */}
      {currentPrimary && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/[0.07] px-3 py-2.5">
          <Star className="h-3.5 w-3.5 text-blue-300 fill-blue-300/40 shrink-0" />
          <div>
            <p className="text-xs text-white/40 leading-none mb-0.5">Primary domain</p>
            <p className="text-white font-medium text-sm">{currentPrimary}</p>
          </div>
        </div>
      )}

      {/* Domain list */}
      <div className="flex flex-col divide-y divide-white/[0.05]">
        {owned.map((d) => {
          const fullName = displayDomainName(d.name);
          const isPrimary = currentPrimary === fullName;
          return (
            <div key={d.tokenId.toString()} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-2">
                {isPrimary && (
                  <Star className="h-3 w-3 text-blue-300 fill-blue-300/60 shrink-0" />
                )}
                <span className="text-white font-medium text-sm">{fullName}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isPrimary ? (
                  <span className="text-xs text-blue-300/60 font-medium">Primary</span>
                ) : (
                  <button
                    onClick={() => handleSetPrimary(normalizeDomainInput(d.name))}
                    disabled={Boolean(settingPrimaryName)}
                    className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] hover:bg-white/10 hover:border-blue-500/30 hover:text-blue-300 px-3 py-1.5 text-xs text-white/50 transition-all disabled:cursor-wait disabled:opacity-45"
                  >
                    {settingPrimaryName === normalizeDomainInput(d.name) ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Star className="h-3 w-3" />
                    )}
                    {settingPrimaryName === normalizeDomainInput(d.name)
                      ? "Setting…"
                      : "Set as Primary"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleBurnDomain(d.name)}
                  disabled={burningName === normalizeDomainInput(d.name)}
                  className="flex items-center gap-1.5 rounded-md border border-red-300/15 bg-red-300/[0.06] px-3 py-1.5 text-xs text-red-200/70 transition-all hover:bg-red-300/[0.1] hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {burningName === normalizeDomainInput(d.name) ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Burn
                </button>
              </div>
            </div>
          );
        })}
      </div>


    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────
type Tab = "forward" | "reverse" | "registry" | "mint" | "mydomains" | "marketplace";

export function DomainMinting() {
  const [tab, setTab] = useState<Tab>("mint");
  const [refreshKey, setRefreshKey] = useState(0);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "mint", label: "Mint", icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: "mydomains", label: "My Domains", icon: <User className="h-3.5 w-3.5" /> },
    { id: "marketplace", label: "Market", icon: <ShoppingCart className="h-3.5 w-3.5" /> },
    { id: "forward", label: "Resolve", icon: <Search className="h-3.5 w-3.5" /> },
    { id: "reverse", label: "By Wallet", icon: <ArrowLeftRight className="h-3.5 w-3.5" /> },
    { id: "registry", label: "Registry", icon: <BookOpen className="h-3.5 w-3.5" /> },
  ];

  const handleMinted = () => {
    setRefreshKey((k) => k + 1);
    setTab("mydomains");
  };

  return (
    <div className="mx-auto w-full max-w-xl flex flex-col gap-0 rounded-xl border border-white/10 bg-[#0a0c0e]/80 shadow-2xl backdrop-blur-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pt-6 pb-5 border-b border-white/[0.06]">
        <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-2.5">
          <Globe className="h-5 w-5 text-blue-300" />
        </div>
        <div>
          <h2 className="text-white font-semibold text-base leading-tight">Lendora Domain Names</h2>
          <p className="text-xs text-white/40 mt-0.5">WalletDomain · Arc Testnet</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="text-white/20 hover:text-white/50 transition-colors"
            title="Refresh"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          <a
            href={`${ARC_EXPLORER}/address/${WALLET_DOMAIN_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/20 hover:text-white/50 transition-colors"
            title="View contract"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 border-b border-white/[0.06] sm:grid-cols-3 lg:grid-cols-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex min-w-0 items-center justify-center gap-1.5 border-b-2 px-2 py-3 text-xs font-medium transition-all ${
              tab === t.id
                ? "border-blue-500 text-blue-300 bg-blue-500/[0.05]"
                : "border-transparent text-white/40 hover:text-white/60 hover:bg-white/[0.02]"
            }`}
          >
            <span className="shrink-0">{t.icon}</span>
            <span className="truncate">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="p-6 pb-8">
        {tab === "forward" && <ForwardLookup />}
        {tab === "reverse" && <ReverseLookup />}
        {tab === "registry" && <Registry key={refreshKey} />}
        {tab === "mint" && <MintDomain onMinted={handleMinted} />}
        {tab === "mydomains" && <MyDomains refreshKey={refreshKey} />}
        {tab === "marketplace" && <DomainMarketplace />}
      </div>
    </div>
  );
}
