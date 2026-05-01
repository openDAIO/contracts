const { ethers, network } = require("hardhat");

const AFTER_SWAP_FLAG = 1n << 6n;
const HOOK_FLAG_MASK = (1n << 14n) - 1n;
const SEPOLIA = {
  chainId: 11155111,
  ensRegistry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  uniswapV4PoolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
  erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  erc8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713"
};

function envAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) return ethers.ZeroAddress;
  return ethers.getAddress(value);
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

async function creationCode(contractName) {
  const factory = await ethers.getContractFactory(contractName);
  return factory.bytecode;
}

async function deployContract(contractName, ...args) {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

function deployedFromReceipt(deployer, receipt) {
  const deployed = {};
  for (const log of receipt.logs) {
    try {
      const parsed = deployer.interface.parseLog(log);
      if (parsed?.name === "ContractDeployed") {
        deployed[parsed.args.name] = parsed.args.deployed;
      }
    } catch {
      // Ignore child-contract logs emitted during the deployment transaction.
    }
  }
  return deployed;
}

function requireAddress(deployed, name) {
  if (!deployed[name]) throw new Error(`Missing deployed address for ${name}`);
  return deployed[name];
}

async function runStage(systemDeployer, label, txPromise, deployed, gasReport) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  Object.assign(deployed, deployedFromReceipt(systemDeployer, receipt));
  gasReport.push({ label, gasUsed: receipt.gasUsed });
  console.log(`${label}: ${receipt.gasUsed.toString()} gas`);
}

function create2Address(deployer, salt, initCode) {
  return ethers.getCreate2Address(deployer, salt, ethers.keccak256(initCode));
}

function mineHookSalt(deployer, initCode) {
  for (let i = 0n; i < 1_000_000n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const candidate = create2Address(deployer, salt, initCode);
    if ((BigInt(candidate) & HOOK_FLAG_MASK) === AFTER_SWAP_FLAG) {
      return { salt, address: candidate };
    }
  }
  throw new Error("Could not mine a DAIOAutoConvertHook salt with AFTER_SWAP flag");
}

async function buildLocalMockCode() {
  return {
    mockUniversalRouter: await creationCode("MockUniversalRouter"),
    mockPoolManager: await creationCode("MockV4PoolManager")
  };
}

async function buildModuleCode() {
  return {
    usdaio: await creationCode("USDAIOToken"),
    stakeVault: await creationCode("StakeVault"),
    reviewerRegistry: await creationCode("ReviewerRegistry"),
    assignmentManager: await creationCode("AssignmentManager"),
    consensusScoring: await creationCode("ConsensusScoring"),
    settlement: await creationCode("Settlement"),
    reputationLedger: await creationCode("ReputationLedger")
  };
}

async function buildCoreCode() {
  return {
    commitReveal: await creationCode("DAIOCommitRevealManager"),
    priorityQueue: await creationCode("DAIOPriorityQueue"),
    vrfVerifier: await creationCode("FRAINVRFVerifier"),
    vrfCoordinator: await creationCode("DAIOVRFCoordinator"),
    core: await creationCode("DAIOCore"),
    roundLedger: await creationCode("DAIORoundLedger")
  };
}

async function buildPaymentCode() {
  return {
    acceptedTokenRegistry: await creationCode("AcceptedTokenRegistry"),
    swapAdapter: await creationCode("UniswapV4SwapAdapter"),
    paymentRouter: await creationCode("PaymentRouter"),
    ensVerifier: await creationCode("ENSVerifier"),
    erc8004Adapter: await creationCode("ERC8004Adapter"),
    autoConvertHook: await creationCode("DAIOAutoConvertHook")
  };
}

async function main() {
  const [deployerAccount, treasury, requester] = await ethers.getSigners();
  const isLocal = network.name === "hardhat" || network.name === "localhost";
  const isSepolia = network.config.chainId === SEPOLIA.chainId;
  const deployEnsVerifier = envBool("ENABLE_ENS_VERIFIER", true);
  const deployERC8004Adapter = envBool("ENABLE_ERC8004_ADAPTER", true);
  const deployAutoConvertHook = envBool("ENABLE_AUTO_CONVERT_HOOK", true);

  let mockEnsRegistry;
  let mockERC8004Registry;
  if (isLocal) {
    mockEnsRegistry = await deployContract("MockENSRegistry");
    mockERC8004Registry = await deployContract("MockERC8004Registry");
  }

  const systemDeployer = await deployContract("DAIOSystemDeployer");
  const systemDeployerAddress = await systemDeployer.getAddress();

  const deployed = {};
  const gasReport = [];
  const paymentCode = await buildPaymentCode();
  const config = {
    finalOwner: deployerAccount.address,
    treasury: treasury.address,
    ensRegistry: isLocal
      ? await mockEnsRegistry.getAddress()
      : envAddress("ENS_REGISTRY_ADDRESS", isSepolia ? SEPOLIA.ensRegistry : undefined),
    erc8004IdentityRegistry: isLocal
      ? await mockERC8004Registry.getAddress()
      : envAddress("ERC8004_IDENTITY_REGISTRY", isSepolia ? SEPOLIA.erc8004IdentityRegistry : undefined),
    erc8004ReputationRegistry: isLocal
      ? await mockERC8004Registry.getAddress()
      : envAddress("ERC8004_REPUTATION_REGISTRY", isSepolia ? SEPOLIA.erc8004ReputationRegistry : undefined),
    universalRouter: isLocal ? ethers.ZeroAddress : envAddress("UNIVERSAL_ROUTER_ADDRESS", isSepolia ? SEPOLIA.universalRouter : undefined),
    poolManager: isLocal ? ethers.ZeroAddress : envAddress("POOL_MANAGER_ADDRESS", isSepolia ? SEPOLIA.uniswapV4PoolManager : undefined),
    maxActiveRequests: 2,
    deployLocalMocks: isLocal,
    deployEnsVerifier,
    deployERC8004Adapter,
    deployAutoConvertHook,
    acceptEth: true
  };

  if (isLocal) {
    await runStage(systemDeployer, "deployLocalMocks", systemDeployer.deployLocalMocks(await buildLocalMockCode()), deployed, gasReport);
  }
  await runStage(systemDeployer, "deployModules", systemDeployer.deployModules(deployerAccount.address, await buildModuleCode()), deployed, gasReport);
  await runStage(systemDeployer, "deployCore", systemDeployer.deployCore(treasury.address, 2, await buildCoreCode()), deployed, gasReport);
  await runStage(
    systemDeployer,
    "deployPaymentAndIdentity",
    systemDeployer.deployPaymentAndIdentity(config, paymentCode),
    deployed,
    gasReport
  );

  if (deployAutoConvertHook) {
    const poolManager = isLocal ? requireAddress(deployed, "MockV4PoolManager") : config.poolManager;
    if (poolManager === ethers.ZeroAddress) throw new Error("POOL_MANAGER_ADDRESS is required for auto-convert hook deployment");
    const hookFactory = await ethers.getContractFactory("DAIOAutoConvertHook");
    const hookDeployTx = await hookFactory.getDeployTransaction(
      poolManager,
      requireAddress(deployed, "PaymentRouter"),
      requireAddress(deployed, "USDAIO"),
      systemDeployerAddress
    );
    const minedHook = mineHookSalt(systemDeployerAddress, hookDeployTx.data);
    await runStage(
      systemDeployer,
      "deployAutoConvertHook",
      systemDeployer.deployAutoConvertHook(paymentCode.autoConvertHook, minedHook.salt),
      deployed,
      gasReport
    );
    if (requireAddress(deployed, "DAIOAutoConvertHook") !== minedHook.address) {
      throw new Error("Mined hook address mismatch");
    }
  }

  await runStage(systemDeployer, "wireAndTransfer", systemDeployer.wireAndTransfer(config), deployed, gasReport);

  const core = await ethers.getContractAt("DAIOCore", requireAddress(deployed, "DAIOCore"));
  const paymentRouter = await ethers.getContractAt("PaymentRouter", requireAddress(deployed, "PaymentRouter"));
  const usdaio = await ethers.getContractAt("USDAIOToken", requireAddress(deployed, "USDAIO"));
  const reviewerRegistry = await ethers.getContractAt("ReviewerRegistry", requireAddress(deployed, "ReviewerRegistry"));
  const stakeVault = await ethers.getContractAt("StakeVault", requireAddress(deployed, "StakeVault"));
  const roundLedger = await ethers.getContractAt("DAIORoundLedger", requireAddress(deployed, "DAIORoundLedger"));
  const swapAdapter = await ethers.getContractAt("UniswapV4SwapAdapter", requireAddress(deployed, "UniswapV4SwapAdapter"));

  if ((await core.maxActiveRequests()) !== 2n) throw new Error("Unexpected maxActiveRequests");
  if ((await core.stakeVault()) !== await stakeVault.getAddress()) throw new Error("Core stakeVault not wired");
  if ((await paymentRouter.core()) !== await core.getAddress()) throw new Error("PaymentRouter core not wired");
  if ((await reviewerRegistry.core()) !== await core.getAddress()) throw new Error("ReviewerRegistry core not wired");
  if ((await roundLedger.core()) !== await core.getAddress()) throw new Error("RoundLedger core not wired");
  if ((await swapAdapter.paymentRouter()) !== await paymentRouter.getAddress()) throw new Error("SwapAdapter router not wired");
  if (deployAutoConvertHook) {
    const autoConvertHook = await ethers.getContractAt("DAIOAutoConvertHook", requireAddress(deployed, "DAIOAutoConvertHook"));
    if ((await swapAdapter.autoConvertHook()) !== await autoConvertHook.getAddress()) throw new Error("Hook not wired");
    if ((await autoConvertHook.owner()) !== deployerAccount.address) throw new Error("Hook ownership not transferred");
  }

  if (isLocal) {
    const requestFee = await core.baseRequestFee();
    await usdaio.mint(requester.address, requestFee);
    await usdaio.connect(requester).approve(await paymentRouter.getAddress(), requestFee);
    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://deployer-contract-local", ethers.id("deployer-contract-local"), ethers.id("rubric"), 1, 0, 0);
    const requestId = await paymentRouter.latestRequestByRequester(requester.address);
    if (requestId !== 1n) throw new Error("Request creation through deployed system failed");
  }

  console.log("DAIOSystemDeployer:", systemDeployerAddress);
  if (isLocal) {
    console.log("MockENSRegistry:", await mockEnsRegistry.getAddress());
    console.log("MockERC8004Registry:", await mockERC8004Registry.getAddress());
  }
  for (const [name, address] of Object.entries(deployed)) {
    console.log(`${name}:`, address);
  }
  console.log("Gas stages:", gasReport.map(({ label, gasUsed }) => `${label}=${gasUsed.toString()}`).join(", "));
  console.log("Local deployment-contract smoke test: passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
