const fs = require("fs");
const { ethers } = require("hardhat");

const NATIVE_ETH = ethers.ZeroAddress;
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SEPOLIA_UNIVERSAL_ROUTER = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
const DEFAULT_V4_POOL_FEE = 3000;
const DEFAULT_V4_TICK_SPACING = 60;

function envAddressList(name) {
  const value = process.env[name];
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => ethers.getAddress(item));
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

async function confirm(txPromise, label) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${tx.hash} gas=${receipt.gasUsed.toString()}`);
}

function sortCurrencies(currencyA, currencyB) {
  return BigInt(currencyA) < BigInt(currencyB) ? [currencyA, currencyB] : [currencyB, currencyA];
}

function ethUsdaioPoolKey(usdaio, hook, fee, tickSpacing) {
  const [currency0, currency1] = sortCurrencies(NATIVE_ETH, usdaio);
  return [currency0, currency1, fee, tickSpacing, hook];
}

async function main() {
  const deploymentPath = process.env.DAIO_DEPLOYMENT_FILE || "deployments/sepolia.json";
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const contracts = deployment.contracts;
  const core = await ethers.getContractAt("DAIOCore", contracts.DAIOCore);
  const acceptedTokenRegistry = await ethers.getContractAt("AcceptedTokenRegistry", contracts.AcceptedTokenRegistry);
  const swapAdapter = await ethers.getContractAt("UniswapV4SwapAdapter", contracts.UniswapV4SwapAdapter);
  const hook = await ethers.getContractAt("DAIOAutoConvertHook", contracts.DAIOAutoConvertHook);

  await confirm(core.setPaymentRouter(contracts.PaymentRouter, { gasLimit: 100_000 }), "core.setPaymentRouter");

  if (!(await acceptedTokenRegistry.acceptedTokens(SEPOLIA_USDC))) {
    await confirm(acceptedTokenRegistry.setAcceptedToken(SEPOLIA_USDC, true, true, { gasLimit: 100_000 }), "acceptUSDC");
  }
  if (!(await acceptedTokenRegistry.acceptedTokens(NATIVE_ETH))) {
    await confirm(acceptedTokenRegistry.setAcceptedToken(NATIVE_ETH, true, true, { gasLimit: 100_000 }), "acceptETH");
  }

  if ((await swapAdapter.paymentRouter()) !== ethers.getAddress(contracts.PaymentRouter)) {
    await confirm(swapAdapter.setPaymentRouter(contracts.PaymentRouter, { gasLimit: 100_000 }), "swapAdapter.setPaymentRouter");
  }
  if ((await swapAdapter.autoConvertHook()) !== ethers.getAddress(contracts.DAIOAutoConvertHook)) {
    await confirm(swapAdapter.setAutoConvertHook(contracts.DAIOAutoConvertHook, { gasLimit: 100_000 }), "swapAdapter.setAutoConvertHook");
  }

  if ((await hook.paymentRouter()) !== ethers.getAddress(contracts.PaymentRouter)) {
    await confirm(hook.setPaymentRouter(contracts.PaymentRouter, { gasLimit: 100_000 }), "hook.setPaymentRouter");
  }
  if (!(await hook.intentWriters(contracts.UniswapV4SwapAdapter))) {
    await confirm(hook.setIntentWriter(contracts.UniswapV4SwapAdapter, true, { gasLimit: 100_000 }), "hook.setIntentWriter(newSwapAdapter,true)");
  }

  const universalRouter = process.env.UNIVERSAL_ROUTER_ADDRESS || SEPOLIA_UNIVERSAL_ROUTER;
  if (!(await hook.allowedRouters(universalRouter))) {
    await confirm(hook.setAllowedRouter(universalRouter, true, { gasLimit: 100_000 }), "hook.setAllowedRouter");
  }

  const poolKey = ethUsdaioPoolKey(
    contracts.USDAIO,
    contracts.DAIOAutoConvertHook,
    envUint("DAIO_V4_POOL_FEE", DEFAULT_V4_POOL_FEE),
    envInt("DAIO_V4_TICK_SPACING", DEFAULT_V4_TICK_SPACING)
  );
  const poolKeyHash = await hook.poolKeyHash(poolKey);
  if (!(await hook.allowedPools(poolKeyHash))) {
    await confirm(hook.setPool(poolKeyHash, true, { gasLimit: 100_000 }), "hook.setPool");
  }

  for (const writer of envAddressList("REVOKE_AUTO_CONVERT_HOOK_WRITERS")) {
    if (writer === ethers.getAddress(contracts.PaymentRouter) || writer === ethers.getAddress(contracts.UniswapV4SwapAdapter)) continue;
    if (await hook.intentWriters(writer)) {
      await confirm(hook.setIntentWriter(writer, false, { gasLimit: 100_000 }), `hook.setIntentWriter(${writer},false)`);
    }
  }

  deployment.status = "complete";
  deployment.finalizedAtBlock = await ethers.provider.getBlockNumber();
  fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log("finalize complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
