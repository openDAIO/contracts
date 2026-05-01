const { ethers, network } = require("hardhat");

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const AFTER_SWAP_FLAG = 1n << 6n;
const HOOK_FLAG_MASK = (1n << 14n) - 1n;
const NATIVE_ETH = ethers.ZeroAddress;
const Q96 = 1n << 96n;
const REQUEST_FEE_USDAIO = ethers.parseEther("100");
const DEFAULT_EXPECTED_REVIEWERS = 5;
const DEFAULT_USDAIO_PER_ETH = 100000n;
const DEFAULT_V4_POOL_ETH_LIQUIDITY = ethers.parseEther("0.1");
const DEFAULT_V4_POOL_FEE = 3000;
const DEFAULT_V4_TICK_SPACING = 60;
const DEFAULT_FULL_RANGE_TICK_LOWER = -887220;
const DEFAULT_FULL_RANGE_TICK_UPPER = 887220;
const ACTION_MINT_POSITION = 0x02;
const ACTION_SETTLE_PAIR = 0x0d;
const ACTION_SWEEP = 0x14;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT48_MAX = (1n << 48n) - 1n;
const SEPOLIA = {
  chainId: 11155111,
  ensRegistry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  uniswapV4PoolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  uniswapV4PositionManager: "0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4",
  universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  erc8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713"
};

function envAddress(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) return undefined;
  return ethers.getAddress(value);
}

function envUint(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function envInt(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

function envBigInt(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = BigInt(value);
  if (parsed < 0n) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "y", "on"].includes(value.toLowerCase());
}

function envTokenAmount(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ethers.parseUnits(value, 18);
}

async function confirm(txPromise) {
  const tx = await txPromise;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await tx.wait();
      return tx;
    } catch (error) {
      if (error.code === "CALL_EXCEPTION" || error.code === "INSUFFICIENT_FUNDS" || error.code === "NONCE_EXPIRED") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  await tx.wait();
  return tx;
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
    reviewElectionDifficulty: 8000,
    auditElectionDifficulty: 10000,
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

function phaseTimeouts(minutes) {
  return {
    reviewCommitTimeout: minutes * 60,
    reviewRevealTimeout: minutes * 60,
    auditCommitTimeout: minutes * 60,
    auditRevealTimeout: minutes * 60
  };
}

async function configureTiers(core) {
  await confirm(core.setTierConfig(
    0,
    config({
      reviewCommitQuorum: 3,
      reviewRevealQuorum: 3,
      auditCommitQuorum: 3,
      auditRevealQuorum: 3,
      auditTargetLimit: 2,
      minIncomingAudit: 1,
      auditCoverageQuorum: 7000,
      contributionThreshold: 1000,
      reviewEpochSize: 25,
      auditEpochSize: 25,
      finalityFactor: 2,
      maxRetries: 0,
      cooldownBlocks: 100,
      ...phaseTimeouts(10)
    })
  ));
  await confirm(core.setTierConfig(
    1,
    config({
      reviewCommitQuorum: 3,
      reviewRevealQuorum: 3,
      auditCommitQuorum: 3,
      auditRevealQuorum: 3,
      auditTargetLimit: 3,
      minIncomingAudit: 2,
      auditCoverageQuorum: 8000,
      contributionThreshold: 1500,
      reviewEpochSize: 50,
      auditEpochSize: 50,
      finalityFactor: 3,
      maxRetries: 1,
      cooldownBlocks: 300,
      ...phaseTimeouts(30)
    })
  ));
  await confirm(core.setTierConfig(
    2,
    config({
      reviewCommitQuorum: 3,
      reviewRevealQuorum: 3,
      auditCommitQuorum: 3,
      auditRevealQuorum: 3,
      auditTargetLimit: 4,
      minIncomingAudit: 3,
      auditCoverageQuorum: 9000,
      contributionThreshold: 2000,
      reviewEpochSize: 100,
      auditEpochSize: 100,
      finalityFactor: 5,
      maxRetries: 2,
      cooldownBlocks: 900,
      ...phaseTimeouts(60)
    })
  ));
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
  const [owner] = await ethers.getSigners();
  const deployTx = await Hook.getDeployTransaction(poolManager, paymentRouter, usdaio, owner.address);
  const initCode = deployTx.data;
  const mined = mineHookSalt(initCode);
  const existingCode = await ethers.provider.getCode(mined.address);
  if (existingCode === "0x") {
    const tx = await owner.sendTransaction({ to: CREATE2_DEPLOYER, data: ethers.concat([mined.salt, initCode]) });
    await tx.wait();
  }
  return Hook.attach(mined.address);
}

function integerSqrt(value) {
  if (value < 0n) throw new Error("square root only accepts unsigned values");
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

function sqrtPriceX96FromToken1PerToken0(token1PerToken0) {
  return integerSqrt(token1PerToken0 * Q96 * Q96);
}

function sortCurrencies(currencyA, currencyB) {
  return BigInt(currencyA) < BigInt(currencyB) ? [currencyA, currencyB] : [currencyB, currencyA];
}

function ethUsdaioPoolKey(usdaio, hook, fee, tickSpacing) {
  const [currency0, currency1] = sortCurrencies(NATIVE_ETH, usdaio);
  return { currency0, currency1, fee, tickSpacing, hooks: hook };
}

function poolKeyTuple(poolKey) {
  return [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks];
}

function encodeActions(actions) {
  return `0x${actions.map((action) => action.toString(16).padStart(2, "0")).join("")}`;
}

function encodePlanner(actionsWithParams) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes[]"],
    [encodeActions(actionsWithParams.map(([action]) => action)), actionsWithParams.map(([, params]) => params)]
  );
}

function encodeV4MintPositionCalls(poolKey, tickLower, tickUpper, liquidity, recipient) {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const mintPosition = abi.encode(
    [
      "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
      "int24",
      "int24",
      "uint256",
      "uint128",
      "uint128",
      "address",
      "bytes"
    ],
    [poolKeyTuple(poolKey), tickLower, tickUpper, liquidity, UINT128_MAX, UINT128_MAX, recipient, "0x"]
  );
  const settlePair = abi.encode(["address", "address"], [poolKey.currency0, poolKey.currency1]);
  const sweepNative = abi.encode(["address", "address"], [NATIVE_ETH, recipient]);
  return encodePlanner([
    [ACTION_MINT_POSITION, mintPosition],
    [ACTION_SETTLE_PAIR, settlePair],
    [ACTION_SWEEP, sweepNative]
  ]);
}

async function configureV4EthUsdaioPool({ deployer, usdaio, hook, poolManagerAddress, positionManagerAddress, permit2Address }) {
  const usdaioAddress = await usdaio.getAddress();
  const fee = envUint("DAIO_V4_POOL_FEE", DEFAULT_V4_POOL_FEE);
  const tickSpacing = envInt("DAIO_V4_TICK_SPACING", DEFAULT_V4_TICK_SPACING);
  const usdaioPerEth = envBigInt("DAIO_V4_USDAIO_PER_ETH", DEFAULT_USDAIO_PER_ETH);
  const ethLiquidity = envTokenAmount("DAIO_V4_POOL_ETH_LIQUIDITY", DEFAULT_V4_POOL_ETH_LIQUIDITY);
  const tickLower = envInt("DAIO_V4_TICK_LOWER", DEFAULT_FULL_RANGE_TICK_LOWER);
  const tickUpper = envInt("DAIO_V4_TICK_UPPER", DEFAULT_FULL_RANGE_TICK_UPPER);
  const bufferBps = BigInt(envUint("DAIO_V4_LIQUIDITY_BUFFER_BPS", 1000));

  const poolKey = ethUsdaioPoolKey(usdaioAddress, await hook.getAddress(), fee, tickSpacing);
  const sqrtPriceX96 = sqrtPriceX96FromToken1PerToken0(usdaioPerEth);
  const poolKeyHash = await hook.poolKeyHash(poolKeyTuple(poolKey));

  if (positionManagerAddress) {
    const positionManager = new ethers.Contract(
      positionManagerAddress,
      [
        "function initializePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) external payable returns (int24)",
        "function modifyLiquidities(bytes unlockData,uint256 deadline) external payable",
        "function nextTokenId() external view returns (uint256)"
      ],
      deployer
    );
    await confirm(positionManager.initializePool(poolKeyTuple(poolKey), sqrtPriceX96));
    await confirm(hook.setPool(poolKeyHash, true));

    if (envBool("SEED_V4_ETH_USDAIO_POOL", true)) {
      if (!permit2Address) throw new Error("PERMIT2_ADDRESS is required to seed v4 liquidity through PositionManager");
      const permit2 = new ethers.Contract(
        permit2Address,
        ["function approve(address token,address spender,uint160 amount,uint48 expiration) external"],
        deployer
      );
      const tokenId = await positionManager.nextTokenId();
      const usdaioLiquidity = ethLiquidity * usdaioPerEth;
      const usdaioWithBuffer = usdaioLiquidity + (usdaioLiquidity * bufferBps) / 10_000n;
      const ethWithBuffer = ethLiquidity + (ethLiquidity * bufferBps) / 10_000n;
      const liquidity = (ethLiquidity * sqrtPriceX96) / Q96;
      const latestBlock = await ethers.provider.getBlock("latest");
      const deadline = latestBlock.timestamp + envUint("DAIO_V4_LP_DEADLINE_SECONDS", 30 * 60);

      await confirm(usdaio.mint(deployer.address, usdaioWithBuffer));
      await confirm(usdaio.approve(permit2Address, usdaioWithBuffer));
      await confirm(permit2.approve(usdaioAddress, positionManagerAddress, usdaioWithBuffer, UINT48_MAX));
      await confirm(positionManager.modifyLiquidities(
        encodeV4MintPositionCalls(poolKey, tickLower, tickUpper, liquidity, deployer.address),
        deadline,
        { value: ethWithBuffer }
      ));

      return { poolKey, poolKeyHash, sqrtPriceX96, liquidity, tokenId, seeded: true };
    }
    return { poolKey, poolKeyHash, sqrtPriceX96, liquidity: 0n, tokenId: 0n, seeded: false };
  }

  if (poolManagerAddress) {
    const poolManager = new ethers.Contract(
      poolManagerAddress,
      ["function initialize((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,uint160 sqrtPriceX96) external returns (int24)"],
      deployer
    );
    await confirm(poolManager.initialize(poolKeyTuple(poolKey), sqrtPriceX96));
    await confirm(hook.setPool(poolKeyHash, true));
    return { poolKey, poolKeyHash, sqrtPriceX96, liquidity: 0n, tokenId: 0n, seeded: false };
  }

  throw new Error("POOL_MANAGER_ADDRESS or V4_POSITION_MANAGER_ADDRESS is required to configure the ETH/USDAIO v4 pool");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const isSepolia = network.config.chainId === SEPOLIA.chainId;
  const expectedReviewers = envUint("DAIO_EXPECTED_REVIEWER_COUNT", DEFAULT_EXPECTED_REVIEWERS);
  if (expectedReviewers < DEFAULT_EXPECTED_REVIEWERS) throw new Error("DAIO_EXPECTED_REVIEWER_COUNT should be at least 5 for this deployment profile");

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
    await vrfCoordinator.getAddress(),
    envUint("DAIO_MAX_ACTIVE_REQUESTS", 2)
  );
  await core.waitForDeployment();

  const DAIORoundLedger = await ethers.getContractFactory("DAIORoundLedger");
  const roundLedger = await DAIORoundLedger.deploy();
  await roundLedger.waitForDeployment();

  await confirm(core.setModules(
    await stakeVault.getAddress(),
    await reviewerRegistry.getAddress(),
    await assignmentManager.getAddress(),
    await consensusScoring.getAddress(),
    await settlement.getAddress(),
    await reputationLedger.getAddress()
  ));
  await confirm(roundLedger.setCore(await core.getAddress()));
  await confirm(core.setRoundLedger(await roundLedger.getAddress()));
  await configureTiers(core);
  await confirm(stakeVault.setCoreOrSettlement(await core.getAddress()));
  await confirm(stakeVault.setAuthorized(await reviewerRegistry.getAddress(), true));
  await confirm(reviewerRegistry.setCore(await core.getAddress()));
  await confirm(reputationLedger.setCore(await core.getAddress()));
  await confirm(reviewerRegistry.setReputationGate(await reputationLedger.getAddress(), 3, 3000, 7000));
  await confirm(commitReveal.setCore(await core.getAddress()));
  await confirm(priorityQueue.setCore(await core.getAddress()));
  if ((await core.baseRequestFee()) !== REQUEST_FEE_USDAIO) {
    throw new Error("DAIOCore baseRequestFee must remain 100 USDAIO for this deployment profile");
  }

  const ensRegistry = envBool("ENABLE_ENS_VERIFIER", isSepolia)
    ? envAddress("ENS_REGISTRY_ADDRESS", isSepolia ? SEPOLIA.ensRegistry : undefined)
    : undefined;
  let ensVerifier;
  if (ensRegistry) {
    const ENSVerifier = await ethers.getContractFactory("ENSVerifier");
    ensVerifier = await ENSVerifier.deploy(ensRegistry);
    await ensVerifier.waitForDeployment();
  }

  const enableERC8004 = envBool("ENABLE_ERC8004_ADAPTER", isSepolia);
  const erc8004IdentityRegistry = enableERC8004
    ? envAddress("ERC8004_IDENTITY_REGISTRY", isSepolia ? SEPOLIA.erc8004IdentityRegistry : undefined)
    : undefined;
  const erc8004ReputationRegistry = enableERC8004
    ? envAddress("ERC8004_REPUTATION_REGISTRY", isSepolia ? SEPOLIA.erc8004ReputationRegistry : undefined)
    : undefined;
  let erc8004Adapter;
  if (erc8004IdentityRegistry && erc8004ReputationRegistry) {
    const ERC8004Adapter = await ethers.getContractFactory("ERC8004Adapter");
    erc8004Adapter = await ERC8004Adapter.deploy(erc8004IdentityRegistry, erc8004ReputationRegistry);
    await erc8004Adapter.waitForDeployment();
    await confirm(erc8004Adapter.setWriter(await reputationLedger.getAddress()));
    await confirm(reputationLedger.setERC8004Adapter(await erc8004Adapter.getAddress()));
  }
  if (ensVerifier || erc8004Adapter) {
    await confirm(reviewerRegistry.setIdentityModules(
      ensVerifier ? await ensVerifier.getAddress() : ethers.ZeroAddress,
      erc8004Adapter ? await erc8004Adapter.getAddress() : ethers.ZeroAddress
    ));
  }

  const AcceptedTokenRegistry = await ethers.getContractFactory("AcceptedTokenRegistry");
  const acceptedTokenRegistry = await AcceptedTokenRegistry.deploy(await usdaio.getAddress());
  await acceptedTokenRegistry.waitForDeployment();

  const usdcAddress = envAddress("USDC_ADDRESS", isSepolia ? SEPOLIA.usdc : undefined);
  const usdtAddress = envAddress("USDT_ADDRESS");
  if (usdcAddress) await confirm(acceptedTokenRegistry.setAcceptedToken(usdcAddress, true, true));
  if (usdtAddress) await confirm(acceptedTokenRegistry.setAcceptedToken(usdtAddress, true, true));
  if (process.env.ACCEPT_ETH === "true" || isSepolia) {
    await confirm(acceptedTokenRegistry.setAcceptedToken(ethers.ZeroAddress, true, true));
  }

  const universalRouterAddress = envAddress("UNIVERSAL_ROUTER_ADDRESS", isSepolia ? SEPOLIA.universalRouter : undefined);
  const poolManagerAddress = envAddress("POOL_MANAGER_ADDRESS", isSepolia ? SEPOLIA.uniswapV4PoolManager : undefined);
  const positionManagerAddress = envAddress("V4_POSITION_MANAGER_ADDRESS", isSepolia ? SEPOLIA.uniswapV4PositionManager : undefined);
  const permit2Address = envAddress("PERMIT2_ADDRESS", isSepolia ? SEPOLIA.permit2 : undefined);
  let swapAdapter;
  let paymentRouter;
  let autoConvertHook;
  let v4PoolConfig;
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
    await confirm(core.setPaymentRouter(await paymentRouter.getAddress()));
    await confirm(swapAdapter.setPaymentRouter(await paymentRouter.getAddress()));

    if (poolManagerAddress && envBool("ENABLE_AUTO_CONVERT_HOOK", isSepolia)) {
      autoConvertHook = await deployHookWithCreate2(poolManagerAddress, await paymentRouter.getAddress(), await usdaio.getAddress());
      await confirm(autoConvertHook.setIntentWriter(await swapAdapter.getAddress(), true));
      await confirm(autoConvertHook.setAllowedRouter(universalRouterAddress, true));
      await confirm(swapAdapter.setAutoConvertHook(await autoConvertHook.getAddress()));
      if (envBool("CONFIGURE_V4_ETH_USDAIO_POOL", isSepolia)) {
        v4PoolConfig = await configureV4EthUsdaioPool({
          deployer,
          usdaio,
          hook: autoConvertHook,
          poolManagerAddress,
          positionManagerAddress,
          permit2Address
        });
      }
    }
  }

  console.log("ExpectedReviewers:", expectedReviewers);
  console.log("BaseRequestFeeUSDAIO:", ethers.formatEther(await core.baseRequestFee()));
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
  if (v4PoolConfig) {
    console.log("V4 ETH/USDAIO PoolKey:", {
      currency0: v4PoolConfig.poolKey.currency0,
      currency1: v4PoolConfig.poolKey.currency1,
      fee: v4PoolConfig.poolKey.fee,
      tickSpacing: v4PoolConfig.poolKey.tickSpacing,
      hooks: v4PoolConfig.poolKey.hooks
    });
    console.log("V4 ETH/USDAIO PoolKeyHash:", v4PoolConfig.poolKeyHash);
    console.log("V4 ETH/USDAIO SqrtPriceX96:", v4PoolConfig.sqrtPriceX96.toString());
    console.log("V4 ETH/USDAIO LiquiditySeeded:", v4PoolConfig.seeded);
    if (v4PoolConfig.seeded) {
      console.log("V4 ETH/USDAIO PositionTokenId:", v4PoolConfig.tokenId.toString());
      console.log("V4 ETH/USDAIO Liquidity:", v4PoolConfig.liquidity.toString());
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
