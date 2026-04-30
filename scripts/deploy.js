const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const USDAIO = await ethers.getContractFactory("USDAIOToken");
  const usdaio = await USDAIO.deploy(deployer.address);
  await usdaio.waitForDeployment();

  const DAIOCore = await ethers.getContractFactory("DAIOCore");
  const core = await DAIOCore.deploy(await usdaio.getAddress(), deployer.address);
  await core.waitForDeployment();

  console.log("USDAIO:", await usdaio.getAddress());
  console.log("DAIOCore:", await core.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
