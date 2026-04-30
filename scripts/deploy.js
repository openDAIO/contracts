const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const USDAIO = await ethers.getContractFactory("USDAIOToken");
  const usdaio = await USDAIO.deploy(deployer.address);
  await usdaio.waitForDeployment();

  const CommitReveal = await ethers.getContractFactory("CommitReveal");
  const commitReveal = await CommitReveal.deploy();
  await commitReveal.waitForDeployment();

  const PriorityQueue = await ethers.getContractFactory("PriorityQueue");
  const priorityQueue = await PriorityQueue.deploy();
  await priorityQueue.waitForDeployment();

  const FRAINVRFVerifier = await ethers.getContractFactory("FRAINVRFVerifier");
  const vrfVerifier = await FRAINVRFVerifier.deploy();
  await vrfVerifier.waitForDeployment();

  const DAIOCore = await ethers.getContractFactory("DAIOCore");
  const core = await DAIOCore.deploy(
    await usdaio.getAddress(),
    deployer.address,
    await commitReveal.getAddress(),
    await priorityQueue.getAddress(),
    await vrfVerifier.getAddress()
  );
  await core.waitForDeployment();

  console.log("USDAIO:", await usdaio.getAddress());
  console.log("CommitReveal:", await commitReveal.getAddress());
  console.log("PriorityQueue:", await priorityQueue.getAddress());
  console.log("FRAINVRFVerifier:", await vrfVerifier.getAddress());
  console.log("DAIOCore:", await core.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
