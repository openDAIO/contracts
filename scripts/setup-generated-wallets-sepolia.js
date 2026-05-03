const fs = require("fs");
const { ethers } = require("hardhat");

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const ZERO = ethers.ZeroAddress;

function parseEnvFile(path) {
  const out = {};
  if (!fs.existsSync(path)) return out;
  const text = fs.readFileSync(path, "utf8");
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

function requireEnv(env, name) {
  if (!env[name]) throw new Error(`${name} is required`);
  return env[name];
}

function addressEnv(env, name) {
  return ethers.getAddress(requireEnv(env, name));
}

function vrfPublicKey(privateKey) {
  const publicKey = ethers.SigningKey.computePublicKey(privateKey, false);
  const bytes = ethers.getBytes(publicKey);
  const x = BigInt(`0x${Buffer.from(bytes.slice(1, 33)).toString("hex")}`);
  const y = BigInt(`0x${Buffer.from(bytes.slice(33, 65)).toString("hex")}`);
  return [x, y];
}

function fastTierConfig() {
  return {
    reviewElectionDifficulty: 8000,
    auditElectionDifficulty: 10000,
    reviewCommitQuorum: 3,
    reviewRevealQuorum: 3,
    auditCommitQuorum: 3,
    auditRevealQuorum: 3,
    auditTargetLimit: 2,
    minIncomingAudit: 2,
    auditCoverageQuorum: 7000,
    contributionThreshold: 1000,
    reviewEpochSize: 25,
    auditEpochSize: 25,
    finalityFactor: 2,
    maxRetries: 1,
    minorityThreshold: 1500,
    semanticStrikeThreshold: 3,
    protocolFaultSlashBps: 500,
    missedRevealSlashBps: 100,
    semanticSlashBps: 200,
    cooldownBlocks: 100,
    reviewCommitTimeout: 10 * 60,
    reviewRevealTimeout: 10 * 60,
    auditCommitTimeout: 10 * 60,
    auditRevealTimeout: 10 * 60
  };
}

async function confirm(txPromise, label) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  console.log(`${label}: ${tx.hash} gas=${receipt.gasUsed.toString()}`);
  return receipt;
}

async function ensureEth(deployer, wallet, minEth) {
  const balance = await ethers.provider.getBalance(wallet.address);
  if (balance >= minEth) return;
  await confirm(deployer.sendTransaction({ to: wallet.address, value: minEth - balance, gasLimit: 21_000 }), `fundETH ${wallet.address}`);
}

async function ensureTokenBalance(usdaio, to, target, label) {
  const balance = await usdaio.balanceOf(to);
  if (balance >= target) return;
  await confirm(usdaio.mint(to, target - balance, { gasLimit: 100_000 }), `mintUSDAIO ${label}`);
}

async function ensureAllowance(token, wallet, spender, target, label) {
  const allowance = await token.allowance(wallet.address, spender);
  if (allowance >= target) return;
  await confirm(token.connect(wallet).approve(spender, ethers.MaxUint256, { gasLimit: 100_000 }), `approve ${label}`);
}

async function usableAgentId(erc8004Adapter, agent) {
  if (!erc8004Adapter || agent.agentId === 0n) return 0n;
  try {
    return (await erc8004Adapter.isAuthorized(agent.agentId, agent.address)) ? agent.agentId : 0n;
  } catch {
    return 0n;
  }
}

async function main() {
  const env = { ...parseEnvFile(".env"), ...process.env };
  const [deployer] = await ethers.getSigners();
  const minEth = ethers.parseEther(env.DAIO_SETUP_MIN_ETH || "0.01");
  const stake = ethers.parseEther(env.DAIO_SETUP_REVIEWER_STAKE || "1000");
  const requesterUsdaio = ethers.parseEther(env.DAIO_SETUP_REQUESTER_USDAIO || "1000");

  const addresses = {
    usdaio: addressEnv(env, "DAIO_USDAIO_ADDRESS"),
    stakeVault: addressEnv(env, "DAIO_STAKE_VAULT_ADDRESS"),
    reviewerRegistry: addressEnv(env, "DAIO_REVIEWER_REGISTRY_ADDRESS"),
    core: addressEnv(env, "DAIO_CORE_ADDRESS"),
    paymentRouter: addressEnv(env, "DAIO_PAYMENT_ROUTER_ADDRESS"),
    acceptedTokenRegistry: addressEnv(env, "DAIO_ACCEPTED_TOKEN_REGISTRY_ADDRESS"),
    erc8004Adapter: env.DAIO_ERC8004_ADAPTER_ADDRESS ? ethers.getAddress(env.DAIO_ERC8004_ADAPTER_ADDRESS) : ZERO
  };

  const usdaio = await ethers.getContractAt("USDAIOToken", addresses.usdaio, deployer);
  const reviewerRegistry = await ethers.getContractAt("ReviewerRegistry", addresses.reviewerRegistry, deployer);
  const core = await ethers.getContractAt("DAIOCore", addresses.core, deployer);
  const acceptedTokenRegistry = await ethers.getContractAt("AcceptedTokenRegistry", addresses.acceptedTokenRegistry, deployer);
  const erc8004Adapter =
    addresses.erc8004Adapter === ZERO ? undefined : await ethers.getContractAt("ERC8004Adapter", addresses.erc8004Adapter, deployer);

  await confirm(core.setTierConfig(FAST, fastTierConfig(), { gasLimit: 500_000 }), "setFastTierConfig");
  if (!(await acceptedTokenRegistry.acceptedTokens(SEPOLIA_USDC))) {
    await confirm(acceptedTokenRegistry.setAcceptedToken(SEPOLIA_USDC, true, true, { gasLimit: 100_000 }), "acceptUSDC");
  }

  const requester = new ethers.Wallet(requireEnv(env, "DAIO_REQUESTER_PRIVATE_KEY"), ethers.provider);
  const relayer = new ethers.Wallet(requireEnv(env, "DAIO_RELAYER_PRIVATE_KEY"), ethers.provider);
  const agents = [1, 2, 3, 4, 5].map((index) => {
    const privateKey = requireEnv(env, `DAIO_AGENT_${index}_PRIVATE_KEY`);
    const wallet = new ethers.Wallet(privateKey, ethers.provider);
    return {
      index,
      wallet,
      address: ethers.getAddress(requireEnv(env, `DAIO_AGENT_${index}_ADDRESS`)),
      agentId: BigInt(env[`DAIO_AGENT_${index}_AGENT_ID`] || "0"),
      privateKey
    };
  });

  for (const wallet of [requester, relayer, ...agents.map((agent) => agent.wallet)]) {
    await ensureEth(deployer, wallet, minEth);
  }

  await ensureTokenBalance(usdaio, requester.address, requesterUsdaio, "requester");
  await ensureAllowance(usdaio, requester, addresses.paymentRouter, requesterUsdaio, "requester->PaymentRouter");

  for (const agent of agents) {
    if (agent.wallet.address !== agent.address) throw new Error(`Agent ${agent.index} address/private key mismatch`);
    await ensureTokenBalance(usdaio, agent.address, stake, `agent${agent.index}`);
    await ensureAllowance(usdaio, agent.wallet, addresses.stakeVault, stake, `agent${agent.index}->StakeVault`);

    const reviewer = await reviewerRegistry.getReviewer(agent.address);
    const registered = reviewer.registered ?? reviewer[0];
    const currentStake = reviewer.stake ?? reviewer[4];
    if (!registered) {
      const agentId = await usableAgentId(erc8004Adapter, agent);
      await confirm(
        reviewerRegistry
          .connect(agent.wallet)
          .registerReviewer("", ethers.ZeroHash, agentId, DOMAIN_RESEARCH, vrfPublicKey(agent.privateKey), stake, { gasLimit: 500_000 }),
        `registerReviewer agent${agent.index}`
      );
    } else if (currentStake < stake) {
      await confirm(reviewerRegistry.connect(agent.wallet).addStake(stake - currentStake, { gasLimit: 150_000 }), `topUpStake agent${agent.index}`);
    }
  }

  const registeredReviewers = await reviewerRegistry.getReviewers();
  console.log("requester", requester.address);
  console.log("relayer", relayer.address);
  console.log("registeredReviewers", registeredReviewers.join(","));
  console.log("setup complete");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
