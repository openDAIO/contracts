const { ethers, network } = require("hardhat");

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const AFTER_SWAP_FLAG = 1n << 6n;
const HOOK_FLAG_MASK = (1n << 14n) - 1n;

const SEPOLIA = {
  chainId: 11155111,
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  uniswapV4PoolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
  erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  erc8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713"
};

function envAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) return undefined;
  return ethers.getAddress(value);
}

function config({
  reviewCommitQuorum,
  reviewRevealQuorum,
  auditCommitQuorum,
  auditRevealQuorum,
  auditTargetLimit,
  minIncomingAudit,
  auditCoverageQuorum,
  contributionThreshold,
  reviewEpochSize,
  auditEpochSize,
  finalityFactor,
  maxRetries,
  cooldownBlocks,
  reviewCommitTimeout,
  reviewRevealTimeout,
  auditCommitTimeout,
  auditRevealTimeout
}) {
  return {
    reviewElectionDifficulty: 5000,
    auditElectionDifficulty: 5000,
    reviewCommitQuorum,
    reviewRevealQuorum,
    auditCommitQuorum,
    auditRevealQuorum,
    auditTargetLimit,
    minIncomingAudit,
    auditCoverageQuorum,
    contributionThreshold,
    reviewEpochSize,
    auditEpochSize,
    finalityFactor,
    maxRetries,
    minorityThreshold: 1500,
    semanticStrikeThreshold: 3,
    protocolFaultSlashBps: 500,
    missedRevealSlashBps: 100,
    semanticSlashBps: 200,
    cooldownBlocks,
    reviewCommitTimeout,
    reviewRevealTimeout,
    auditCommitTimeout,
    auditRevealTimeout
  };
}

async function configureTiers(core) {
  await core.setTierConfig(
    0,
    config({
      reviewCommitQuorum: 2,
      reviewRevealQuorum: 2,
      auditCommitQuorum: 2,
      auditRevealQuorum: 2,
      auditTargetLimit: 2,
      minIncomingAudit: 1,
      auditCoverageQuorum: 7000,
      contributionThreshold: 1000,
      reviewEpochSize: 25,
      auditEpochSize: 25,
      finalityFactor: 2,
      maxRetries: 0,
      cooldownBlocks: 100,
      reviewCommitTimeout: 30 * 60,
      reviewRevealTimeout: 30 * 60,
      auditCommitTimeout: 30 * 60,
      auditRevealTimeout: 30 * 60
    })
  );
  await core.setTierConfig(
    1,
    config({
      reviewCommitQuorum: 2,
      reviewRevealQuorum: 2,
      auditCommitQuorum: 2,
      auditRevealQuorum: 2,
      auditTargetLimit: 3,
      minIncomingAudit: 2,
      auditCoverageQuorum: 8000,
      contributionThreshold: 1500,
      reviewEpochSize: 50,
      auditEpochSize: 50,
      finalityFactor: 3,
      maxRetries: 1,
      cooldownBlocks: 300,
      reviewCommitTimeout: 2 * 60 * 60,
      reviewRevealTimeout: 2 * 60 * 60,
      auditCommitTimeout: 2 * 60 * 60,
      auditRevealTimeout: 2 * 60 * 60
    })
  );
  await core.setTierConfig(
    2,
    config({
      reviewCommitQuorum: 2,
      reviewRevealQuorum: 2,
      auditCommitQuorum: 2,
      auditRevealQuorum: 2,
      auditTargetLimit: 4,
      minIncomingAudit: 3,
      auditCoverageQuorum: 9000,
      contributionThreshold: 2000,
      reviewEpochSize: 100,
      auditEpochSize: 100,
      finalityFactor: 5,
      maxRetries: 2,
      cooldownBlocks: 900,
      reviewCommitTimeout: 6 * 60 * 60,
      reviewRevealTimeout: 6 * 60 * 60,
      auditCommitTimeout: 6 * 60 * 60,
      auditRevealTimeout: 6 * 60 * 60
    })
  );
}

function create2Address(deployer, salt, initCode) {
  return ethers.getCreate2Address(deployer, salt, ethers.keccak256(initCode));
}

function mineHookSalt(initCode) {
  for (let i = 0n; i < 160444n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const candidate = create2Address(CREATE2_DEPLOYER, salt, initCode);
    if ((BigInt(candidate) & HOOK_FLAG_MASK) === AFTER_SWAP_FLAG) {
      return { salt, address: candidate };
    }
  }
  throw new Error("Could not mine a DAIOAutoConvertHook salt with AFTER_SWAP flag");
}

async function deployHookWithCreate2(poolManager, paymentRouter, usdaio) {
  const create2Code = await ethers.provider.getCode(CREATE2_DEPLOYER);
  if (create2Code === "0x") {
    throw new Error(`CREATE2 deployer is not available at ${CREATE2_DEPLOYER} on ${network.name}`);
  }

  const Hook = await ethers.getContractFactory("DAIOAutoConvertHook");
  const deployTx = await Hook.getDeployTransaction(poolManager, paymentRouter, usdaio);
  const initCode = deployTx.data;
  const mined = mineHookSalt(initCode);
  const existingCode = await ethers.provider.getCode(mined.address);
  if (existingCode === "0x") {
    const [deployer] = await ethers.getSigners();
    const tx = await deployer.sendTransaction({ to: CREATE2_DEPLOYER, data: ethers.concat([mined.salt, initCode]) });
    await tx.wait();
  }
  return Hook.attach(mined.address);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const isSepolia = network.config.chainId === SEPOLIA.chainId;

  const USDAIO = await ethers.getContractFactory("USDAIOToken");
  const usdaio = await USDAIO.deploy(deployer.address);
  await usdaio.waitForDeployment();

  const StakeVault = await ethers.getContractFactory("StakeVault");
  const stakeVault = await StakeVault.deploy(await usdaio.getAddress());
  await stakeVault.waitForDeployment();

  const ReviewerRegistry = await ethers.getContractFactory("ReviewerRegistry");
  const reviewerRegistry = await ReviewerRegistry.deploy(await stakeVault.getAddress());
  await reviewerRegistry.waitForDeployment();

  const AssignmentManager = await ethers.getContractFactory("AssignmentManager");
  const assignmentManager = await AssignmentManager.deploy();
  await assignmentManager.waitForDeployment();

  const ConsensusScoring = await ethers.getContractFactory("ConsensusScoring");
  const consensusScoring = await ConsensusScoring.deploy();
  await consensusScoring.waitForDeployment();

  const Settlement = await ethers.getContractFactory("Settlement");
  const settlement = await Settlement.deploy();
  await settlement.waitForDeployment();

  const ReputationLedger = await ethers.getContractFactory("ReputationLedger");
  const reputationLedger = await ReputationLedger.deploy();
  await reputationLedger.waitForDeployment();

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
    deployer.address,
    await commitReveal.getAddress(),
    await priorityQueue.getAddress(),
    await vrfCoordinator.getAddress()
  );
  await core.waitForDeployment();

  const DAIORoundLedger = await ethers.getContractFactory("DAIORoundLedger");
  const roundLedger = await DAIORoundLedger.deploy();
  await roundLedger.waitForDeployment();

  await core.setModules(
    await stakeVault.getAddress(),
    await reviewerRegistry.getAddress(),
    await assignmentManager.getAddress(),
    await consensusScoring.getAddress(),
    await settlement.getAddress(),
    await reputationLedger.getAddress()
  );
  await roundLedger.setCore(await core.getAddress());
  await core.setRoundLedger(await roundLedger.getAddress());
  await configureTiers(core);
  await stakeVault.setCoreOrSettlement(await core.getAddress());
  await stakeVault.setAuthorized(await reviewerRegistry.getAddress(), true);
  await reviewerRegistry.setCore(await core.getAddress());
  await reputationLedger.setCore(await core.getAddress());
  await reviewerRegistry.setReputationGate(await reputationLedger.getAddress(), 3, 3000, 7000);
  await commitReveal.setCore(await core.getAddress());
  await priorityQueue.setCore(await core.getAddress());

  const ensRegistry = envAddress("ENS_REGISTRY_ADDRESS");
  let ensVerifier;
  if (ensRegistry) {
    const ENSVerifier = await ethers.getContractFactory("ENSVerifier");
    ensVerifier = await ENSVerifier.deploy(ensRegistry);
    await ensVerifier.waitForDeployment();
  }

  const erc8004IdentityRegistry = envAddress("ERC8004_IDENTITY_REGISTRY", isSepolia ? SEPOLIA.erc8004IdentityRegistry : undefined);
  const erc8004ReputationRegistry = envAddress("ERC8004_REPUTATION_REGISTRY", isSepolia ? SEPOLIA.erc8004ReputationRegistry : undefined);
  let erc8004Adapter;
  if (erc8004IdentityRegistry && erc8004ReputationRegistry) {
    const ERC8004Adapter = await ethers.getContractFactory("ERC8004Adapter");
    erc8004Adapter = await ERC8004Adapter.deploy(erc8004IdentityRegistry, erc8004ReputationRegistry);
    await erc8004Adapter.waitForDeployment();
    await erc8004Adapter.setWriter(await reputationLedger.getAddress());
    await reputationLedger.setERC8004Adapter(await erc8004Adapter.getAddress());
  }
  if (ensVerifier || erc8004Adapter) {
    await reviewerRegistry.setIdentityModules(
      ensVerifier ? await ensVerifier.getAddress() : ethers.ZeroAddress,
      erc8004Adapter ? await erc8004Adapter.getAddress() : ethers.ZeroAddress
    );
  }

  const AcceptedTokenRegistry = await ethers.getContractFactory("AcceptedTokenRegistry");
  const acceptedTokenRegistry = await AcceptedTokenRegistry.deploy(await usdaio.getAddress());
  await acceptedTokenRegistry.waitForDeployment();

  const usdcAddress = envAddress("USDC_ADDRESS", isSepolia ? SEPOLIA.usdc : undefined);
  const usdtAddress = envAddress("USDT_ADDRESS");
  if (usdcAddress) await acceptedTokenRegistry.setAcceptedToken(usdcAddress, true, true);
  if (usdtAddress) await acceptedTokenRegistry.setAcceptedToken(usdtAddress, true, true);
  if (process.env.ACCEPT_ETH === "true" || isSepolia) {
    await acceptedTokenRegistry.setAcceptedToken(ethers.ZeroAddress, true, true);
  }

  const universalRouterAddress = envAddress("UNIVERSAL_ROUTER_ADDRESS", isSepolia ? SEPOLIA.universalRouter : undefined);
  const poolManagerAddress = envAddress("POOL_MANAGER_ADDRESS", isSepolia ? SEPOLIA.uniswapV4PoolManager : undefined);
  let swapAdapter;
  let paymentRouter;
  let autoConvertHook;
  if (universalRouterAddress) {
    const UniswapV4SwapAdapter = await ethers.getContractFactory("UniswapV4SwapAdapter");
    swapAdapter = await UniswapV4SwapAdapter.deploy(universalRouterAddress);
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

    if (poolManagerAddress && process.env.ENABLE_AUTO_CONVERT_HOOK === "true") {
      autoConvertHook = await deployHookWithCreate2(poolManagerAddress, await paymentRouter.getAddress(), await usdaio.getAddress());
      await autoConvertHook.setIntentWriter(await swapAdapter.getAddress(), true);
      await autoConvertHook.setAllowedRouter(universalRouterAddress, true);
      await swapAdapter.setAutoConvertHook(await autoConvertHook.getAddress());
    }
  }

  console.log("USDAIO:", await usdaio.getAddress());
  console.log("StakeVault:", await stakeVault.getAddress());
  console.log("ReviewerRegistry:", await reviewerRegistry.getAddress());
  console.log("AssignmentManager:", await assignmentManager.getAddress());
  console.log("ConsensusScoring:", await consensusScoring.getAddress());
  console.log("Settlement:", await settlement.getAddress());
  console.log("ReputationLedger:", await reputationLedger.getAddress());
  console.log("DAIOCommitRevealManager:", await commitReveal.getAddress());
  console.log("DAIOPriorityQueue:", await priorityQueue.getAddress());
  console.log("FRAINVRFVerifier:", await vrfVerifier.getAddress());
  console.log("DAIOVRFCoordinator:", await vrfCoordinator.getAddress());
  console.log("DAIOCore:", await core.getAddress());
  console.log("DAIORoundLedger:", await roundLedger.getAddress());
  console.log("AcceptedTokenRegistry:", await acceptedTokenRegistry.getAddress());
  if (ensVerifier) console.log("ENSVerifier:", await ensVerifier.getAddress());
  if (erc8004Adapter) console.log("ERC8004Adapter:", await erc8004Adapter.getAddress());
  if (swapAdapter && paymentRouter) {
    console.log("UniswapV4SwapAdapter:", await swapAdapter.getAddress());
    console.log("PaymentRouter:", await paymentRouter.getAddress());
  }
  if (autoConvertHook) console.log("DAIOAutoConvertHook:", await autoConvertHook.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
