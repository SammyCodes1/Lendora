import { NextResponse } from 'next/server';
import { createPublicClient, http, parseAbiItem, getContract } from 'viem';

export const dynamic = 'force-dynamic'; // Ensure the route is not statically cached

// ABI fragment for DCA Executor
const DCA_EXECUTOR_ABI = [
  {
    type: 'event',
    name: 'PlanPulled',
    inputs: [
      { name: 'planId', type: 'uint256', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'function',
    name: 'plans',
    inputs: [{ name: 'planId', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'sellAsset', type: 'address' },
      { name: 'buyAsset', type: 'address' },
      { name: 'amountPerExecution', type: 'uint256' },
      { name: 'intervalSeconds', type: 'uint256' },
      { name: 'nextExecutionAt', type: 'uint256' },
      { name: 'endsAt', type: 'uint256' },
      { name: 'executionsRemaining', type: 'uint256' },
      { name: 'active', type: 'bool' }
    ],
    stateMutability: 'view'
  }
] as const;

// Arc Testnet chain configuration
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  network: 'arc-testnet',
  nativeCurrency: {
    decimals: 18,
    name: 'USDC',
    symbol: 'USDC',
  },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.arc.network'] },
    public: { http: ['https://rpc.testnet.arc.network'] },
  },
};

// Initialize viem public client
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

// Simple in-memory tracker for the last processed block
// In a production app, this should be stored in a persistent database or Redis
let lastProcessedBlock: bigint | null = null;

export async function GET() {
  try {
    const executorAddress = process.env.DCA_EXECUTOR_ADDRESS as `0x${string}`;
    
    if (!executorAddress) {
      return NextResponse.json({ error: 'DCA_EXECUTOR_ADDRESS is not set' }, { status: 500 });
    }

    // Determine block range to query
    const currentBlock = await publicClient.getBlockNumber();
    
    // If first run, look back 100 blocks
    const fromBlock = lastProcessedBlock !== null 
      ? lastProcessedBlock + 1n 
      : currentBlock - 100n;
      
    if (fromBlock > currentBlock) {
      return NextResponse.json({ message: 'No new blocks', processed: [] });
    }

    // Query for PlanPulled events
    const logs = await publicClient.getLogs({
      address: executorAddress,
      event: parseAbiItem('event PlanPulled(uint256 indexed planId, uint256 amountIn)'),
      fromBlock,
      toBlock: currentBlock
    });

    const processedEvents = [];
    
    // Process each log
    for (const log of logs) {
      const planId = log.args.planId;
      const amountIn = log.args.amountIn;
      
      if (planId === undefined || amountIn === undefined) continue;

      // Read plan details from the contract
      const contract = getContract({
        address: executorAddress,
        abi: DCA_EXECUTOR_ABI,
        client: publicClient,
      });

      const plan = await contract.read.plans([planId]);
      
      const eventDetails = {
        transactionHash: log.transactionHash,
        planId: planId.toString(),
        amountIn: amountIn.toString(),
        sellAsset: plan[1],
        buyAsset: plan[2],
        owner: plan[0]
      };
      
      processedEvents.push(eventDetails);

      console.log(`[DCA Listener] PlanPulled event detected:`, eventDetails);

      /*
        PRODUCTION IMPLEMENTATION NOTES:
        
        At this point, the contract has pulled 'sellAsset' from the user and 
        transferred it to the 'swapReceiver' (process.env.CIRCLE_WALLET_ID).
        
        1. Initialize Circle App Kit:
           const kit = new AppKit({ apiKey: process.env.CIRCLE_API_KEY });
           
        2. Execute the swap using Circle App Kit:
           try {
             await kit.swap({
               walletId: process.env.CIRCLE_WALLET_ID,
               fromTokenAddress: eventDetails.sellAsset,
               toTokenAddress: eventDetails.buyAsset,
               amount: eventDetails.amountIn,
               // Calculate minimum expected amount out (slippage protection)
               // Set destination to user's address (eventDetails.owner)
             });
             // Log success in Redis / DB
           } catch (error) {
             // Handle Swap Failure
             // 1. Log failure in DB
             // 2. Alert operations team
             // 3. Optional: Auto-recover funds back to user
           }
      */
    }

    // Update the last processed block
    lastProcessedBlock = currentBlock;

    return NextResponse.json({
      message: `Processed blocks ${fromBlock} to ${currentBlock}`,
      events: processedEvents
    });

  } catch (error) {
    console.error('[DCA Listener] Error processing events:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
