// End-to-end test of the Sepolia-deployed DAIOAutoConvertHook for ETH -> USDAIO.
//
// Run on a Sepolia fork:
//   ENABLE_HARDHAT_FORK=true HARDHAT_FORK_URL=$SEPOLIA_RPC_URL \
//   npx hardhat run scripts/test-eth-usdaio-hook.js
//
// What it does:
//   1. Reads the live deployment (deployments/sepolia.json) and verifies the hook,
//      the swap adapter, the accepted-token registry, and the V4 pool slot0 / liquidity
//      via extsload on the canonical Sepolia PoolManager.
//   2. Impersonates the PaymentRouter, sends ETH through UniswapV4SwapAdapter.swapExactOutputETH
//      using a freshly-built Universal Router V4 calldata (V4_SWAP -> SETTLE -> TAKE_ALL + SWEEP)
//      with hookData = abi.encode(intentHash). This exercises:
//        - swapAdapter.registerIntent on the hook (intent writer flow)
//        - UR -> PoolManager -> hook.afterSwap (pool, router, intent, output validation)
//        - swapAdapter.consumeValidation
//        - ETH refund path
//   3. Reports gas, USDAIO received, leftover ETH refunded, and the AutoConvertValidated event.

const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const SEPOLIA_POOL_MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const SEPOLIA_UNIVERSAL_ROUTER = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;

const ACTION_SWAP_EXACT_OUT_SINGLE = 0x08;
const ACTION_SETTLE = 0x0b;
const ACTION_TAKE_ALL = 0x0f;
const COMMAND_V4_SWAP = 0x10;
const COMMAND_SWEEP = 0x04;
const ETH_ADDR = "0x0000000000000000000000000000000000000000";

function loadDeployment() {
  const file = process.env.DAIO_DEPLOYMENT_FILE || path.resolve(__dirname, "..", "deployments", "sepolia.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function poolId(poolKey) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
    )
  );
}

function poolStateSlot(pid) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [pid, POOLS_SLOT])
  );
}

async function readPoolSlot0(manager, pid) {
  const data = await manager.extsload(poolStateSlot(pid));
  const v = BigInt(data);
  const sqrtPriceX96 = v & ((1n << 160n) - 1n);
  const tick = Number(BigInt.asIntN(24, (v >> 160n) & ((1n << 24n) - 1n)));
  return { sqrtPriceX96, tick };
}

async function readPoolLiquidity(manager, pid) {
  const slot = ethers.toBeHex(BigInt(poolStateSlot(pid)) + LIQUIDITY_OFFSET, 32);
  const data = await manager.extsload(slot);
  return BigInt(data) & ((1n << 128n) - 1n);
}

function buildUniversalRouterCalldata({ poolKey, amountOut, amountInMax, intentHash, recipient }) {
  // V4 actions: SWAP_EXACT_OUT_SINGLE -> SETTLE (ETH from UR balance) -> TAKE_ALL (USDAIO to msgSender = adapter)
  const actions = ethers.solidityPacked(
    ["uint8", "uint8", "uint8"],
    [ACTION_SWAP_EXACT_OUT_SINGLE, ACTION_SETTLE, ACTION_TAKE_ALL]
  );
  const swapParams = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountOut,uint128 amountInMaximum,bytes hookData)"
    ],
    [
      [
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
        true,
        amountOut,
        amountInMax,
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [intentHash])
      ]
    ]
  );
  // SETTLE(currency=ETH, amount=OPEN_DELTA, payerIsUser=false) -> UR pays from its own balance.
  const settleParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "bool"],
    [ETH_ADDR, 0, false]
  );
  // TAKE_ALL(currency=USDAIO, minAmount=amountOut). Recipient = msgSender of UR call (adapter).
  const takeAllParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256"],
    [poolKey.currency1, amountOut]
  );
  const v4SwapInput = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes[]"],
    [actions, [swapParams, settleParams, takeAllParams]]
  );
  // SWEEP(token=ETH, recipient=msgSender, amountMin=0) -> refund leftover ETH to adapter.
  const sweepInput = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256"],
    [ETH_ADDR, recipient, 0]
  );

  const commands = ethers.solidityPacked(["uint8", "uint8"], [COMMAND_V4_SWAP, COMMAND_SWEEP]);
  const inputs = [v4SwapInput, sweepInput];
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const ur = new ethers.Interface([
    "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"
  ]);
  return ur.encodeFunctionData("execute", [commands, inputs, deadline]);
}

async function impersonate(addr, balanceWei) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] });
  if (balanceWei !== undefined) {
    await network.provider.request({
      method: "hardhat_setBalance",
      params: [addr, ethers.toBeHex(balanceWei)]
    });
  }
  return ethers.getSigner(addr);
}

function bigIntMax(a, b) {
  return a > b ? a : b;
}

async function main() {
  const deployment = loadDeployment();
  const c = deployment.contracts;
  console.log("=== Sepolia ETH -> USDAIO hook test ===");
  console.log("Network chainId:", (await ethers.provider.getNetwork()).chainId.toString());
  console.log("Block number:    ", (await ethers.provider.getBlockNumber()).toString());
  console.log("USDAIO:          ", c.USDAIO);
  console.log("AutoConvertHook: ", c.DAIOAutoConvertHook);
  console.log("SwapAdapter:     ", c.UniswapV4SwapAdapter);
  console.log("PaymentRouter:   ", c.PaymentRouter);

  const hook = await ethers.getContractAt("DAIOAutoConvertHook", c.DAIOAutoConvertHook);
  const swapAdapter = await ethers.getContractAt("UniswapV4SwapAdapter", c.UniswapV4SwapAdapter);
  const tokenRegistry = await ethers.getContractAt("AcceptedTokenRegistry", c.AcceptedTokenRegistry);
  const usdaio = await ethers.getContractAt("USDAIOToken", c.USDAIO);

  // === STEP 1: Read-only verification of live wiring ===
  console.log("\n[1/3] Verifying hook wiring & pool state ...");
  const hookCode = await ethers.provider.getCode(c.DAIOAutoConvertHook);
  if (hookCode === "0x") throw new Error("Hook has no code at this block");
  const hookAddrBits = BigInt(c.DAIOAutoConvertHook) & ((1n << 14n) - 1n);
  const expectedAfterSwapBit = 1n << 6n;
  console.log("   hook address afterSwap-bit =", hookAddrBits.toString(2).padStart(14, "0"), "expected = 00000001000000");
  if (hookAddrBits !== expectedAfterSwapBit) throw new Error("hook address does not encode the expected afterSwap permission");
  console.log("   hook.usdaio()         =", await hook.usdaio());
  console.log("   hook.paymentRouter()  =", await hook.paymentRouter());
  console.log("   hook.intentWriters[adapter] =", await hook.intentWriters(c.UniswapV4SwapAdapter));
  console.log("   hook.allowedRouters[UR]     =", await hook.allowedRouters(SEPOLIA_UNIVERSAL_ROUTER));
  console.log("   tokenRegistry.acceptedTokens[ETH] =", await tokenRegistry.acceptedTokens(ETH_ADDR));
  console.log("   swapAdapter.universalRouter =", await swapAdapter.universalRouter());
  console.log("   swapAdapter.autoConvertHook =", await swapAdapter.autoConvertHook());

  const poolKey = {
    currency0: deployment.uniswapV4EthUsdaioPool.currency0,
    currency1: deployment.uniswapV4EthUsdaioPool.currency1,
    fee: deployment.uniswapV4EthUsdaioPool.fee,
    tickSpacing: deployment.uniswapV4EthUsdaioPool.tickSpacing,
    hooks: deployment.uniswapV4EthUsdaioPool.hook
  };
  const pid = poolId(poolKey);
  console.log("   poolId               =", pid);

  const poolManager = new ethers.Contract(SEPOLIA_POOL_MANAGER, ["function extsload(bytes32) view returns (bytes32)"], ethers.provider);
  const slot0 = await readPoolSlot0(poolManager, pid);
  const liquidity = await readPoolLiquidity(poolManager, pid);
  console.log("   pool.sqrtPriceX96    =", slot0.sqrtPriceX96.toString());
  console.log("   pool.tick            =", slot0.tick);
  console.log("   pool.liquidity       =", liquidity.toString());
  if (slot0.sqrtPriceX96 === 0n) throw new Error("Pool not initialized (sqrtPriceX96 == 0)");
  if (liquidity === 0n) {
    console.log("   WARNING: pool liquidity == 0; the swap below will fail with 'NotEnoughLiquidity'.");
  }
  const allowedPool = await hook.allowedPools(await hook.poolKeyHash(poolKey));
  console.log("   hook.allowedPools[poolKey]  =", allowedPool);
  if (!allowedPool) throw new Error("Hook does not whitelist this pool key hash");

  // === STEP 2: Build calldata + impersonate PaymentRouter and execute swap ===
  const requiredUsdaio = ethers.parseUnits(process.env.TEST_AMOUNT_OUT_USDAIO || "0.0001", 18);
  // amountInMax for exact-out: cap input ETH (uint128). We'll send a generous ETH value and rely on Sweep refund.
  const ethToSend = ethers.parseEther(process.env.TEST_ETH_IN || "0.05");
  const amountInMax = (1n << 128n) - 1n;
  const intentHash = ethers.id(`eth-usdaio-hook-test:${Date.now()}`);
  console.log("\n[2/3] Executing ETH -> USDAIO swap through SwapAdapter (impersonated PaymentRouter) ...");
  console.log("   amountOut (USDAIO) =", ethers.formatUnits(requiredUsdaio, 18));
  console.log("   ETH sent           =", ethers.formatEther(ethToSend));
  console.log("   intentHash         =", intentHash);

  const routerCalldata = buildUniversalRouterCalldata({
    poolKey,
    amountOut: requiredUsdaio,
    amountInMax,
    intentHash,
    recipient: c.UniswapV4SwapAdapter
  });

  const paymentRouterSigner = await impersonate(c.PaymentRouter, ethToSend + ethers.parseEther("1"));

  const usdaioBefore = await usdaio.balanceOf(c.UniswapV4SwapAdapter);
  const ethBeforeAdapter = await ethers.provider.getBalance(c.UniswapV4SwapAdapter);
  const ethBeforePR = await ethers.provider.getBalance(c.PaymentRouter);

  let tx;
  try {
    tx = await swapAdapter.connect(paymentRouterSigner).swapExactOutputETH(
      c.USDAIO,
      requiredUsdaio,
      c.UniswapV4SwapAdapter, // recipient (output USDAIO destination)
      routerCalldata,
      intentHash,
      { value: ethToSend, gasLimit: 1_500_000 }
    );
  } catch (err) {
    console.error("   swap reverted before mining:", err.shortMessage || err.message);
    if (err.data) console.error("   data:", err.data);
    throw err;
  }
  const receipt = await tx.wait();
  console.log("   tx mined, gasUsed =", receipt.gasUsed.toString());

  // === STEP 3: Verify hook event + balances ===
  console.log("\n[3/3] Decoding hook event & balance deltas ...");
  const validatedTopic = hook.interface.getEvent("AutoConvertValidated").topicHash;
  const validatedLog = receipt.logs.find((l) =>
    l.address.toLowerCase() === c.DAIOAutoConvertHook.toLowerCase() && l.topics[0] === validatedTopic
  );
  if (!validatedLog) throw new Error("AutoConvertValidated event not emitted by hook");
  const decoded = hook.interface.decodeEventLog("AutoConvertValidated", validatedLog.data, validatedLog.topics);
  console.log("   hook.AutoConvertValidated:");
  console.log("     intentHash   =", decoded.intentHash);
  console.log("     poolKey      =", decoded.poolKey);
  console.log("     router       =", decoded.router);
  console.log("     outputAmount =", ethers.formatUnits(decoded.outputAmount, 18), "USDAIO");
  if (decoded.intentHash !== intentHash) throw new Error("intentHash mismatch in event");

  const usdaioAfter = await usdaio.balanceOf(c.UniswapV4SwapAdapter);
  const ethAfterPR = await ethers.provider.getBalance(c.PaymentRouter);
  const ethAfterAdapter = await ethers.provider.getBalance(c.UniswapV4SwapAdapter);
  const usdaioDelta = usdaioAfter - usdaioBefore;
  const prEthDelta = ethBeforePR - ethAfterPR;
  console.log("   adapter USDAIO delta =", ethers.formatUnits(usdaioDelta, 18));
  console.log("   adapter ETH delta    =", ethers.formatEther(ethAfterAdapter - ethBeforeAdapter));
  console.log("   PaymentRouter ETH spent (msg.value - refund) =", ethers.formatEther(prEthDelta));
  if (usdaioDelta < requiredUsdaio) throw new Error("Adapter received less USDAIO than required");
  if (prEthDelta <= 0n || prEthDelta > ethToSend) throw new Error("Unexpected ETH spend on PaymentRouter");

  // Hook intent should have been consumed.
  const intentAfter = await hook.intents(intentHash);
  if (intentAfter.registered) throw new Error("Hook intent was not consumed");

  console.log("\nSUCCESS — DAIOAutoConvertHook validated the ETH -> USDAIO swap.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exitCode = 1;
});
