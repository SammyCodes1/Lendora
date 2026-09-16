import testnetDeployments from "./deployments-testnet.json";
import mainnetDeployments from "./deployments-mainnet.json";

export { testnetDeployments, mainnetDeployments };

export type DeploymentManifest = typeof mainnetDeployments;

export function getDeployment(chainId?: number): DeploymentManifest {
  if (chainId === 5042002) {
    return testnetDeployments as unknown as DeploymentManifest;
  }
  return mainnetDeployments;
}

export default mainnetDeployments;
