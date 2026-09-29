// run with: node -e "require('./scripts/fixCirBTC.cjs')" from arclend/frontend
// or: node --experimental-vm-modules scripts/fixCirBTC.cjs
// Uses require so Node picks up frontend/node_modules/viem via package.json

// Hardcode MAX_BOUNDS_SPREAD_BPS = 2000 (20%) — common default for MockPriceOracle.
// If setPriceBounds still reverts, try 1000 (10%) or 500 (5%).
const SPREAD_BPS = 2000n;

const PRICE   = 105_000_00000000n; // $105,000 with 8 decimals
const MIN_BPS = 10000n - SPREAD_BPS / 2n; // centre spread around price
const MAX_BPS = 10000n + SPREAD_BPS / 2n;
const minBound = PRICE * MIN_BPS / 10000n;
const maxBound = PRICE * MAX_BPS / 10000n;

const PK = process.env.PRIVATE_KEY;
if (!PK) throw new Error("PRIVATE_KEY env var required");

console.log(`\ncirBTC bounds: min=$${Number(minBound)/1e8}  max=$${Number(maxBound)/1e8}  spread=${SPREAD_BPS}bps`);
console.log(`Copy the line below and run it in your terminal:\n`);
console.log(
  `cast send 0x5D401B38686245B57Efb682828877a3124d36653 ` +
  `"setPriceBounds(address,uint256,uint256)" ` +
  `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF ` +
  `${minBound} ${maxBound} ` +
  `--private-key ${PK} ` +
  `--rpc-url https://rpc.testnet.arc.network && ` +
  `cast send 0x5D401B38686245B57Efb682828877a3124d36653 ` +
  `"setPrice(address,uint256)" ` +
  `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF ` +
  `${PRICE} ` +
  `--private-key ${PK} ` +
  `--rpc-url https://rpc.testnet.arc.network`
);
