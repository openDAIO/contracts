const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const USDAIO = await ethers.getContractFactory("USDAIOToken");
  const usdaio = await USDAIO.deploy(deployer.address);
  await usdaio.waitForDeployment();

  const CommitReveal = await ethers.getContractFactory("DAIOCommitRevealManager");
  const commitReveal = await CommitReveal.deploy();
  await commitReveal.waitForDeployment();

  const PriorityQueue = await ethers.getContractFactory("DAIOPriorityQueue");
  const priorityQueue = await PriorityQueue.deploy();
  await priorityQueue.waitForDeployment();

  const FRAINVRFVerifier = await ethers.getContractFactory("FRAINVRFVerifier");
  const vrfVerifier = await FRAINVRFVerifier.deploy();
  await vrfVerifier.waitForDeployment();

  const DAIOVRFCoordinator = await ethers.getContractFactory("DAIOVRFCoordinator");
  const vrfCoordinator = await DAIOVRFCoordinator.deploy(await vrfVerifier.getAddress());
  await vrfCoordinator.waitForDeployment();

  const DAIOCore = await ethers.getContractFactory("DAIOCore");
  const core = await DAIOCore.deploy(
    await usdaio.getAddress(),
    deployer.address,
    await commitReveal.getAddress(),
    await priorityQueue.getAddress(),
    await vrfCoordinator.getAddress()
  );
  await core.waitForDeployment();
  await commitReveal.setCore(await core.getAddress());
  await priorityQueue.setCore(await core.getAddress());

  const AcceptedTokenRegistry = await ethers.getContractFactory("AcceptedTokenRegistry");
  const acceptedTokenRegistry = await AcceptedTokenRegistry.deploy(await usdaio.getAddress());
  await acceptedTokenRegistry.waitForDeployment();
  if (process.env.USDC_ADDRESS) {
    await acceptedTokenRegistry.setAcceptedToken(process.env.USDC_ADDRESS, true, true);
  }
  if (process.env.USDT_ADDRESS) {
    await acceptedTokenRegistry.setAcceptedToken(process.env.USDT_ADDRESS, true, true);
  }
  if (process.env.ACCEPT_ETH === "true") {
    await acceptedTokenRegistry.setAcceptedToken(ethers.ZeroAddress, true, true);
  }

  let swapAdapter;
  let paymentRouter;
  if (process.env.UNIVERSAL_ROUTER_ADDRESS) {
    const UniswapV4SwapAdapter = await ethers.getContractFactory("UniswapV4SwapAdapter");
    swapAdapter = await UniswapV4SwapAdapter.deploy(process.env.UNIVERSAL_ROUTER_ADDRESS);
    await swapAdapter.waitForDeployment();

    const PaymentRouter = await ethers.getContractFactory("PaymentRouter");
    paymentRouter = await PaymentRouter.deploy(
      await usdaio.getAddress(),
      await core.getAddress(),
      await acceptedTokenRegistry.getAddress(),
      await swapAdapter.getAddress()
    );
    await paymentRouter.waitForDeployment();
    await core.setPaymentRouter(await paymentRouter.getAddress());
    await swapAdapter.setPaymentRouter(await paymentRouter.getAddress());
  }

  console.log("USDAIO:", await usdaio.getAddress());
  console.log("DAIOCommitRevealManager:", await commitReveal.getAddress());
  console.log("DAIOPriorityQueue:", await priorityQueue.getAddress());
  console.log("FRAINVRFVerifier:", await vrfVerifier.getAddress());
  console.log("DAIOVRFCoordinator:", await vrfCoordinator.getAddress());
  console.log("DAIOCore:", await core.getAddress());
  console.log("AcceptedTokenRegistry:", await acceptedTokenRegistry.getAddress());
  if (swapAdapter && paymentRouter) {
    console.log("UniswapV4SwapAdapter:", await swapAdapter.getAddress());
    console.log("PaymentRouter:", await paymentRouter.getAddress());
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
