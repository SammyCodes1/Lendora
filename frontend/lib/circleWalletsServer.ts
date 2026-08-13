import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";
import type {
  AccountType,
  Blockchain,
  ContractExecutionBlockchain,
  FeeLevel,
} from "@circle-fin/user-controlled-wallets";

export const CIRCLE_WALLET_BLOCKCHAIN = "ARC-TESTNET" as Blockchain;
export const CIRCLE_CONTRACT_BLOCKCHAIN =
  "ARC-TESTNET" as ContractExecutionBlockchain;
export const CIRCLE_WALLET_FEE_LEVEL = "MEDIUM" as FeeLevel;
export const CIRCLE_WALLET_ACCOUNT_TYPE =
  process.env.CIRCLE_WALLET_ACCOUNT_TYPE === "EOA"
    ? ("EOA" as AccountType)
    : ("SCA" as AccountType);

export function circleWalletClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    throw new Error("CIRCLE_API_KEY is not configured.");
  }

  return initiateUserControlledWalletsClient({ apiKey });
}

export function circleErrorDetails(error: unknown) {
  const candidate = error as {
    response?: {
      data?: {
        code?: number;
        message?: string;
        error?: { code?: number; message?: string } | string;
      };
    };
    code?: number;
    message?: string;
  };
  const data = candidate.response?.data;
  const nested =
    data && typeof data.error === "object" && data.error ? data.error : undefined;
  const messageFromErrorField =
    typeof data?.error === "string" ? data.error : undefined;

  return {
    code: nested?.code ?? data?.code ?? candidate.code,
    message:
      nested?.message ??
      data?.message ??
      messageFromErrorField ??
      candidate.message ??
      "Circle wallet request failed.",
  };
}

export function normalizeCircleWallet(wallet: unknown) {
  const candidate = wallet as {
    id?: string;
    walletId?: string;
    address?: string;
    blockchainAddress?: string;
    blockchain?: string;
    accountType?: string;
    state?: string;
  };

  return {
    id: candidate.id ?? candidate.walletId ?? "",
    address: candidate.address ?? candidate.blockchainAddress ?? "",
    blockchain: candidate.blockchain ?? "",
    accountType: candidate.accountType ?? "",
    state: candidate.state ?? "",
  };
}
