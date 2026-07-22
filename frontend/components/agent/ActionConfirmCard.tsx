"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  Coins,
  Loader2,
  RefreshCw,
  RotateCcw,
  SendHorizontal,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import {
  erc20Abi,
  formatUnits,
  parseAbi,
  parseUnits,
  toFunctionSelector,
  toHex,
  type Address,
  type Hash,
} from "viem";
import {
  useChainId,
  usePublicClient,
  useSwitchChain,
} from "wagmi";
import { GlassButton } from "@/components/ui/GlassButton";
import { GlassCard } from "@/components/ui/GlassCard";
import {
  AgentTransactionFlow,
} from "@/components/agent/AgentTransactionFlow";
import { useBridge, type BridgeNetwork } from "@/hooks/useAppKit";
import {
  useBorrowAction,
  useRepayAction,
  useWithdrawAction,
} from "@/hooks/useLendingPool";
import {
  POSITION_MANAGER_ADDRESS,
  useBorrowWithReceipt,
  useSupplyWithReceipt,
} from "@/hooks/usePositionManager";
import {
  useSwap,
  type SwapRouteQuote,
  type SwapToken,
} from "@/hooks/useSwap";
import { ARC_DEX_TOKENS } from "@/lib/arcDex";
import type {
  AgentAction,
  AgentTransactionReceipt,
  AgentTransactionReview,
  AgentValidationResult,
  LendingAsset,
  ValidatedAgentAction,
} from "@/lib/agentTypes";
import { marketDefinitions } from "@/lib/markets";
import { useArcLendAccount } from "@/hooks/useArcLendAccount";
import {
  resultHash,
  useArcLendContractWrite,
  type ArcLendContractWriteRequest,
} from "@/hooks/useArcLendContractWrite";
import deployments from "@/constants/deployments.json";
import {
  ARCANA_MARKETS_ADDRESS,
  ARC_USDC_ADDRESS,
  arcanaMarketsAbi,
} from "@/constants/arcana";

type ActionConfirmCardProps = {
  validatedAction: ValidatedAgentAction;
  onCancel: () => void;
  onComplete: (receipt: AgentTransactionReceipt) => void;
  onBlocked: (reason: string) => void;
};

const sourceNetworks: Array<
  BridgeNetwork & { aliases: string[] }
> = [
  {
    chain: "Ethereum_Sepolia",
    chainId: 11155111,
    label: "Ethereum Sepolia",
    aliases: ["ethereum", "ethereum sepolia", "sepolia"],
  },
  {
    chain: "Base_Sepolia",
    chainId: 84532,
    label: "Base Sepolia",
    aliases: ["base", "base sepolia"],
  },
  {
    chain: "Polygon_Amoy_Testnet",
    chainId: 80002,
    label: "Polygon Amoy",
    aliases: ["polygon", "polygon amoy", "amoy"],
  },
];

const arcDestination: BridgeNetwork = {
  chain: "Arc_Testnet",
  chainId: 5042002,
  label: "Arc Testnet",
};

const swapRouteLabels: Record<SwapRouteQuote["key"], string> = {
  curve: "Curve stable pool",
  xylo: "Xylo V2 router",
  v3: "Synthra V3 router",
};
const WALLET_DOMAIN_ADDRESS = deployments.WalletDomain as Address;
const MARKET_USDC_ADDRESS = deployments.markets.USDC.asset as Address;
const DOMAIN_MARKETPLACE_ADDRESS = (
  deployments as typeof deployments & { DomainMarketplace?: Address }
).DomainMarketplace;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const walletDomainAbi = parseAbi([
  "function approve(address to,uint256 tokenId) external",
  "function makeCommitment(string domainName,address owner,bytes32 secret) view returns (bytes32)",
  "function commitDomain(bytes32 commitment) external",
  "function mintDomain(string domainName,bytes32 secret) external returns (uint256)",
  "function burnDomain(string domainName) external",
]);
const domainMarketplaceAbi = parseAbi([
  "function list(uint256 tokenId,uint256 price) external",
  "function cancelListing(uint256 tokenId) external",
  "function buy(uint256 tokenId,uint256 maxPrice) external",
  "function listings(uint256 tokenId) view returns (address seller,uint256 price)",
]);
const borrowDelegationAbi = parseAbi([
  "function borrowDelegates(address user,address delegate) view returns (bool)",
  "function setBorrowDelegate(address delegate,bool approved) external",
]);
const borrowDelegatesSelector = toFunctionSelector(
  "borrowDelegates(address,address)",
);

function paramsRecord(action: AgentAction) {
  return action.params as Record<string, unknown>;
}

function actionIcon(tool: AgentAction["tool"]) {
  if (tool === "supply") return ArrowUpCircle;
  if (tool === "borrow" || tool === "withdraw") return ArrowDownCircle;
  if (tool === "claimYield") return Coins;
  if (tool === "repay") return RotateCcw;
  if (tool === "bridge") return ArrowLeftRight;
  if (tool === "sendToken") return SendHorizontal;
  if (tool === "predict") return Sparkles;
  if (tool === "mintDomain") return Sparkles;
  if (tool === "burnDomain") return RefreshCw;
  if (tool === "listDomain" || tool === "delistDomain" || tool === "buyDomain") return ShoppingCart;
  return RefreshCw;
}

function sourceFor(value: string) {
  const normalized = value.trim().toLowerCase();
  return sourceNetworks.find((network) =>
    network.aliases.some(
      (alias) => normalized === alias || normalized.includes(alias),
    ),
  );
}

function claimListFromParams(params: Record<string, unknown>) {
  const claims = Array.isArray(params.claims) ? params.claims : [];
  return claims
    .map((claim) => {
      if (!claim || typeof claim !== "object") {
        return null;
      }
      const item = claim as Record<string, unknown>;
      if (
        (item.asset !== "USDC" && item.asset !== "EURC") ||
        typeof item.amount !== "string"
      ) {
        return null;
      }
      return {
        asset: item.asset,
        amount: item.amount,
      };
    })
    .filter(
      (claim): claim is { asset: LendingAsset; amount: string } =>
        claim !== null,
    );
}

export function ActionConfirmCard({
  validatedAction,
  onCancel,
  onComplete,
  onBlocked,
}: ActionConfirmCardProps) {
  const action = validatedAction.action;
  const { address, source } = useArcLendAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: 5042002 });
  const { switchChainAsync } = useSwitchChain();
  const contractWrite = useArcLendContractWrite();
  const supplyAction = useSupplyWithReceipt();
  const withdrawAction = useWithdrawAction();
  const borrowWithReceiptAction = useBorrowWithReceipt();
  const directBorrowAction = useBorrowAction();
  const repayAction = useRepayAction();
  const swapAction = useSwap();
  const bridgeAction = useBridge();
  const [isPreparing, setIsPreparing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [review, setReview] = useState<AgentTransactionReview | null>(
    null,
  );
  const [receipt, setReceipt] =
    useState<AgentTransactionReceipt | null>(null);
  const [swapQuote, setSwapQuote] = useState<SwapRouteQuote | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const params = paramsRecord(action);
  const Icon = actionIcon(action.tool);

  const submitContract = async (request: ArcLendContractWriteRequest) =>
    resultHash(await contractWrite.writeContractAsync(request));

  const waitForSubmitted = async (hash?: Hash) => {
    if (hash && publicClient) {
      await publicClient.waitForTransactionReceipt({ hash });
    }
  };

  useEffect(() => {
    setIsPreparing(false);
    setIsExecuting(false);
    setReview(null);
    setReceipt(null);
    setSwapQuote(null);
    setError(null);
  }, [action]);

  const displayParams = useMemo(
    () =>
      Object.entries(params).filter(
        ([, value]) =>
          typeof value === "string" || typeof value === "number",
      ),
    [params],
  );

  const ensureAllowance = async (
    asset: Address,
    amount: bigint,
    spender: Address,
  ) => {
    if (!address || !publicClient) {
      throw new Error("Connect your wallet first");
    }
    const allowance = await publicClient.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, spender],
    });
    if (allowance < amount) {
      const approvalHash = await submitContract({
        chainId: 5042002,
        address: asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      });
      await waitForSubmitted(approvalHash);

      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        try {
          const confirmedAllowance = await publicClient.readContract({
            address: asset,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, spender],
          });
          if (confirmedAllowance >= amount) return;
        } catch {
          // The next poll can recover from a temporary RPC read failure.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }

      throw new Error(
        "USDC approval was submitted but has not confirmed on-chain yet. Please try again.",
      );
    }
  };

  const validateLatestState = async () => {
    if (
      !address ||
      address.toLowerCase() !==
        validatedAction.walletAddress.toLowerCase()
    ) {
      onBlocked(
        "I can't verify your position right now. Please reconnect your wallet and try again.",
      );
      return false;
    }
    const validationResponse = await fetch("/api/agent/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, walletAddress: address }),
    });
    const latestValidation =
      (await validationResponse.json()) as AgentValidationResult;
    if (!latestValidation.valid) {
      onBlocked(latestValidation.reason);
      return false;
    }
    if (
      JSON.stringify(latestValidation.action.params) !==
      JSON.stringify(action.params)
    ) {
      onBlocked(
        "The onchain state changed after this review was prepared. Prepare the action again before signing.",
      );
      return false;
    }
    return true;
  };

  const ensureBorrowDelegation = async () => {
    if (!address || !publicClient) {
      throw new Error("Connect your wallet first");
    }
    const lendingPool = deployments.lendingPool as Address;
    const lendingPoolCode = await publicClient.getCode({
      address: lendingPool,
    });
    if (
      !lendingPoolCode
        ?.toLowerCase()
        .includes(borrowDelegatesSelector.slice(2).toLowerCase())
    ) {
      return false;
    }

    const approved = await publicClient.readContract({
      address: lendingPool,
      abi: borrowDelegationAbi,
      functionName: "borrowDelegates",
      args: [address, POSITION_MANAGER_ADDRESS],
    });
    if (approved) return true;

    const delegationHash = await submitContract({
      chainId: 5_042_002,
      address: lendingPool,
      abi: borrowDelegationAbi,
      functionName: "setBorrowDelegate",
      args: [POSITION_MANAGER_ADDRESS, true],
    });
    await waitForSubmitted(delegationHash);

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const confirmed = await publicClient.readContract({
          address: lendingPool,
          abi: borrowDelegationAbi,
          functionName: "borrowDelegates",
          args: [address, POSITION_MANAGER_ADDRESS],
        });
        if (confirmed) return true;
      } catch {
        // The next poll can recover from a temporary RPC read failure.
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }

    throw new Error(
      "Borrow delegation was submitted but has not confirmed on-chain yet. Please try again.",
    );
  };

  const openReview = async () => {
    if (!address || isPreparing) return;
    setIsPreparing(true);
    setError(null);

    try {
      if (
        source === "email" &&
        (action.tool === "swap" || action.tool === "bridge")
      ) {
        throw new Error(
          "Swap and bridge routes require an injected wallet connector. Core ArcLend actions remain available with the email wallet.",
        );
      }
      if (!(await validateLatestState())) return;

      if (action.tool === "swap") {
        const tokenIn = params.tokenIn as SwapToken;
        const tokenOut = params.tokenOut as SwapToken;
        const quote = await swapAction.quoteSwap(
          tokenIn,
          tokenOut,
          String(params.amountIn),
        );
        setSwapQuote(quote);
        setReview({
          eyebrow: "Swap review",
          title: `Swap ${params.amountIn} ${tokenIn}`,
          amountLabel: "You send",
          amount: `${params.amountIn} ${tokenIn}`,
          receiveLabel: "Quoted output",
          receiveAmount: `${formatUnits(
            quote.output,
            ARC_DEX_TOKENS[tokenOut].decimals,
          )} ${tokenOut}`,
          route: [
            `${tokenIn} wallet`,
            swapRouteLabels[quote.key],
            `${tokenOut} wallet`,
          ],
          detail: `The quote uses ${swapRouteLabels[quote.key]} with ${Number(params.slippageBps) / 100}% maximum slippage. Your wallet must approve and sign before funds can move.`,
        });
        return;
      }

      if (action.tool === "bridge") {
        const source = sourceFor(String(params.sourceChain));
        if (!source) throw new Error("Unsupported bridge source chain");
        setReview({
          eyebrow: "Bridge review",
          title: `Bridge ${params.amount} USDC`,
          amountLabel: "Amount bridged",
          amount: `${params.amount} USDC`,
          receiveLabel: "Destination",
          receiveAmount: arcDestination.label,
          route: [
            source.label,
            "CCTP burn",
            "Circle attestation",
            "Arc mint",
          ],
          detail:
            "Circle CCTP burns USDC on the source chain and mints the same asset on Arc Testnet after attestation.",
        });
        return;
      }

      if (action.tool === "sendToken") {
        const asset = params.asset as SwapToken;
        const recipient = String(params.recipient);
        const recipientName = params.recipientName
          ? String(params.recipientName)
          : null;
        setReview({
          eyebrow: "Token transfer review",
          title: `Send ${params.amount} ${asset}`,
          amountLabel: "You send",
          amount: `${params.amount} ${asset}`,
          receiveLabel: "Recipient",
          receiveAmount: recipientName
            ? `${recipientName} — ${recipient}`
            : recipient,
          route: [
            `${asset} wallet`,
            "ERC-20 transfer",
            recipientName ?? recipient,
          ],
          detail:
            "The connected wallet will send this exact token amount directly to the displayed Arc Testnet address. Verify the full address before signing.",
        });
        return;
      }

      if (action.tool === "predict") {
        setReview({
          eyebrow: "Prediction review",
          title: `${params.side} on market #${params.marketId}`,
          amountLabel: "USDC committed",
          amount: `${params.amount} USDC`,
          receiveLabel: "Position",
          receiveAmount: `${params.side} shares`,
          route: [
            "USDC wallet",
            "ArcanaMarkets",
            `${params.side} position`,
          ],
          detail: `${String(params.marketTitle ?? "Arcana prediction market")}. ArcanaMarkets is an external Arc Testnet contract. Shares are issued 1:1 with the USDC amount, and payout depends on the resolved outcome and pool composition.`,
        });
        return;
      }

      if (action.tool === "mintDomain") {
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "domain",
        );
        setReview({
          eyebrow: "Domain mint review",
          title: `Mint ${displayDomain}`,
          amountLabel: "Domain",
          amount: displayDomain,
          receiveLabel: "Recipient wallet",
          receiveAmount: validatedAction.walletAddress,
          route: [
            "ArcLend domain registry",
            displayDomain,
            "Wallet domain NFT",
          ],
          detail:
            "Your wallet will mint this available ArcLend domain NFT to the connected address. The transaction only executes after you sign.",
        });
        return;
      }

      if (action.tool === "burnDomain") {
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "domain",
        );
        setReview({
          eyebrow: "Domain burn review",
          title: `Burn ${displayDomain}`,
          amountLabel: "Domain NFT",
          amount: displayDomain,
          receiveLabel: "Result",
          receiveAmount: "Domain will be removed",
          route: [
            "Wallet domain NFT",
            "ArcLend domain registry",
            "Burned domain",
          ],
          detail:
            "Your wallet will permanently burn this ArcLend domain NFT. The name becomes available again after the transaction confirms.",
        });
        return;
      }

      if (action.tool === "listDomain") {
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "domain",
        );
        setReview({
          eyebrow: "Domain marketplace review",
          title: `List ${displayDomain}`,
          amountLabel: "Listing price",
          amount: `${params.price} USDC`,
          receiveLabel: "Marketplace",
          receiveAmount: "ArcLend domain marketplace",
          route: [
            displayDomain,
            "Marketplace approval",
            "USDC listing",
          ],
          detail:
            "Your wallet will approve the marketplace to transfer this domain NFT, then list it at the exact USDC price. The domain only moves if a buyer purchases it.",
        });
        return;
      }

      if (action.tool === "delistDomain") {
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "domain",
        );
        setReview({
          eyebrow: "Domain marketplace review",
          title: `Delist ${displayDomain}`,
          amountLabel: "Listed domain",
          amount: displayDomain,
          receiveLabel: "Result",
          receiveAmount: "Listing cancelled",
          route: [
            displayDomain,
            "Marketplace listing",
            "Listing removed",
          ],
          detail:
            "Your wallet will cancel this marketplace listing. The domain NFT stays in your wallet and is not burned or transferred.",
        });
        return;
      }

      if (action.tool === "buyDomain") {
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "domain",
        );
        const seller = params.seller ? String(params.seller) : "Seller";
        setReview({
          eyebrow: "Domain marketplace review",
          title: `Buy ${displayDomain}`,
          amountLabel: "Purchase price",
          amount: `${params.price} USDC`,
          receiveLabel: "Domain received",
          receiveAmount: displayDomain,
          route: [
            "USDC wallet",
            "Marketplace purchase",
            displayDomain,
          ],
          detail: `Your wallet will approve the marketplace to spend the exact USDC price, then buy this domain from ${seller}.`,
        });
        return;
      }

      if (action.tool === "claimYield") {
        const claims = claimListFromParams(params);
        if (claims.length === 0) {
          throw new Error("No pending yield claim is available");
        }
        const amount = claims
          .map((claim) => `${claim.amount} ${claim.asset}`)
          .join(" + ");
        setReview({
          eyebrow: "Yield claim review",
          title:
            claims.length === 1
              ? `Claim ${claims[0].asset} yield`
              : "Claim all pending yield",
          amountLabel: "Pending yield",
          amount,
          receiveLabel: "Destination",
          receiveAmount: "Connected wallet",
          route: [
            "aToken supply position",
            "ArcLend pool",
            "Connected wallet",
          ],
          detail:
            "ArcLend withdraws only the validated pending supply interest estimate from your aToken position. Principal remains supplied unless you separately withdraw it.",
        });
        return;
      }

      const asset = String(params.asset);
      const amount = String(params.amount);
      const lendingReview: Record<
        "supply" | "withdraw" | "borrow" | "repay",
        AgentTransactionReview
      > = {
        supply: {
          eyebrow: "Supply review",
          title: `Supply ${amount} ${asset}`,
          amountLabel: "Amount supplied",
          amount: `${amount} ${asset}`,
          receiveLabel: "Position",
          receiveAmount: `Interest-bearing ${asset} + Position NFT`,
          route: [
            `${asset} wallet`,
            "PositionManager",
            "ArcLend pool",
            `${asset} position + NFT`,
          ],
          detail:
            "PositionManager supplies to the unchanged ArcLend pool on your behalf. Your wallet receives the aToken position and an on-chain Position NFT receipt.",
        },
        withdraw: {
          eyebrow: "Withdraw review",
          title: `Withdraw ${amount} ${asset}`,
          amountLabel: "Amount withdrawn",
          amount: `${amount} ${asset}`,
          receiveLabel: "Destination",
          receiveAmount: "Connected wallet",
          route: [`${asset} supply position`, "ArcLend pool", `${asset} wallet`],
          detail:
            "ArcLend redeems part of your supplied position and returns the asset to your wallet.",
        },
        borrow: {
          eyebrow: "Borrow review",
          title: `Borrow ${amount} ${asset}`,
          amountLabel: "Amount borrowed",
          amount: `${amount} ${asset}`,
          receiveLabel: "Destination",
          receiveAmount: `${asset} wallet`,
          route: [
            "Collateral position",
            "ArcLend pool",
            `${asset} wallet`,
          ],
          detail:
            "ArcLend checks your collateral and sends the borrowed asset to your wallet. Deployments with delegation support also mint a Position NFT receipt.",
        },
        repay: {
          eyebrow: "Repay review",
          title: `Repay ${amount} ${asset}`,
          amountLabel: "Amount repaid",
          amount: `${amount} ${asset}`,
          receiveLabel: "Result",
          receiveAmount: "Debt reduced",
          route: [`${asset} wallet`, "ArcLend pool", `${asset} debt position`],
          detail:
            "Your wallet sends the asset to ArcLend and the matching debt position is reduced.",
        },
      };
      if (
        action.tool !== "supply" &&
        action.tool !== "withdraw" &&
        action.tool !== "borrow" &&
        action.tool !== "repay"
      ) {
        throw new Error("This action does not execute a transaction");
      }
      setReview(lendingReview[action.tool]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to prepare transaction review",
      );
    } finally {
      setIsPreparing(false);
    }
  };

  const confirm = async () => {
    if (!address || !review || isExecuting) {
      return;
    }

    setIsExecuting(true);
    setError(null);

    try {
      if (!(await validateLatestState())) return;

      if (action.tool === "bridge") {
        const source = sourceFor(String(params.sourceChain));
        if (!source) {
          throw new Error("Unsupported bridge source chain");
        }
        const submittedAt = performance.now();
        const result = await bridgeAction.bridge({
          source,
          destination: arcDestination,
          amount: String(params.amount),
        });
        const completedStep = result.steps
          .slice()
          .reverse()
          .find((step) => step.txHash);
        if (!completedStep?.txHash) {
          throw new Error("Bridge completed without a transaction hash");
        }
        setReceipt({
          ...review,
          title: `${params.amount} USDC bridged`,
          transactionHash: completedStep.txHash,
          explorerUrl:
            completedStep.explorerUrl ??
            `https://testnet.arcscan.app/tx/${completedStep.txHash}`,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (source === "wallet" && chainId !== 5042002) {
        await switchChainAsync({ chainId: 5042002 });
      }

      if (action.tool === "swap") {
        if (!swapQuote) {
          throw new Error("Refresh the swap quote before confirming");
        }
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        const tokenOut = params.tokenOut as SwapToken;
        const balanceBefore = await publicClient.readContract({
          address: ARC_DEX_TOKENS[tokenOut].address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
        const result = await swapAction.swap(
          params.tokenIn as SwapToken,
          tokenOut,
          String(params.amountIn),
          Number(params.slippageBps),
          swapQuote,
        );
        const balanceAfter = await publicClient.readContract({
          address: ARC_DEX_TOKENS[tokenOut].address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
        const received =
          balanceAfter > balanceBefore
            ? formatUnits(
                balanceAfter - balanceBefore,
                ARC_DEX_TOKENS[tokenOut].decimals,
              )
            : formatUnits(
                result.quote.output,
                ARC_DEX_TOKENS[tokenOut].decimals,
              );
        setReceipt({
          ...review,
          title: `${params.tokenIn} swapped for ${params.tokenOut}`,
          receiveLabel:
            balanceAfter > balanceBefore
              ? "Amount received"
              : "Quoted output",
          receiveAmount: `${received} ${tokenOut}`,
          transactionHash: result.hash,
          explorerUrl: `https://testnet.arcscan.app/tx/${result.hash}`,
          finalityMs: result.finalityMs,
        });
        return;
      }

      if (action.tool === "sendToken") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        const asset = params.asset as SwapToken;
        const token = ARC_DEX_TOKENS[asset];
        const amount = parseUnits(String(params.amount), token.decimals);
        const recipient = String(params.recipient) as Address;
        const submittedAt = performance.now();
        const hash = await submitContract({
          chainId: 5042002,
          address: token.address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [recipient, amount],
        });
        await waitForSubmitted(hash);
        setReceipt({
          ...review,
          title: `${params.amount} ${asset} sent`,
          transactionHash: hash,
          explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (action.tool === "predict") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        const predictionAmount = parseUnits(String(params.amount), 6);
        await ensureAllowance(
          ARC_USDC_ADDRESS,
          predictionAmount,
          ARCANA_MARKETS_ADDRESS,
        );
        const submittedAt = performance.now();
        const hash = await submitContract({
          chainId: 5_042_002,
          address: ARCANA_MARKETS_ADDRESS,
          abi: arcanaMarketsAbi,
          functionName: "buyShares",
          args: [
            BigInt(Number(params.marketId)),
            params.side === "YES",
            predictionAmount,
          ],
        });
        await waitForSubmitted(hash);
        setReceipt({
          ...review,
          title: `${params.side} prediction confirmed`,
          transactionHash: hash,
          explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (action.tool === "mintDomain") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        if (typeof params.domain !== "string") {
          throw new Error("Domain mint is missing a domain name");
        }
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "Domain",
        );
        const submittedAt = performance.now();
        const secretBytes = new Uint8Array(32);
        crypto.getRandomValues(secretBytes);
        const secret = toHex(secretBytes, { size: 32 });
        const commitment = await publicClient.readContract({
          address: WALLET_DOMAIN_ADDRESS,
          abi: walletDomainAbi,
          functionName: "makeCommitment",
          args: [params.domain, address, secret],
        });
        const commitmentHash = await submitContract({
          chainId: 5_042_002,
          address: WALLET_DOMAIN_ADDRESS,
          abi: walletDomainAbi,
          functionName: "commitDomain",
          args: [commitment],
        });
        if (!commitmentHash) {
          throw new Error("Commit/reveal domain minting currently requires a browser wallet.");
        }
        await waitForSubmitted(commitmentHash);
        const hash = await submitContract({
          chainId: 5_042_002,
          address: WALLET_DOMAIN_ADDRESS,
          abi: walletDomainAbi,
          functionName: "mintDomain",
          args: [params.domain, secret],
        });
        await waitForSubmitted(hash);
        setReceipt({
          ...review,
          title: `${displayDomain} minted`,
          transactionHash: hash,
          explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (action.tool === "burnDomain") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        if (typeof params.domain !== "string") {
          throw new Error("Domain burn is missing a domain name");
        }
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "Domain",
        );
        const submittedAt = performance.now();
        const hash = await submitContract({
          chainId: 5_042_002,
          address: WALLET_DOMAIN_ADDRESS,
          abi: walletDomainAbi,
          functionName: "burnDomain",
          args: [params.domain],
        });
        await waitForSubmitted(hash);
        setReceipt({
          ...review,
          title: `${displayDomain} burned`,
          transactionHash: hash,
          explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (action.tool === "listDomain") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        if (!DOMAIN_MARKETPLACE_ADDRESS) {
          throw new Error("Domain marketplace is not deployed");
        }
        if (typeof params.tokenId !== "string") {
          throw new Error("Domain listing is missing token id");
        }
        const tokenId = BigInt(params.tokenId);
        const price = parseUnits(String(params.price), 6);
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "Domain",
        );
        const submittedAt = performance.now();
        const approvalHash = await submitContract({
          chainId: 5_042_002,
          address: WALLET_DOMAIN_ADDRESS,
          abi: walletDomainAbi,
          functionName: "approve",
          args: [DOMAIN_MARKETPLACE_ADDRESS, tokenId],
        });
        await waitForSubmitted(approvalHash);
        const hash = await submitContract({
          chainId: 5_042_002,
          address: DOMAIN_MARKETPLACE_ADDRESS,
          abi: domainMarketplaceAbi,
          functionName: "list",
          args: [tokenId, price],
        });
        await waitForSubmitted(hash);
        const listing = (await publicClient.readContract({
          address: DOMAIN_MARKETPLACE_ADDRESS,
          abi: domainMarketplaceAbi,
          functionName: "listings",
          args: [tokenId],
        })) as readonly [Address, bigint] & {
          seller?: Address;
          price?: bigint;
        };
        const listingSeller = listing.seller ?? listing[0];
        const listingPrice = listing.price ?? listing[1];
        if (
          listingSeller.toLowerCase() !== address.toLowerCase() ||
          listingPrice !== price
        ) {
          throw new Error("Listing transaction confirmed, but marketplace state did not update.");
        }
        window.dispatchEvent(
          new CustomEvent("arclend:domain-marketplace-updated"),
        );
        setReceipt({
          ...review,
          title: `${displayDomain} listed`,
          transactionHash: hash,
          explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (action.tool === "delistDomain") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        if (!DOMAIN_MARKETPLACE_ADDRESS) {
          throw new Error("Domain marketplace is not deployed");
        }
        if (typeof params.tokenId !== "string") {
          throw new Error("Domain delisting is missing token id");
        }
        const tokenId = BigInt(params.tokenId);
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "Domain",
        );
        const submittedAt = performance.now();
        const hash = await submitContract({
          chainId: 5_042_002,
          address: DOMAIN_MARKETPLACE_ADDRESS,
          abi: domainMarketplaceAbi,
          functionName: "cancelListing",
          args: [tokenId],
        });
        await waitForSubmitted(hash);
        const listing = (await publicClient.readContract({
          address: DOMAIN_MARKETPLACE_ADDRESS,
          abi: domainMarketplaceAbi,
          functionName: "listings",
          args: [tokenId],
        })) as readonly [Address, bigint] & {
          seller?: Address;
          price?: bigint;
        };
        const listingSeller = listing.seller ?? listing[0];
        const listingPrice = listing.price ?? listing[1];
        if (
          listingSeller.toLowerCase() !== ZERO_ADDRESS ||
          listingPrice !== 0n
        ) {
          throw new Error("Delist transaction confirmed, but marketplace state did not update.");
        }
        window.dispatchEvent(
          new CustomEvent("arclend:domain-marketplace-updated"),
        );
        setReceipt({
          ...review,
          title: `${displayDomain} delisted`,
          transactionHash: hash,
          explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (action.tool === "buyDomain") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        if (!DOMAIN_MARKETPLACE_ADDRESS) {
          throw new Error("Domain marketplace is not deployed");
        }
        if (typeof params.tokenId !== "string") {
          throw new Error("Domain purchase is missing token id");
        }
        if (typeof params.price !== "string") {
          throw new Error("Domain purchase is missing price");
        }
        const tokenId = BigInt(params.tokenId);
        const price = parseUnits(params.price, 6);
        const displayDomain = String(
          params.displayDomain ?? params.domain ?? "Domain",
        );
        await ensureAllowance(
          MARKET_USDC_ADDRESS,
          price,
          DOMAIN_MARKETPLACE_ADDRESS,
        );
        const submittedAt = performance.now();
        const hash = await submitContract({
          chainId: 5_042_002,
          address: DOMAIN_MARKETPLACE_ADDRESS,
          abi: domainMarketplaceAbi,
          functionName: "buy",
          args: [tokenId, price],
        });
        await waitForSubmitted(hash);
        setReceipt({
          ...review,
          title: `${displayDomain} purchased`,
          transactionHash: hash,
          explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      if (action.tool === "claimYield") {
        if (!publicClient) {
          throw new Error("Arc client unavailable");
        }
        const claims = claimListFromParams(params);
        if (claims.length === 0) {
          throw new Error("No pending yield claim is available");
        }
        const submittedAt = performance.now();
        let lastHash: Hash | null = null;

        for (const claim of claims) {
          const market = marketDefinitions.find(
            (definition) => definition.symbol === claim.asset,
          );
          if (!market) {
            throw new Error("Unsupported lending market");
          }
          const amount = parseUnits(claim.amount, 6);
          const hash = await withdrawAction.withdraw(
            market.address,
            amount,
          );
          if (hash) {
            await publicClient.waitForTransactionReceipt({ hash });
            lastHash = hash;
          }
        }
        setReceipt({
          ...review,
          title:
            claims.length === 1
              ? `${claims[0].amount} ${claims[0].asset} yield claimed`
              : `${claims.length} yield claims completed`,
          transactionHash: lastHash ?? undefined,
          explorerUrl: lastHash
            ? `https://testnet.arcscan.app/tx/${lastHash}`
            : undefined,
          finalityMs: Math.max(
            0,
            Math.round(performance.now() - submittedAt),
          ),
        });
        return;
      }

      const asset = params.asset as LendingAsset;
      const market = marketDefinitions.find(
        (definition) => definition.symbol === asset,
      );
      if (!market) {
        throw new Error("Unsupported lending market");
      }
      const amount = parseUnits(String(params.amount), 6);
      let hash: Hash | undefined;

      if (action.tool === "supply") {
        await ensureAllowance(
          market.address,
          amount,
          POSITION_MANAGER_ADDRESS,
        );
        hash = await supplyAction.supply(market.address, amount);
      } else if (action.tool === "withdraw") {
        hash = await withdrawAction.withdraw(market.address, amount);
      } else if (action.tool === "borrow") {
        const usePositionManager = await ensureBorrowDelegation();
        hash = usePositionManager
          ? await borrowWithReceiptAction.borrow(market.address, amount)
          : await directBorrowAction.borrow(market.address, amount);
      } else if (action.tool === "repay") {
        await ensureAllowance(
          market.address,
          amount,
          deployments.lendingPool as Address,
        );
        hash = await repayAction.repay(market.address, amount);
      } else {
        throw new Error("This action does not execute a transaction");
      }

      if (!publicClient) {
        throw new Error("Arc client unavailable");
      }
      const submittedAt = performance.now();
      if (hash) {
        await publicClient.waitForTransactionReceipt({ hash });
      }
      const completedTitles = {
        supply: `${params.amount} ${asset} supplied`,
        withdraw: `${params.amount} ${asset} withdrawn`,
        borrow: `${params.amount} ${asset} borrowed`,
        repay: `${params.amount} ${asset} repaid`,
      } as const;
      setReceipt({
        ...review,
        title: completedTitles[action.tool],
        transactionHash: hash,
        explorerUrl: hash ? `https://testnet.arcscan.app/tx/${hash}` : undefined,
        finalityMs: Math.max(
          0,
          Math.round(performance.now() - submittedAt),
        ),
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Transaction failed",
      );
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <>
      <GlassCard className="my-2 border-emerald-200/15 bg-emerald-200/[0.035] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200/20 bg-emerald-200/[0.08] text-emerald-100">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-emerald-200/60">
            Review transaction
          </p>
          <p className="mt-1 text-sm leading-5 text-white/75">
            {action.explanation}
          </p>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-white/[0.07] rounded-lg border border-white/[0.08] bg-black/15 px-3">
        {displayParams.map(([key, value]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-4 py-2.5 text-xs"
          >
            <dt className="capitalize text-white/40">
              {key.replace(/([A-Z])/g, " $1")}
            </dt>
            <dd className="font-mono text-white">{String(value)}</dd>
          </div>
        ))}
      </dl>

      {error ? (
        <p role="alert" className="mt-3 text-xs leading-5 text-red-300">
          {error}
        </p>
      ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <GlassButton
            type="button"
            variant="primary"
            className="px-3"
            disabled={isPreparing || isExecuting || !address}
            onClick={() => void openReview()}
          >
            {isPreparing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Confirm & Execute
          </GlassButton>
          <GlassButton
            type="button"
            variant="ghost"
            disabled={isPreparing || isExecuting}
            onClick={onCancel}
          >
            Cancel
          </GlassButton>
        </div>
      </GlassCard>

      <AgentTransactionFlow
        open={Boolean(review)}
        review={review}
        receipt={receipt}
        isExecuting={isExecuting}
        error={error}
        onConfirm={() => void confirm()}
        onClose={() => {
          if (isExecuting) return;
          setReview(null);
          setReceipt(null);
          setSwapQuote(null);
          setError(null);
        }}
        onDone={() => {
          if (receipt) onComplete(receipt);
        }}
      />
    </>
  );
}
