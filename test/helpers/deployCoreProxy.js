const { ethers } = require("hardhat");

const ERC1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

async function proxyAdminAddress(proxyAddress) {
  const raw = await ethers.provider.getStorage(proxyAddress, ERC1967_ADMIN_SLOT);
  return ethers.getAddress(ethers.dataSlice(raw, 12));
}

async function deployCoreProxy({ treasury, commitReveal, priorityQueue, vrfCoordinator, maxActiveRequests, proxyAdminOwner }) {
  const [deployer] = await ethers.getSigners();
  const adminOwner = proxyAdminOwner || deployer.address;
  const DAIOCore = await ethers.getContractFactory("DAIOCore");
  const coreImplementation = await DAIOCore.deploy();
  await coreImplementation.waitForDeployment();

  const initializer = DAIOCore.interface.encodeFunctionData("initialize", [
    treasury,
    commitReveal,
    priorityQueue,
    vrfCoordinator,
    maxActiveRequests
  ]);
  const DAIOCoreProxy = await ethers.getContractFactory("DAIOTransparentUpgradeableProxy");
  const coreProxy = await DAIOCoreProxy.deploy(await coreImplementation.getAddress(), adminOwner, initializer);
  await coreProxy.waitForDeployment();

  const core = DAIOCore.attach(await coreProxy.getAddress());
  const coreProxyAdmin = await proxyAdminAddress(await core.getAddress());
  return { core, coreImplementation, coreProxy, coreProxyAdmin };
}

module.exports = {
  ERC1967_ADMIN_SLOT,
  deployCoreProxy,
  proxyAdminAddress
};
