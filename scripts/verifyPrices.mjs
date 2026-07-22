import { createPublicClient, http, getAddress } from "viem";
import { arcTestnet } from "viem/chains";

const ORACLE = getAddress("0x5D401B38686245B57Efb682828877a3124d36653");
const ABI = [{ name:"getPrice", type:"function", stateMutability:"view", inputs:[{name:"token",type:"address"}], outputs:[{name:"price",type:"uint256"},{name:"decimals",type:"uint8"}] }];
const tokens = [
  { s:"USDC",   a:getAddress("0x3600000000000000000000000000000000000000") },
  { s:"EURC",   a:getAddress("0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a") },
  { s:"cirBTC", a:getAddress("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF") },
];
const client = createPublicClient({ chain: arcTestnet, transport: http("https://rpc.testnet.arc.network",{retryCount:3,retryDelay:1500}) });
for (const {s,a} of tokens) {
  try {
    const [v,d] = await client.readContract({ address:ORACLE, abi:ABI, functionName:"getPrice", args:[a] });
    console.log(`OK  ${s.padEnd(6)} $${Number(v)/10**Number(d)}`);
  } catch(e) { console.log(`FAIL ${s}: ${e.shortMessage??e.message}`); }
  await new Promise(r=>setTimeout(r,800));
}
