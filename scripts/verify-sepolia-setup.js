const fs = require("fs");
const { ethers } = require("hardhat");

const SCALE = 10000n;
const FAST = 0;
const STANDARD = 1;
const CRITICAL = 2;
const NATIVE_ETH = ethers.ZeroAddress;
const SEPOLIA_UNIVERSAL_ROUTER = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
const DEFAULT_V4_POOL_FEE = 3000;
const DEFAULT_V4_TICK_SPACING = 60;

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function envUint(env, name, fallback) {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  return Number(value);
}

function sortCurrencies(currencyA, currencyB) {
  return BigInt(currencyA) < BigInt(currencyB) ? [currencyA, currencyB] : [currencyB, currencyA];
}

function ethUsdaioPoolKey(usdaio, hook, fee, tickSpacing) {
  const [currency0, currency1] = sortCurrencies(NATIVE_ETH, usdaio);
  return [currency0, currency1, fee, tickSpacing, hook];
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function expectTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected true`);
}

function tierExpectations(tier) {
  if (tier === FAST) return { reviewElectionDifficulty: SCALE, reviewRevealQuorum: 3n, auditTargetLimit: 2n, maxRetries: 1n, timeout: 10n * 60n };
  if (tier === STANDARD) return { reviewElectionDifficulty: SCALE, reviewRevealQuorum: 4n, auditTargetLimit: 3n, maxRetries: 1n, timeout: 30n * 60n };
  return { reviewElectionDifficulty: SCALE, reviewRevealQuorum: 4n, auditTargetLimit: 3n, maxRetries: 2n, timeout: 60n * 60n };
}

async function main() {
  const env = { ...parseEnvFile(".env"), ...process.env };
  const deploymentPath = env.DAIO_DEPLOYMENT_FILE || "deployments/sepolia.json";
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const contracts = deployment.contracts;
  const minStake = ethers.parseEther(env.DAIO_SETUP_REVIEWER_STAKE || "1000");
  const requesterUsdaio = ethers.parseEther(env.DAIO_SETUP_REQUESTER_USDAIO || "1000");

  for (const [name, address] of Object.entries(contracts)) {
    if (address === ethers.ZeroAddress) continue;
    expectTruthy(await ethers.provider.getCode(address) !== "0x", `${name} has code`);
  }

  const usdaio = await ethers.getContractAt("USDAIOToken", contracts.USDAIO);
  const reviewerRegistry = await ethers.getContractAt("ReviewerRegistry", contracts.ReviewerRegistry);
  const core = await ethers.getContractAt("DAIOCore", contracts.DAIOCore);
  const infoReader = await ethers.getContractAt("DAIOInfoReader", contracts.DAIOInfoReader);
  const acceptedTokenRegistry = await ethers.getContractAt("AcceptedTokenRegistry", contracts.AcceptedTokenRegistry);
  const swapAdapter = await ethers.getContractAt("UniswapV4SwapAdapter", contracts.UniswapV4SwapAdapter);
  const hook = await ethers.getContractAt("DAIOAutoConvertHook", contracts.DAIOAutoConvertHook);

  expectEqual((await core.baseRequestFee()).toString(), ethers.parseEther("100").toString(), "baseRequestFee");
  expectEqual((await core.maxActiveRequests()).toString(), "2", "maxActiveRequests");

  for (const tier of [FAST, STANDARD, CRITICAL]) {
    const config = await infoReader.tierConfig(tier);
    const expected = tierExpectations(tier);
    expectEqual(config.reviewElectionDifficulty.toString(), expected.reviewElectionDifficulty.toString(), `tier${tier}.reviewElectionDifficulty`);
    expectEqual(config.auditElectionDifficulty.toString(), SCALE.toString(), `tier${tier}.auditElectionDifficulty`);
    expectEqual(config.reviewRevealQuorum.toString(), expected.reviewRevealQuorum.toString(), `tier${tier}.reviewRevealQuorum`);
    expectEqual(config.auditRevealQuorum.toString(), expected.reviewRevealQuorum.toString(), `tier${tier}.auditRevealQuorum`);
    expectEqual(config.auditTargetLimit.toString(), expected.auditTargetLimit.toString(), `tier${tier}.auditTargetLimit`);
    expectEqual(config.minIncomingAudit.toString(), expected.auditTargetLimit.toString(), `tier${tier}.minIncomingAudit`);
    expectEqual(config.maxRetries.toString(), expected.maxRetries.toString(), `tier${tier}.maxRetries`);
    expectEqual(config.reviewCommitTimeout.toString(), expected.timeout.toString(), `tier${tier}.reviewCommitTimeout`);
    expectEqual(config.reviewRevealTimeout.toString(), expected.timeout.toString(), `tier${tier}.reviewRevealTimeout`);
    expectEqual(config.auditCommitTimeout.toString(), expected.timeout.toString(), `tier${tier}.auditCommitTimeout`);
    expectEqual(config.auditRevealTimeout.toString(), expected.timeout.toString(), `tier${tier}.auditRevealTimeout`);
  }

  expectTruthy(await acceptedTokenRegistry.acceptedTokens(NATIVE_ETH), "ETH accepted");
  expectTruthy(await acceptedTokenRegistry.acceptedTokens("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"), "USDC accepted");
  expectEqual(await swapAdapter.paymentRouter(), ethers.getAddress(contracts.PaymentRouter), "swapAdapter.paymentRouter");
  expectEqual(await swapAdapter.autoConvertHook(), ethers.getAddress(contracts.DAIOAutoConvertHook), "swapAdapter.autoConvertHook");
  expectEqual(await hook.paymentRouter(), ethers.getAddress(contracts.PaymentRouter), "hook.paymentRouter");
  expectTruthy(await hook.intentWriters(contracts.UniswapV4SwapAdapter), "hook new swap writer");
  expectTruthy(await hook.allowedRouters(env.UNIVERSAL_ROUTER_ADDRESS || SEPOLIA_UNIVERSAL_ROUTER), "hook universal router allowed");
  const poolKey = ethUsdaioPoolKey(
    contracts.USDAIO,
    contracts.DAIOAutoConvertHook,
    envUint(env, "DAIO_V4_POOL_FEE", DEFAULT_V4_POOL_FEE),
    envUint(env, "DAIO_V4_TICK_SPACING", DEFAULT_V4_TICK_SPACING)
  );
  expectTruthy(await hook.allowedPools(await hook.poolKeyHash(poolKey)), "hook ETH/USDAIO pool allowed");

  const requester = ethers.getAddress(env.DAIO_REQUESTER_ADDRESS);
  expectTruthy(await usdaio.balanceOf(requester) >= requesterUsdaio, "requester USDAIO balance");
  expectTruthy(await usdaio.allowance(requester, contracts.PaymentRouter) >= requesterUsdaio, "requester PaymentRouter allowance");

  const expectedReviewers = [];
  for (let index = 1; index <= 5; index++) {
    expectedReviewers.push(ethers.getAddress(env[`DAIO_AGENT_${index}_ADDRESS`]));
  }
  const registeredReviewers = (await reviewerRegistry.getReviewers()).map((address) => ethers.getAddress(address));
  expectEqual(registeredReviewers.length.toString(), expectedReviewers.length.toString(), "registered reviewer count");
  for (const reviewerAddress of expectedReviewers) {
    expectTruthy(registeredReviewers.includes(reviewerAddress), `${reviewerAddress} enumerated`);
    const index = expectedReviewers.indexOf(reviewerAddress) + 1;
    const expectedEnsName = env[`DAIO_AGENT_${index}_ENS_NAME`] || "";
    const expectedEnsNode = expectedEnsName ? ethers.namehash(expectedEnsName) : ethers.ZeroHash;
    const expectedAgentId = BigInt(env[`DAIO_AGENT_${index}_AGENT_ID`] || "0");
    const reviewer = await reviewerRegistry.getReviewer(reviewerAddress);
    expectTruthy(reviewer.registered, `${reviewerAddress} registered`);
    expectTruthy(reviewer.active, `${reviewerAddress} active`);
    expectTruthy(!reviewer.suspended, `${reviewerAddress} not suspended`);
    const agentId = reviewer.agentId ?? reviewer[3];
    const stake = reviewer.stake ?? reviewer[4];
    const ensNode = reviewer.ensNode ?? reviewer[10];
    const ensName = reviewer.ensName ?? reviewer[11];
    expectEqual(agentId.toString(), expectedAgentId.toString(), `${reviewerAddress} agentId`);
    expectEqual(ensName, expectedEnsName, `${reviewerAddress} ensName`);
    expectEqual(ensNode, expectedEnsNode, `${reviewerAddress} ensNode`);
    expectTruthy(stake >= minStake, `${reviewerAddress} stake`);
    expectTruthy(await usdaio.allowance(reviewerAddress, contracts.StakeVault) >= minStake, `${reviewerAddress} StakeVault allowance`);
  }

  for (const writer of (env.REVOKE_AUTO_CONVERT_HOOK_WRITERS || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const address = ethers.getAddress(writer);
    if (address === ethers.getAddress(contracts.PaymentRouter) || address === ethers.getAddress(contracts.UniswapV4SwapAdapter)) continue;
    expectTruthy(!(await hook.intentWriters(address)), `${address} hook writer revoked`);
  }

  console.log("verify complete");
  console.log(`requester ${requester}`);
  console.log(`relayer ${ethers.getAddress(env.DAIO_RELAYER_ADDRESS)}`);
  console.log(`registeredReviewers ${registeredReviewers.join(",")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
