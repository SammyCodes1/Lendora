import testnetDeployments from "./deployments-testnet.json";
import mainnetDeployments from "./deployments-mainnet.json";

export { testnetDeployments, mainnetDeployments };

export type DeploymentManifest = typeof testnetDeployments;

export function getDeployment(chainId?: number): DeploymentManifest {
  if (chainId === 5042) {
    return mainnetDeployments as unknown as DeploymentManifest;
  }
  return testnetDeployments;
}

export default testnetDeployments;
