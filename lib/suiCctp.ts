import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  createPublicClient,
  createWalletClient,
  custom,
  hexToBytes,
  http,
  parseUnits,
  type Address,
  type Chain,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { arbitrum, base, mainnet, polygon } from "viem/chains";
import { arcMainnet, createArcMainnetTransport } from "@/lib/wagmi";

export const SUI_CCTP_DOMAIN = 8;
export const SUI_USDC_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const SUI_USDC_DECIMALS = 6;

const SUI_RPC = "https://fullnode.mainnet.sui.io:443";
const IRIS_API = "https://iris-api.circle.com";
const STANDARD_FINALITY = 2000;
const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
const CLOCK = "0x6";
const DENY_LIST = "0x403";

const SUI_PACKAGES = {
  messageTransmitter:
    "0x16bcfcfc465f96281663a344641c017de84529370e11aa3879d0dce43ad6db87",
  messageTransmitterState:
    "0x0c067f7d325e5b60e3179712e7783534ba1556cbb3d359d8161497e37689230c",
  tokenMessenger:
    "0xeb14978abfe93a37c5d5bf86a0623b923553a5f0e794daac7724f1e2fdbfb830",
  tokenMessengerState:
    "0x06fb166941cd7bc095edc019d054a753ec3f1e4c25f28f2ecc4a6cfa0a9b1167",
  handler:
    "0x185ed207c4d64fc594882ab927f9f3c6ff957aad03df8a731ba64378faeeb2bf",
  handlerState:
    "0xa32de8a6dd0178fb05f662929d55cddb69a25c26bde4b83f89e36d17ead94c41",
  treasury:
    "0x57d6725e7a8b49a7b2a612f6bd66ab5f39fc95332ca48be421c3229d514a6de7",
} as const;

const EVM_TOKEN_MESSENGER =
  "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address;
const EVM_MESSAGE_TRANSMITTER =
  "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as Address;

export const EVM_CCTP = {
  Arc: {
    domain: 26,
    chainId: 5042,
    usdc: "0x3600000000000000000000000000000000000000" as Address,
    explorerTx: (hash: string) => `https://explorer.arc.io/tx/${hash}`,
  },
  Ethereum: {
    domain: 0,
    chainId: 1,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    explorerTx: (hash: string) => `https://etherscan.io/tx/${hash}`,
  },
  Base: {
    domain: 6,
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
    explorerTx: (hash: string) => `https://basescan.org/tx/${hash}`,
  },
  Polygon: {
    domain: 7,
    chainId: 137,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" as Address,
    explorerTx: (hash: string) => `https://polygonscan.com/tx/${hash}`,
  },
  Arbitrum: {
    domain: 3,
    chainId: 42161,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address,
    explorerTx: (hash: string) => `https://arbiscan.io/tx/${hash}`,
  },
} as const;

export type EvmCctpChain = keyof typeof EVM_CCTP;

const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const tokenMessengerAbi = [
  {
    type: "function",
    name: "depositForBurn",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
    ],
    outputs: [],
  },
] as const;

const messageTransmitterAbi = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

export type SuiBridgeStepKey = "approve" | "burn" | "attestation" | "mint";

export type SuiBridgeStepUpdate = {
  state: "active" | "success";
  label?: string;
  explorerUrl?: string;
};

type SuiTxResult = {
  effects?: { status?: { status?: string; error?: string } };
  objectChanges?: Array<{
    type?: string;
    objectType?: string;
    objectId?: string;
    owner?: { AddressOwner?: string };
  }>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function evmChain(chain: EvmCctpChain): Chain {
  if (chain === "Arc") return arcMainnet;
  if (chain === "Ethereum") return mainnet;
  if (chain === "Base") return base;
  if (chain === "Polygon") return polygon;
  return arbitrum;
}

function evmClients(
  chain: EvmCctpChain,
  provider: EIP1193Provider,
  account: Address,
) {
  const viemChain = evmChain(chain);
  const transport =
    chain === "Arc"
      ? createArcMainnetTransport()
      : http(viemChain.rpcUrls.default.http[0], {
          retryCount: 2,
          timeout: 20_000,
        });
  return {
    publicClient: createPublicClient({ chain: viemChain, transport }),
    walletClient: createWalletClient({
      account,
      chain: viemChain,
      transport: custom(provider),
    }),
  };
}

export function parseUsdcAmount(amount: string) {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error("Enter a USDC amount with up to 6 decimal places");
  }
  const value = parseUnits(trimmed, SUI_USDC_DECIMALS);
  if (value <= 0n) throw new Error("Enter a valid USDC amount");
  return value;
}

export function padAddressToBytes32(address: string): Hex {
  const hex = address.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length > 64) {
    throw new Error("Recipient address is not a 32-byte value");
  }
  return `0x${hex.padStart(64, "0")}`;
}

export function suiExplorerTx(digest: string) {
  return `https://suiscan.xyz/mainnet/tx/${digest}`;
}

async function suiRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(SUI_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`Sui RPC returned ${response.status}`);
  }
  const payload = (await response.json()) as {
    result?: T;
    error?: { message?: string };
  };
  if (payload.error) {
    throw new Error(payload.error.message || "Sui RPC request failed");
  }
  return payload.result as T;
}

export async function fetchSuiUsdcBalance(owner: string) {
  const result = await suiRpc<{ totalBalance?: string }>("suix_getBalance", [
    owner,
    SUI_USDC_TYPE,
  ]);
  return Number(result?.totalBalance ?? "0") / 1_000_000;
}

function buildSuiBurnTransaction(
  amount: bigint,
  destinationDomain: number,
  evmRecipient: Address,
) {
  const tx = new Transaction();
  const [coin] = tx.moveCall({
    target: "0x2::coin::redeem_funds",
    typeArguments: [SUI_USDC_TYPE],
    arguments: [
      tx.withdrawal({
        amount,
        type: SUI_USDC_TYPE,
      }),
    ],
  });
  const [burnReceipt, returnedCoin] = tx.moveCall({
    target: `${SUI_PACKAGES.tokenMessenger}::deposit_for_burn::deposit_for_burn`,
    typeArguments: [SUI_USDC_TYPE],
    arguments: [
      coin,
      tx.pure.u32(destinationDomain),
      tx.pure.address(padAddressToBytes32(evmRecipient)),
      tx.pure.address(ZERO_ADDRESS),
      tx.pure.u256(0n),
      tx.pure.u32(STANDARD_FINALITY),
      tx.pure.vector("u8", []),
      tx.object(SUI_PACKAGES.tokenMessengerState),
    ],
  });
  const [completeBurnTicket] = tx.moveCall({
    target: `${SUI_PACKAGES.handler}::handler::burn`,
    arguments: [
      tx.object(SUI_PACKAGES.handlerState),
      burnReceipt,
      returnedCoin,
      tx.object(DENY_LIST),
      tx.object(SUI_PACKAGES.treasury),
    ],
  });
  tx.moveCall({
    target: `${SUI_PACKAGES.tokenMessenger}::deposit_for_burn::complete_burn`,
    typeArguments: [SUI_USDC_TYPE, `${SUI_PACKAGES.handler}::handler::Auth`],
    arguments: [
      completeBurnTicket,
      tx.object(SUI_PACKAGES.tokenMessengerState),
      tx.object(SUI_PACKAGES.messageTransmitterState),
    ],
  });
  return tx;
}

function buildSuiReceiveTransaction(message: Hex, attestation: Hex) {
  const tx = new Transaction();
  const [receipt] = tx.moveCall({
    target: `${SUI_PACKAGES.messageTransmitter}::receive_message::receive_message`,
    arguments: [
      tx.pure.vector("u8", Array.from(hexToBytes(message))),
      tx.pure.vector("u8", Array.from(hexToBytes(attestation))),
      tx.object(SUI_PACKAGES.messageTransmitterState),
    ],
  });
  const [mintReceipt] = tx.moveCall({
    target: `${SUI_PACKAGES.tokenMessenger}::handle_receive_message::prepare_mint`,
    typeArguments: [SUI_USDC_TYPE],
    arguments: [
      receipt,
      tx.object(SUI_PACKAGES.tokenMessengerState),
      tx.object(CLOCK),
    ],
  });
  const [completeMintTicket] = tx.moveCall({
    target: `${SUI_PACKAGES.handler}::handler::mint`,
    arguments: [
      tx.object(SUI_PACKAGES.handlerState),
      mintReceipt,
      tx.object(SUI_PACKAGES.tokenMessengerState),
      tx.object(SUI_PACKAGES.treasury),
      tx.object(DENY_LIST),
    ],
  });
  tx.moveCall({
    target: `${SUI_PACKAGES.tokenMessenger}::handle_receive_message::complete_mint`,
    typeArguments: [SUI_USDC_TYPE, `${SUI_PACKAGES.handler}::handler::Auth`],
    arguments: [
      completeMintTicket,
      tx.object(SUI_PACKAGES.tokenMessengerState),
      tx.object(SUI_PACKAGES.messageTransmitterState),
    ],
  });
  return tx;
}

function buildSendFundsTransaction(coinObjectId: string, recipient: string) {
  const tx = new Transaction();
  tx.moveCall({
    target: "0x2::coin::send_funds",
    typeArguments: [SUI_USDC_TYPE],
    arguments: [tx.object(coinObjectId), tx.pure.address(recipient)],
  });
  return tx;
}

async function waitForSuiTransaction(digest: string) {
  const deadline = Date.now() + 90_000;
  let lastError = "Sui transaction was not indexed";
  while (Date.now() < deadline) {
    try {
      const tx = await suiRpc<SuiTxResult>("sui_getTransactionBlock", [
        digest,
        { showEffects: true, showObjectChanges: true },
      ]);
      const status = tx.effects?.status?.status;
      if (status === "success") return tx;
      if (status === "failure") {
        throw new Error(tx.effects?.status?.error || "Sui transaction failed");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Sui transaction failed")
      ) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : lastError;
    }
    await sleep(1_500);
  }
  throw new Error(`${lastError}. Digest: ${digest}`);
}

function createdUsdcCoin(tx: SuiTxResult, owner: string) {
  const normalizedOwner = normalizeSuiAddress(owner);
  const coinType = `0x2::coin::Coin<${SUI_USDC_TYPE}>`;
  return tx.objectChanges?.find((change) => {
    if (change.type !== "created" || !change.objectId) return false;
    if (change.objectType !== coinType) return false;
    const addressOwner = change.owner?.AddressOwner;
    return addressOwner
      ? normalizeSuiAddress(addressOwner) === normalizedOwner
      : true;
  })?.objectId;
}

async function pollAttestation(sourceDomain: number, transactionHash: string) {
  const url = `${IRIS_API}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(transactionHash)}`;
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(url);
    if (response.status === 404) {
      await sleep(3_000);
      continue;
    }
    if (response.status === 429) {
      await sleep(15_000);
      continue;
    }
    if (!response.ok) {
      throw new Error(`Circle attestation returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      messages?: Array<{ message?: string; attestation?: string }>;
    };
    const message = payload.messages?.[0];
    if (
      message?.message &&
      message.message !== "0x" &&
      message.attestation &&
      message.attestation !== "PENDING"
    ) {
      return {
        message: message.message as Hex,
        attestation: message.attestation as Hex,
      };
    }
    await sleep(3_000);
  }
  throw new Error(
    `USDC was burned in ${transactionHash}, and Circle's attestation is still pending. Do not submit this bridge again until that transfer finishes.`,
  );
}

async function approveIfNeeded(
  chain: EvmCctpChain,
  provider: EIP1193Provider,
  account: Address,
  amount: bigint,
) {
  const { publicClient, walletClient } = evmClients(chain, provider, account);
  const usdc = EVM_CCTP[chain].usdc;
  const allowance = await publicClient.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account, EVM_TOKEN_MESSENGER],
  });
  if (allowance >= amount) return null;

  const writeApproval = async (value: bigint) => {
    const hash = await walletClient.writeContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "approve",
      args: [EVM_TOKEN_MESSENGER, value],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error("USDC approval reverted");
    }
    return hash;
  };

  if (allowance > 0n) await writeApproval(0n);
  return writeApproval(amount);
}

async function burnOnEvm(
  chain: EvmCctpChain,
  provider: EIP1193Provider,
  account: Address,
  amount: bigint,
  suiRecipient: string,
) {
  const { publicClient, walletClient } = evmClients(chain, provider, account);
  const hash = await walletClient.writeContract({
    address: EVM_TOKEN_MESSENGER,
    abi: tokenMessengerAbi,
    functionName: "depositForBurn",
    args: [
      amount,
      SUI_CCTP_DOMAIN,
      padAddressToBytes32(suiRecipient),
      EVM_CCTP[chain].usdc,
      ZERO_ADDRESS,
      0n,
      STANDARD_FINALITY,
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Deposit for burn reverted");
  }
  return hash;
}

async function mintOnEvm(
  chain: EvmCctpChain,
  provider: EIP1193Provider,
  account: Address,
  message: Hex,
  attestation: Hex,
) {
  const { publicClient, walletClient } = evmClients(chain, provider, account);
  const hash = await walletClient.writeContract({
    address: EVM_MESSAGE_TRANSMITTER,
    abi: messageTransmitterAbi,
    functionName: "receiveMessage",
    args: [message, attestation],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("USDC mint on the destination chain reverted");
  }
  return hash;
}

export async function runSuiCctpBridge(input: {
  source: "Sui" | EvmCctpChain;
  destination: "Sui" | EvmCctpChain;
  amount: string;
  evmAddress: Address;
  suiAddress: string;
  signAndExecute: (transaction: Transaction) => Promise<string>;
  prepareEvm: (chain: EvmCctpChain) => Promise<EIP1193Provider>;
  onStep: (key: SuiBridgeStepKey, update: SuiBridgeStepUpdate) => void;
}) {
  const amount = parseUsdcAmount(input.amount);
  const sourceIsSui = input.source === "Sui";
  const evmChainName = (sourceIsSui ? input.destination : input.source) as EvmCctpChain;
  const evmConfig = EVM_CCTP[evmChainName];

  if (sourceIsSui) {
    input.onStep("approve", {
      state: "success",
      label: "Prepare USDC on Sui",
    });
    input.onStep("burn", { state: "active", label: "Burn on Sui" });
    const burnDigest = await input.signAndExecute(
      buildSuiBurnTransaction(amount, evmConfig.domain, input.evmAddress),
    );
    await waitForSuiTransaction(burnDigest);
    const burnExplorerUrl = suiExplorerTx(burnDigest);
    input.onStep("burn", { state: "success", explorerUrl: burnExplorerUrl });

    input.onStep("attestation", { state: "active" });
    let attested: { message: Hex; attestation: Hex };
    try {
      attested = await pollAttestation(SUI_CCTP_DOMAIN, burnDigest);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Attestation failed";
      throw new Error(message.replace(burnDigest, burnExplorerUrl));
    }
    input.onStep("attestation", { state: "success" });

    input.onStep("mint", {
      state: "active",
      label: `Mint on ${evmChainName}`,
    });
    const provider = await input.prepareEvm(evmChainName);
    const mintHash = await mintOnEvm(
      evmChainName,
      provider,
      input.evmAddress,
      attested.message,
      attested.attestation,
    );
    const mintExplorerUrl = evmConfig.explorerTx(mintHash);
    input.onStep("mint", { state: "success", explorerUrl: mintExplorerUrl });
    return { burnExplorerUrl, mintExplorerUrl };
  }

  input.onStep("approve", { state: "active" });
  const provider = await input.prepareEvm(evmChainName);
  await approveIfNeeded(evmChainName, provider, input.evmAddress, amount);
  input.onStep("approve", { state: "success" });

  input.onStep("burn", { state: "active", label: `Burn on ${evmChainName}` });
  const burnHash = await burnOnEvm(
    evmChainName,
    provider,
    input.evmAddress,
    amount,
    input.suiAddress,
  );
  const burnExplorerUrl = evmConfig.explorerTx(burnHash);
  input.onStep("burn", { state: "success", explorerUrl: burnExplorerUrl });

  input.onStep("attestation", { state: "active" });
  let attested: { message: Hex; attestation: Hex };
  try {
    attested = await pollAttestation(evmConfig.domain, burnHash);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attestation failed";
    throw new Error(message.replace(burnHash, burnExplorerUrl));
  }
  input.onStep("attestation", { state: "success" });

  input.onStep("mint", { state: "active", label: "Mint on Sui" });
  const receiveDigest = await input.signAndExecute(
    buildSuiReceiveTransaction(attested.message, attested.attestation),
  );
  const received = await waitForSuiTransaction(receiveDigest);
  const coinObjectId = createdUsdcCoin(received, input.suiAddress);
  if (coinObjectId) {
    const foldDigest = await input.signAndExecute(
      buildSendFundsTransaction(coinObjectId, input.suiAddress),
    );
    await waitForSuiTransaction(foldDigest);
  }
  const mintExplorerUrl = suiExplorerTx(receiveDigest);
  input.onStep("mint", { state: "success", explorerUrl: mintExplorerUrl });
  return { burnExplorerUrl, mintExplorerUrl };
}
