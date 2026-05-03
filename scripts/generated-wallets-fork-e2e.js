const fs = require("fs");
const crypto = require("crypto");
const { ethers, network } = require("hardhat");
const { ec: EC } = require("elliptic");
const BN = require("bn.js");

const DEPLOYED = {
  usdaio: "0x3bB1A142b5abE17e5B2e577fa83b5247b6532606",
  stakeVault: "0x9b790bf0bB552716dc8d3234DFf3e4a3A5a6a8F8",
  reviewerRegistry: "0x7e7Ea105168dd18293dC128eA43b3d1BE0000686",
  commitReveal: "0xBd2f6A66f4AD5162aE3eb564119C8325A660CD02",
  vrfCoordinator: "0x97dD41B2950C203bA75F0FD9189144047EF0B374",
  core: "0x41D1570eA26561C381FC94e61d1381826F45cD4d",
  roundLedger: "0x30D6A783716bC30aAF04cf1022d31627D00c6f9D",
  paymentRouter: "0x28e88241B4E887619E21869fDb835efD10B4bb80"
};

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const FINALIZED = 6n;
const ROUND_REVIEW = 0;
const ROUND_AUDIT_CONSENSUS = 1;
const ROUND_REPUTATION_FINAL = 2;
const SCALE = 10000n;
const TX_GAS_LIMIT = 5_000_000;
const REVIEW_SORTITION = ethers.id("DAIO_REVIEW_SORTITION");
const AUDIT_SORTITION = ethers.id("DAIO_AUDIT_SORTITION");
const SECP256K1 = new EC("secp256k1");
const SECP256K1_N = SECP256K1.curve.n;

function parseEnvFile(path) {
  const out = {};
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

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest();
}

function bn32(value) {
  return value.toArrayLike(Buffer, "be", 32);
}

function bigint32(value) {
  return Buffer.from(value.toString(16).padStart(64, "0"), "hex");
}

function bnToBigInt(value) {
  return BigInt(`0x${bn32(value).toString("hex")}`);
}

function pointBytes(point) {
  return Buffer.concat([Buffer.from([point.getY().isOdd() ? 3 : 2]), bn32(point.getX())]);
}

function pointBytesFromCoordinates(x, y) {
  return Buffer.concat([Buffer.from([y % 2n === 1n ? 3 : 2]), bigint32(x)]);
}

function publicKeyFromPrivateKey(privateKey) {
  const key = SECP256K1.keyFromPrivate(privateKey.replace(/^0x/, ""), "hex");
  const pub = key.getPublic();
  return [bnToBigInt(pub.getX()), bnToBigInt(pub.getY())];
}

function hashToTryAndIncrement(publicKeyPoint, message) {
  const base = Buffer.concat([Buffer.from([254, 1]), pointBytes(publicKeyPoint), Buffer.from(message)]);
  for (let counter = 0; counter < 256; counter++) {
    const x = new BN(sha256(Buffer.concat([base, Buffer.from([counter])])));
    try {
      return SECP256K1.curve.pointFromX(x, false);
    } catch {
      // Continue try-and-increment until the x coordinate maps to secp256k1.
    }
  }
  throw new Error("No valid VRF hash point was found");
}

function hashPoints(hashPoint, gamma, uPoint, vPoint) {
  return new BN(
    sha256(Buffer.concat([Buffer.from([254, 2]), pointBytes(hashPoint), pointBytes(gamma), pointBytes(uPoint), pointBytes(vPoint)])).subarray(0, 16)
  );
}

function realVrfProof(privateKey, message) {
  const scalar = new BN(privateKey.replace(/^0x/, ""), 16);
  const publicKeyPoint = SECP256K1.g.mul(scalar);
  const hashPoint = hashToTryAndIncrement(publicKeyPoint, ethers.getBytes(message));
  const gamma = hashPoint.mul(scalar);
  const nonce = new BN(sha256(Buffer.concat([Buffer.from("DAIO fork E2E VRF nonce"), bn32(scalar), Buffer.from(ethers.getBytes(message))])))
    .umod(SECP256K1_N.subn(1))
    .addn(1);
  const uPoint = SECP256K1.g.mul(nonce);
  const vPoint = hashPoint.mul(nonce);
  const c = hashPoints(hashPoint, gamma, uPoint, vPoint);
  const s = nonce.add(c.mul(scalar)).umod(SECP256K1_N);
  return [bnToBigInt(gamma.getX()), bnToBigInt(gamma.getY()), bnToBigInt(c), bnToBigInt(s)];
}

function gammaToHash(proof) {
  return `0x${sha256(Buffer.concat([Buffer.from([254, 3]), pointBytesFromCoordinates(proof[0], proof[1])])).toString("hex")}`;
}

function sortitionScore(phase, requestId, participant, subject, randomness) {
  return BigInt(
    ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "address", "address", "bytes32"],
        [phase, requestId, participant, subject, randomness]
      )
    )
  ) % SCALE;
}

async function proofAndScore(contracts, agent, requestId, phase, epoch, target, phaseStartedBlock, finalityFactor) {
  const targetAddress = target ? target.address : ethers.ZeroAddress;
  const publicKey = publicKeyFromPrivateKey(agent.privateKey);
  const message = await contracts.vrfCoordinator.messageFor(
    DEPLOYED.core,
    requestId,
    phase,
    epoch,
    agent.address,
    targetAddress,
    phaseStartedBlock,
    finalityFactor
  );
  const proof = realVrfProof(agent.privateKey, message);
  const randomness = gammaToHash(proof);
  return { proof, score: sortitionScore(phase, requestId, agent.address, targetAddress, randomness) };
}

async function signRequestIntent(paymentRouter, requester, values) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  return requester.signTypedData(
    {
      name: "DAIOPaymentRouter",
      version: "1",
      chainId,
      verifyingContract: DEPLOYED.paymentRouter
    },
    {
      RequestIntent: [
        { name: "requester", type: "address" },
        { name: "proposalURIHash", type: "bytes32" },
        { name: "proposalHash", type: "bytes32" },
        { name: "rubricHash", type: "bytes32" },
        { name: "domainMask", type: "uint256" },
        { name: "tier", type: "uint8" },
        { name: "priorityFee", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    },
    {
      requester: requester.address,
      proposalURIHash: ethers.keccak256(ethers.toUtf8Bytes(values.proposalURI)),
      proposalHash: values.proposalHash,
      rubricHash: values.rubricHash,
      domainMask: values.domainMask,
      tier: values.tier,
      priorityFee: values.priorityFee,
      nonce: await paymentRouter.nonces(requester.address),
      deadline: values.deadline
    }
  );
}

async function attach() {
  return {
    usdaio: await ethers.getContractAt("USDAIOToken", DEPLOYED.usdaio),
    reviewerRegistry: await ethers.getContractAt("ReviewerRegistry", DEPLOYED.reviewerRegistry),
    commitReveal: await ethers.getContractAt("DAIOCommitRevealManager", DEPLOYED.commitReveal),
    vrfCoordinator: await ethers.getContractAt("DAIOVRFCoordinator", DEPLOYED.vrfCoordinator),
    core: await ethers.getContractAt("DAIOCore", DEPLOYED.core),
    roundLedger: await ethers.getContractAt("DAIORoundLedger", DEPLOYED.roundLedger),
    paymentRouter: await ethers.getContractAt("PaymentRouter", DEPLOYED.paymentRouter)
  };
}

async function commitReview(contracts, requestId, agent, score) {
  const seed = BigInt(ethers.id(`${agent.label}:review`));
  const uri = `ipfs://generated-wallets/${agent.label}/review`;
  const reportHash = ethers.id(`${agent.label}:report`);
  const resultHash = await contracts.commitReveal.hashReviewReveal(requestId, agent.address, score, reportHash, uri);
  await contracts.commitReveal.connect(agent.wallet).commitReview(requestId, resultHash, seed, agent.reviewProof, { gasLimit: TX_GAS_LIMIT });
  return { score, seed, uri, reportHash };
}

async function commitAudit(contracts, requestId, auditor, targets, scores) {
  const seed = BigInt(ethers.id(`${auditor.label}:audit`));
  const targetAddresses = targets.map((target) => target.address);
  const resultHash = await contracts.commitReveal.hashAuditReveal(requestId, auditor.address, targetAddresses, scores);
  await contracts.commitReveal.connect(auditor.wallet).commitAudit(requestId, resultHash, seed, auditor.auditProofs, { gasLimit: TX_GAS_LIMIT });
  return { seed, targetAddresses, scores };
}

async function runAttempt(env, premineBlocks) {
  const forkUrl = env.HARDHAT_FORK_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  let forkBlock = env.HARDHAT_FORK_BLOCK ? Number(env.HARDHAT_FORK_BLOCK) : 0;
  if (!forkBlock) {
    const forkProvider = new ethers.JsonRpcProvider(forkUrl);
    forkBlock = await forkProvider.getBlockNumber();
    await forkProvider.destroy();
  }
  console.log("fork.reset", forkUrl, forkBlock, "premine", premineBlocks);
  await network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl: forkUrl, blockNumber: forkBlock } }]
  });
  console.log("fork.ready", await ethers.provider.getBlockNumber());
  if (premineBlocks > 0) {
    await network.provider.request({ method: "hardhat_mine", params: [`0x${premineBlocks.toString(16)}`] });
  }

  const contracts = await attach();
  const requester = new ethers.Wallet(env.DAIO_REQUESTER_PRIVATE_KEY, ethers.provider);
  const relayer = new ethers.Wallet(env.DAIO_RELAYER_PRIVATE_KEY, ethers.provider);
  const agents = [1, 2, 3, 4, 5].map((index) => ({
    index,
    label: `agent${index}`,
    name: env[`DAIO_AGENT_${index}_NAME`],
    address: env[`DAIO_AGENT_${index}_ADDRESS`],
    privateKey: env[`DAIO_AGENT_${index}_PRIVATE_KEY`],
    wallet: new ethers.Wallet(env[`DAIO_AGENT_${index}_PRIVATE_KEY`], ethers.provider)
  }));

  for (const agent of agents) {
    console.log("reviewer.check", agent.label, agent.address);
    const reviewer = await contracts.reviewerRegistry.getReviewer(agent.address);
    const registered = reviewer.registered ?? reviewer[0];
    const stake = reviewer.stake ?? reviewer[4];
    console.log("reviewer.state", agent.label, registered, ethers.formatEther(stake));
    if (!registered || stake < ethers.parseEther("1000")) {
      throw new Error(`${agent.label} is not registered on the forked Sepolia state`);
    }
  }
  console.log("reviewers.ready", agents.map((agent) => agent.address).join(", "));

  const priorityFee = ethers.parseEther("5");
  const proposalURI = `ipfs://generated-wallets-fork-e2e-${Date.now()}-${premineBlocks}`;
  const intent = {
    proposalURI,
    proposalHash: ethers.id(proposalURI),
    rubricHash: ethers.id("generated-wallets-rubric"),
    domainMask: DOMAIN_RESEARCH,
    tier: FAST,
    priorityFee,
    deadline: (await ethers.provider.getBlock("latest")).timestamp + 3600
  };
  console.log("request.signing");
  const signature = await signRequestIntent(contracts.paymentRouter, requester, intent);
  console.log("request.submittingByRelayer");
  const createTx = await contracts.paymentRouter
    .connect(relayer)
    .createRequestWithUSDAIOBySig(
      requester.address,
      intent.proposalURI,
      intent.proposalHash,
      intent.rubricHash,
      intent.domainMask,
      intent.tier,
      intent.priorityFee,
      intent.deadline,
      signature,
      { gasLimit: TX_GAS_LIMIT }
    );
  await createTx.wait();

  const requestId = await contracts.paymentRouter.latestRequestByRequester(requester.address);
  console.log("request.created", requestId.toString());
  const startTx = await contracts.core.startNextRequest({ gasLimit: TX_GAS_LIMIT });
  const startReceipt = await startTx.wait();
  console.log("request.started", startReceipt.blockNumber);
  const lifecycleAfterStart = await contracts.core.getRequestLifecycle(requestId);
  const config = { finalityFactor: 2, reviewDifficulty: 8000n, auditDifficulty: 10000n };
  const reviewPhaseStartedBlock = BigInt(startReceipt.blockNumber);
  const selected = [];
  for (const agent of agents) {
    const review = await proofAndScore(
      contracts,
      agent,
      requestId,
      REVIEW_SORTITION,
      lifecycleAfterStart.committeeEpoch,
      null,
      reviewPhaseStartedBlock,
      config.finalityFactor
    );
    agent.reviewProof = review.proof;
    agent.reviewSortitionScore = review.score;
    if (review.score < config.reviewDifficulty) selected.push(agent);
  }
  if (selected.length < 3) {
    throw new Error(`Only ${selected.length} reviewers passed review sortition`);
  }
  console.log("review.selected", selected.map((agent) => `${agent.label}:${agent.reviewSortitionScore}`).join(", "));

  const reviewers = selected.slice(0, 3);
  const reviewScores = [8000, 7000, 6000];
  const reviewCommits = [];
  for (let i = 0; i < reviewers.length; i++) {
    reviewCommits.push(await commitReview(contracts, requestId, reviewers[i], reviewScores[i]));
  }
  console.log("review.committed", reviewers.map((agent) => agent.label).join(", "));
  let lastReviewRevealReceipt;
  for (let i = 0; i < reviewers.length; i++) {
    const commit = reviewCommits[i];
    const revealTx = await contracts.commitReveal
      .connect(reviewers[i].wallet)
      .revealReview(requestId, commit.score, commit.reportHash, commit.uri, commit.seed, { gasLimit: TX_GAS_LIMIT });
    lastReviewRevealReceipt = await revealTx.wait();
  }
  console.log("review.revealed", lastReviewRevealReceipt.blockNumber);

  const lifecycleAfterReview = await contracts.core.getRequestLifecycle(requestId);
  const auditPhaseStartedBlock = BigInt(lastReviewRevealReceipt.blockNumber);
  for (const auditor of reviewers) {
    const targets = reviewers.filter((target) => target.address !== auditor.address);
    auditor.auditTargets = targets;
    auditor.auditProofs = [];
    if (config.auditDifficulty < SCALE) {
      for (const target of targets) {
        const audit = await proofAndScore(
          contracts,
          auditor,
          requestId,
          AUDIT_SORTITION,
          lifecycleAfterReview.auditEpoch,
          target,
          auditPhaseStartedBlock,
          config.finalityFactor
        );
        if (audit.score >= config.auditDifficulty) throw new Error(`${auditor.label} failed audit sortition unexpectedly`);
        auditor.auditProofs.push(audit.proof);
      }
    }
  }

  const auditCommits = [];
  for (const auditor of reviewers) {
    const scores = auditor.auditTargets.map((target) => (target.address === reviewers[0].address ? 9000 : 7000));
    auditCommits.push(await commitAudit(contracts, requestId, auditor, auditor.auditTargets, scores));
  }
  console.log("audit.committed", reviewers.map((agent) => agent.label).join(", "));
  for (let i = 0; i < reviewers.length; i++) {
    const commit = auditCommits[i];
    await contracts.commitReveal
      .connect(reviewers[i].wallet)
      .revealAudit(requestId, commit.targetAddresses, commit.scores, commit.seed, { gasLimit: TX_GAS_LIMIT });
  }
  console.log("audit.revealed");

  const lifecycle = await contracts.core.getRequestLifecycle(requestId);
  if (lifecycle.status !== FINALIZED) throw new Error(`Request did not finalize: status ${lifecycle.status}`);
  const attempt = lifecycle.retryCount;
  const round0 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_REVIEW);
  const round1 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_AUDIT_CONSENSUS);
  const round2 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_REPUTATION_FINAL);
  const latest = await contracts.paymentRouter.latestRequestState(requester.address);

  console.log("requestId", requestId.toString());
  console.log("requester", requester.address);
  console.log("relayer", relayer.address);
  console.log("reviewers", reviewers.map((agent) => `${agent.label}:${agent.address}:${agent.reviewSortitionScore}`).join(", "));
  console.log("round0", round0.score.toString(), "closed", round0.closed);
  console.log("round1", round1.score.toString(), "closed", round1.closed);
  console.log("round2", round2.score.toString(), "closed", round2.closed);
  console.log("latest.completed", latest.completed, "status", latest.status.toString());
}

async function main() {
  const env = { ...parseEnvFile(".env"), ...process.env };
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await runAttempt(env, attempt * 3);
      console.log("generated wallet Sepolia fork E2E: passed");
      return;
    } catch (error) {
      console.log(`attempt ${attempt + 1} failed: ${error.message}`);
      if (!/sortition/.test(error.message) || attempt === 5) throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
