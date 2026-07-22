export type LendingAsset = "USDC" | "EURC";
export type AgentAsset = LendingAsset | "USDT" | "cirBTC";

export type AgentTool =
  | "supply"
  | "withdraw"
  | "claimYield"
  | "borrow"
  | "repay"
  | "swap"
  | "sendToken"
  | "bridge"
  | "predict"
  | "mintDomain"
  | "burnDomain"
  | "listDomain"
  | "delistDomain"
  | "buyDomain"
  | "checkHealthFactor"
  | "checkBalance"
  | "getMarketRates";

export type AgentActionParams =
  | { asset: LendingAsset; amount: string }
  | {
      asset: LendingAsset | "ALL";
      amount?: string;
      claims?: Array<{ asset: LendingAsset; amount: string }>;
    }
  | {
      tokenIn: AgentAsset;
      tokenOut: AgentAsset;
      amountIn: string;
      slippageBps: number;
    }
  | {
      asset: AgentAsset;
      amount: string;
      recipient: string;
      recipientName?: string;
      recipientDomain?: string;
    }
  | { asset: "USDC"; amount: string; sourceChain: string }
  | {
      marketId: number;
      side: "YES" | "NO";
      amount: string;
      marketTitle?: string;
    }
  | {
      domain: string;
      price?: string;
      maxPrice?: string;
      displayDomain?: string;
      tokenId?: string;
      seller?: string;
    }
  | Record<string, never>
  | { asset: AgentAsset };

export type AgentAction = {
  type: "action";
  tool: AgentTool;
  params: AgentActionParams;
  explanation: string;
};

export type ValidatedAgentAction = {
  valid: true;
  action: AgentAction;
  walletAddress: string;
  validatedAt: number;
};

export type BlockedAgentAction = {
  valid: false;
  reason: string;
};

export type AgentValidationResult =
  | ValidatedAgentAction
  | BlockedAgentAction;

export type AgentActionResponse = {
  type: "action";
  validated: ValidatedAgentAction;
};

export type AgentMessageResponse = {
  type: "message";
  text: string;
};

export type AgentResponse = AgentActionResponse | AgentMessageResponse;

export type AgentBalance = {
  wallet: string;
  supplied: string;
  debt: string;
  pendingSupplyInterest?: string;
};

export type WalletContact = {
  name: string;
  address: string;
};

export type AgentReserve = {
  asset: LendingAsset;
  address: string;
  decimals: 6;
  supplyApy: string;
  borrowApr: string;
  availableLiquidity: string;
  priceUsd: string;
  liquidationThresholdBps: number;
  active: boolean;
  borrowingEnabled: boolean;
};

export type AgentContext = {
  walletAddress: string | null;
  positions: {
    totalCollateralUsd: string;
    totalDebtUsd: string;
    availableBorrowsUsd: string;
    healthFactor: string;
    liquidationCapacityUsd: string;
  };
  balances: Partial<Record<AgentAsset, AgentBalance>>;
  contacts: WalletContact[];
  bridgeBalances: {
    Ethereum_Sepolia: string;
    Base_Sepolia: string;
    Polygon_Amoy_Testnet: string;
  };
  reserves: Partial<Record<LendingAsset, AgentReserve>>;
};

export type AgentTransactionReview = {
  title: string;
  eyebrow: string;
  amountLabel: string;
  amount: string;
  receiveLabel?: string;
  receiveAmount?: string;
  route: string[];
  detail: string;
};

export type AgentTransactionReceipt = AgentTransactionReview & {
  transactionHash?: string;
  explorerUrl?: string;
  finalityMs: number;
};

export type AgentChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  action?: ValidatedAgentAction;
  receipt?: AgentTransactionReceipt;
};
