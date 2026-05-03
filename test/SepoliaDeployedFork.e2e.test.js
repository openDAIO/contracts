const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const crypto = require("crypto");
const { ec: EC } = require("elliptic");
const BN = require("bn.js");

const RUN_DEPLOYED_FORK = process.env.RUN_SEPOLIA_DEPLOYED_FORK === "true";
const describeDeployedFork = RUN_DEPLOYED_FORK ? describe : describe.skip;
const FORK_URL = process.env.SEPOLIA_RPC_URL || process.env.HARDHAT_FORK_URL || "https://sepolia.drpc.org";
const FORK_BLOCK = Number(process.env.SEPOLIA_FORK_BLOCK || "0");

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const REVIEW_COMMIT = 2n;
const FINALIZED = 6n;
const SCALE = 10000n;
const ROUND_REVIEW = 0;
const ROUND_AUDIT_CONSENSUS = 1;
const ROUND_REPUTATION_FINAL = 2;
const ELECTION_DIFFICULTY = 8000n;
const FAST_REVIEW_QUORUM = 3;
const REVIEW_SORTITION = ethers.id("DAIO_REVIEW_SORTITION");
const SECP256K1 = new EC("secp256k1");
const SECP256K1_N = SECP256K1.curve.n;
let DEPLOYER;
let DEPLOYED;
let DEPLOYMENT_MIN_FORK_BLOCK = 0;

function fastConfig() {
  return {
    reviewElectionDifficulty: Number(ELECTION_DIFFICULTY),
    auditElectionDifficulty: Number(SCALE),
    reviewCommitQuorum: FAST_REVIEW_QUORUM,
    reviewRevealQuorum: FAST_REVIEW_QUORUM,
    auditCommitQuorum: FAST_REVIEW_QUORUM,
    auditRevealQuorum: FAST_REVIEW_QUORUM,
    auditTargetLimit: FAST_REVIEW_QUORUM - 1,
    minIncomingAudit: FAST_REVIEW_QUORUM - 1,
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

const SEPOLIA = {
  ensRegistry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
  erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  erc8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713"
};

function loadDeployment() {
  if (process.env.DAIO_DEPLOYMENT_FILE) {
    const deployment = JSON.parse(require("fs").readFileSync(process.env.DAIO_DEPLOYMENT_FILE, "utf8"));
    const contracts = deployment.contracts || deployment;
    DEPLOYER = process.env.DAIO_DEPLOYER_ADDRESS || deployment.deployer;
    DEPLOYMENT_MIN_FORK_BLOCK = Number(deployment.finalizedAtBlock || deployment.deployedAtBlock || 0);
    DEPLOYED = {
      usdaio: contracts.USDAIO,
      stakeVault: contracts.StakeVault,
      reviewerRegistry: contracts.ReviewerRegistry,
      assignmentManager: contracts.AssignmentManager,
      consensusScoring: contracts.ConsensusScoring,
      settlement: contracts.Settlement,
      reputationLedger: contracts.ReputationLedger,
      commitReveal: contracts.DAIOCommitRevealManager,
      priorityQueue: contracts.DAIOPriorityQueue,
      vrfVerifier: contracts.FRAINVRFVerifier,
      vrfCoordinator: contracts.DAIOVRFCoordinator,
      core: contracts.DAIOCore,
      roundLedger: contracts.DAIORoundLedger,
      erc8004Adapter: contracts.ERC8004Adapter,
      acceptedTokenRegistry: contracts.AcceptedTokenRegistry,
      swapAdapter: contracts.UniswapV4SwapAdapter,
      paymentRouter: contracts.PaymentRouter,
      ensVerifier: contracts.ENSVerifier,
      autoConvertHook: contracts.DAIOAutoConvertHook
    };
  } else {
    DEPLOYER = process.env.DAIO_DEPLOYER_ADDRESS;
    DEPLOYED = {
      usdaio: process.env.DAIO_USDAIO_ADDRESS,
      stakeVault: process.env.DAIO_STAKE_VAULT_ADDRESS,
      reviewerRegistry: process.env.DAIO_REVIEWER_REGISTRY_ADDRESS,
      assignmentManager: process.env.DAIO_ASSIGNMENT_MANAGER_ADDRESS,
      consensusScoring: process.env.DAIO_CONSENSUS_SCORING_ADDRESS,
      settlement: process.env.DAIO_SETTLEMENT_ADDRESS,
      reputationLedger: process.env.DAIO_REPUTATION_LEDGER_ADDRESS,
      commitReveal: process.env.DAIO_COMMIT_REVEAL_ADDRESS,
      priorityQueue: process.env.DAIO_PRIORITY_QUEUE_ADDRESS,
      vrfVerifier: process.env.DAIO_VRF_VERIFIER_ADDRESS,
      vrfCoordinator: process.env.DAIO_VRF_COORDINATOR_ADDRESS,
      core: process.env.DAIO_CORE_ADDRESS,
      roundLedger: process.env.DAIO_ROUND_LEDGER_ADDRESS,
      erc8004Adapter: process.env.DAIO_ERC8004_ADAPTER_ADDRESS,
      acceptedTokenRegistry: process.env.DAIO_ACCEPTED_TOKEN_REGISTRY_ADDRESS,
      swapAdapter: process.env.DAIO_SWAP_ADAPTER_ADDRESS,
      paymentRouter: process.env.DAIO_PAYMENT_ROUTER_ADDRESS,
      ensVerifier: process.env.DAIO_ENS_VERIFIER_ADDRESS,
      autoConvertHook: process.env.DAIO_AUTO_CONVERT_HOOK_ADDRESS
    };
  }

  for (const [name, address] of Object.entries(DEPLOYED)) {
    if (!address || !ethers.isAddress(address)) {
      throw new Error(`${name} deployment address is required; set DAIO_DEPLOYMENT_FILE or DAIO_*_ADDRESS env vars`);
    }
  }
  if (!DEPLOYER || !ethers.isAddress(DEPLOYER)) throw new Error("DAIO_DEPLOYER_ADDRESS or deployment.deployer is required");
}

function sortitionScore(phase, requestId, participant, subject, randomness) {
  return (
    BigInt(
      ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "uint256", "address", "address", "bytes32"],
          [phase, requestId, participant, subject, randomness]
        )
      )
    ) % SCALE
  );
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest();
}

function bn32(value) {
  return value.toArrayLike(Buffer, "be", 32);
}

function pointBytes(point) {
  return Buffer.concat([Buffer.from([point.getY().isOdd() ? 3 : 2]), bn32(point.getX())]);
}

function bnToBigInt(value) {
  return BigInt(`0x${bn32(value).toString("hex")}`);
}

function hashToTryAndIncrement(publicKeyPoint, message) {
  const base = Buffer.concat([Buffer.from([254, 1]), pointBytes(publicKeyPoint), Buffer.from(message)]);
  for (let counter = 0; counter < 256; counter++) {
    const x = new BN(sha256(Buffer.concat([base, Buffer.from([counter])])));
    try {
      return SECP256K1.curve.pointFromX(x, false);
    } catch {
      // Try-and-increment keeps looking until the x coordinate maps to the curve.
    }
  }
  throw new Error("No valid VRF hash point was found");
}

function hashPoints(hashPoint, gamma, uPoint, vPoint) {
  return new BN(
    sha256(Buffer.concat([Buffer.from([254, 2]), pointBytes(hashPoint), pointBytes(gamma), pointBytes(uPoint), pointBytes(vPoint)])).subarray(0, 16)
  );
}

function privateKeyFor(index) {
  return new BN(index + 1);
}

function publicKeyFor(privateKey) {
  const publicKey = SECP256K1.g.mul(privateKey);
  return [bnToBigInt(publicKey.getX()), bnToBigInt(publicKey.getY())];
}

function realVrfProof(privateKey, message) {
  const publicKeyPoint = SECP256K1.g.mul(privateKey);
  const hashPoint = hashToTryAndIncrement(publicKeyPoint, ethers.getBytes(message));
  const gamma = hashPoint.mul(privateKey);
  const nonce = new BN(sha256(Buffer.concat([Buffer.from("DAIO test VRF nonce"), bn32(privateKey), Buffer.from(ethers.getBytes(message))])))
    .umod(SECP256K1_N.subn(1))
    .addn(1);
  const uPoint = SECP256K1.g.mul(nonce);
  const vPoint = hashPoint.mul(nonce);
  const c = hashPoints(hashPoint, gamma, uPoint, vPoint);
  const s = nonce.add(c.mul(privateKey)).umod(SECP256K1_N);
  return [bnToBigInt(gamma.getX()), bnToBigInt(gamma.getY()), bnToBigInt(c), bnToBigInt(s)];
}

async function proofForDeployedCoordinator(contracts, privateKey, requestId, phase, epoch, reviewer, target, phaseStartedBlock, finalityFactor) {
  const targetAddress = target ? target.address : ethers.ZeroAddress;
  const publicKey = publicKeyFor(privateKey);
  const message = await contracts.vrfCoordinator.messageFor(
    DEPLOYED.core,
    requestId,
    phase,
    epoch,
    reviewer.address,
    targetAddress,
    phaseStartedBlock,
    finalityFactor
  );
  const proof = realVrfProof(privateKey, message);
  expect(await contracts.vrfVerifier.verify(publicKey, proof, message)).to.equal(true);

  const randomness = await contracts.vrfCoordinator.randomness(
    publicKey,
    proof,
    DEPLOYED.core,
    requestId,
    phase,
    epoch,
    reviewer.address,
    targetAddress,
    phaseStartedBlock,
    finalityFactor
  );
  return { proof, score: sortitionScore(phase, requestId, reviewer.address, targetAddress, randomness) };
}

async function impersonate(address) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await network.provider.request({
    method: "hardhat_setBalance",
    params: [address, "0x8AC7230489E80000"]
  });
  return ethers.getSigner(address);
}

async function attachDeployed() {
  return {
    usdaio: await ethers.getContractAt("USDAIOToken", DEPLOYED.usdaio),
    stakeVault: await ethers.getContractAt("StakeVault", DEPLOYED.stakeVault),
    reviewerRegistry: await ethers.getContractAt("ReviewerRegistry", DEPLOYED.reviewerRegistry),
    reputationLedger: await ethers.getContractAt("ReputationLedger", DEPLOYED.reputationLedger),
    commitReveal: await ethers.getContractAt("DAIOCommitRevealManager", DEPLOYED.commitReveal),
    priorityQueue: await ethers.getContractAt("DAIOPriorityQueue", DEPLOYED.priorityQueue),
    vrfVerifier: await ethers.getContractAt("FRAINVRFVerifier", DEPLOYED.vrfVerifier),
    vrfCoordinator: await ethers.getContractAt("DAIOVRFCoordinator", DEPLOYED.vrfCoordinator),
    core: await ethers.getContractAt("DAIOCore", DEPLOYED.core),
    roundLedger: await ethers.getContractAt("DAIORoundLedger", DEPLOYED.roundLedger),
    erc8004Adapter: await ethers.getContractAt("ERC8004Adapter", DEPLOYED.erc8004Adapter),
    acceptedTokenRegistry: await ethers.getContractAt("AcceptedTokenRegistry", DEPLOYED.acceptedTokenRegistry),
    swapAdapter: await ethers.getContractAt("UniswapV4SwapAdapter", DEPLOYED.swapAdapter),
    paymentRouter: await ethers.getContractAt("PaymentRouter", DEPLOYED.paymentRouter),
    ensVerifier: await ethers.getContractAt("ENSVerifier", DEPLOYED.ensVerifier),
    autoConvertHook: await ethers.getContractAt("DAIOAutoConvertHook", DEPLOYED.autoConvertHook)
  };
}

function mockCoordinatorRandomness(fixture, requestId, phase, epoch, reviewer, targetAddress, phaseStartedBlock, finalityFactor) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256[2]", "uint256[4]", "address", "uint256", "bytes32", "uint256", "address", "address", "uint256", "uint256"],
      [
        fixture.chainId,
        fixture.vrfPublicKey,
        fixture.vrfProof,
        DEPLOYED.core,
        requestId,
        phase,
        epoch,
        reviewer.address,
        targetAddress,
        phaseStartedBlock,
        finalityFactor
      ]
    )
  );
}

async function sortitionPass(fixture, requestId, phase, epoch, reviewer, target, phaseStartedBlock, finalityFactor) {
  const targetAddress = target ? target.address : ethers.ZeroAddress;
  const randomness = fixture.useOnchainSortition
    ? await fixture.vrfCoordinator.randomness(
        fixture.vrfPublicKey,
        fixture.vrfProof,
        DEPLOYED.core,
        requestId,
        phase,
        epoch,
        reviewer.address,
        targetAddress,
        phaseStartedBlock,
        finalityFactor
      )
    : mockCoordinatorRandomness(fixture, requestId, phase, epoch, reviewer, targetAddress, phaseStartedBlock, finalityFactor);
  return sortitionScore(phase, requestId, reviewer.address, targetAddress, randomness) < ELECTION_DIFFICULTY;
}

async function findReviewCommitteeForPhase(fixture, requestId, reviewPhaseStartedBlock) {
  const lifecycle = await fixture.core.getRequestLifecycle(requestId);
  const selected = [];

  for (const reviewer of fixture.reviewers) {
    const passes = await sortitionPass(
      fixture,
      requestId,
      REVIEW_SORTITION,
      lifecycle.committeeEpoch,
      reviewer,
      null,
      reviewPhaseStartedBlock,
      2
    );
    if (passes) selected.push(reviewer);
    if (selected.length === FAST_REVIEW_QUORUM) return selected;
  }
  throw new Error(`Only ${selected.length} reviewers passed Fast review sortition`);
}

async function review(commitReveal, requestId, reviewer, score, uri, label, vrfProof) {
  const seed = BigInt(ethers.id(`${label}:deployed-review`));
  const reportHash = ethers.id(`${label}:deployed-report`);
  const resultHash = await commitReveal.hashReviewReveal(requestId, reviewer.address, score, reportHash, uri);
  await commitReveal.connect(reviewer).commitReview(requestId, resultHash, seed, vrfProof);
  return { score, reportHash, uri, seed };
}

async function audit(commitReveal, requestId, auditor, targets, scores, label, targetProofs = []) {
  const seed = BigInt(ethers.id(`${label}:deployed-audit`));
  const targetAddresses = targets.map((target) => target.address);
  const resultHash = await commitReveal.hashAuditReveal(requestId, auditor.address, targetAddresses, scores);
  await commitReveal.connect(auditor).commitAudit(requestId, resultHash, seed, targetProofs);
  return { targets: targetAddresses, scores, seed };
}

describeDeployedFork("Sepolia deployed-address fork E2E", function () {
  this.timeout(600000);

  beforeEach(async function () {
    loadDeployment();
    const blockNumber = FORK_BLOCK && (!DEPLOYMENT_MIN_FORK_BLOCK || FORK_BLOCK >= DEPLOYMENT_MIN_FORK_BLOCK) ? FORK_BLOCK : undefined;
    await network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: FORK_URL, ...(blockNumber ? { blockNumber } : {}) } }]
    });
  });

  it("verifies the deployed Sepolia wiring without replacing contracts", async function () {
    for (const address of [...Object.values(SEPOLIA), ...Object.values(DEPLOYED)]) {
      expect(await ethers.provider.getCode(address), address).to.not.equal("0x");
    }

    const contracts = await attachDeployed();

    expect(await contracts.usdaio.owner()).to.equal(DEPLOYER);
    expect(await contracts.core.stakeVault()).to.equal(DEPLOYED.stakeVault);
    expect(await contracts.vrfCoordinator.verifier()).to.equal(DEPLOYED.vrfVerifier);
    expect(await contracts.stakeVault.core()).to.equal(DEPLOYED.core);
    expect(await contracts.roundLedger.core()).to.equal(DEPLOYED.core);
    expect(await contracts.reviewerRegistry.core()).to.equal(DEPLOYED.core);
    expect(await contracts.reviewerRegistry.ensVerifier()).to.equal(DEPLOYED.ensVerifier);
    expect(await contracts.reviewerRegistry.erc8004Adapter()).to.equal(DEPLOYED.erc8004Adapter);
    expect(await contracts.reputationLedger.core()).to.equal(DEPLOYED.core);
    expect(await contracts.reputationLedger.erc8004Adapter()).to.equal(DEPLOYED.erc8004Adapter);
    expect(await contracts.erc8004Adapter.identityRegistry()).to.equal(SEPOLIA.erc8004IdentityRegistry);
    expect(await contracts.erc8004Adapter.reputationRegistry()).to.equal(SEPOLIA.erc8004ReputationRegistry);
    expect(await contracts.ensVerifier.registry()).to.equal(SEPOLIA.ensRegistry);
    expect(await contracts.paymentRouter.core()).to.equal(DEPLOYED.core);
    expect(await contracts.paymentRouter.usdaio()).to.equal(DEPLOYED.usdaio);
    expect(await contracts.paymentRouter.acceptedTokenRegistry()).to.equal(DEPLOYED.acceptedTokenRegistry);
    expect(await contracts.paymentRouter.swapAdapter()).to.equal(DEPLOYED.swapAdapter);
    expect(await contracts.acceptedTokenRegistry.acceptedTokens(DEPLOYED.usdaio)).to.equal(true);
    expect(await contracts.acceptedTokenRegistry.acceptedTokens(SEPOLIA.usdc)).to.equal(true);
    expect(await contracts.acceptedTokenRegistry.acceptedTokens(ethers.ZeroAddress)).to.equal(true);
    expect(await contracts.swapAdapter.paymentRouter()).to.equal(DEPLOYED.paymentRouter);
    expect(await contracts.swapAdapter.universalRouter()).to.equal(SEPOLIA.universalRouter);
    expect(await contracts.swapAdapter.autoConvertHook()).to.equal(DEPLOYED.autoConvertHook);
    expect(await contracts.autoConvertHook.owner()).to.equal(DEPLOYER);
    expect(await contracts.autoConvertHook.paymentRouter()).to.equal(DEPLOYED.paymentRouter);
    expect(await contracts.autoConvertHook.usdaio()).to.equal(DEPLOYED.usdaio);
    expect(await contracts.autoConvertHook.intentWriters(DEPLOYED.swapAdapter)).to.equal(true);
    expect(await contracts.autoConvertHook.allowedRouters(SEPOLIA.universalRouter)).to.equal(true);
    expect(BigInt(DEPLOYED.autoConvertHook) & ((1n << 14n) - 1n)).to.equal(1n << 6n);
  });

  it("runs the request, review, audit, round-ledger, and accounting path on deployed contracts", async function () {
    const contracts = await attachDeployed();
    const owner = await impersonate(DEPLOYER);
    const signers = await ethers.getSigners();
    const requester = signers[1];
    const candidates = signers.slice(2, 7).map((signer, index) => ({
      signer,
      label: `reviewer-${index}`,
      vrfKey: privateKeyFor(index),
      vrfPublicKey: publicKeyFor(privateKeyFor(index))
    }));
    const finalityFactor = fastConfig().finalityFactor;

    await contracts.reviewerRegistry.connect(owner).setIdentityModules(ethers.ZeroAddress, ethers.ZeroAddress);
    await contracts.core.connect(owner).setTierConfig(FAST, fastConfig());
    const stake = ethers.parseEther("1000");

    const priorityFee = ethers.parseEther("1");
    const requestFunding = (await contracts.core.baseRequestFee()) + priorityFee;
    await contracts.usdaio.connect(owner).mint(requester.address, requestFunding);
    await contracts.usdaio.connect(requester).approve(DEPLOYED.paymentRouter, requestFunding);
    await contracts.paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://deployed-fork-proposal", ethers.id("deployed-fork-proposal"), ethers.id("deployed-fork-rubric"), DOMAIN_RESEARCH, FAST, priorityFee);

    const requestId = await contracts.paymentRouter.latestRequestByRequester(requester.address);
    let latest = await contracts.paymentRouter.latestRequestState(requester.address);
    expect(latest.requestId).to.equal(requestId);
    expect(latest.processing).to.equal(true);
    expect(latest.completed).to.equal(false);

    const startTx = await contracts.core.startNextRequest();
    const startReceipt = await startTx.wait();
    latest = await contracts.paymentRouter.latestRequestState(requester.address);
    expect(latest.status).to.equal(REVIEW_COMMIT);

    const reviewersBefore = await contracts.reviewerRegistry.getReviewers();
    for (const [index, candidate] of candidates.entries()) {
      const reviewer = candidate.signer;
      await contracts.usdaio.connect(owner).mint(reviewer.address, stake);
      await contracts.usdaio.connect(reviewer).approve(DEPLOYED.stakeVault, stake);
      await contracts.reviewerRegistry
        .connect(reviewer)
        .registerReviewer(`${reviewer.address}.deployed.daio.eth`, ethers.keccak256(ethers.toUtf8Bytes(reviewer.address)), 10_001 + index, DOMAIN_RESEARCH, candidate.vrfPublicKey, stake);
    }
    expect(await contracts.reviewerRegistry.getReviewers()).to.deep.equal([...reviewersBefore, ...candidates.map((candidate) => candidate.signer.address)]);

    const lifecycleAfterStart = await contracts.core.getRequestLifecycle(requestId);
    const reviewPhaseStartedBlock = BigInt(startReceipt.blockNumber);
    const selected = [];
    for (const candidate of candidates) {
      const reviewSelection = await proofForDeployedCoordinator(
        contracts,
        candidate.vrfKey,
        requestId,
        REVIEW_SORTITION,
        lifecycleAfterStart.committeeEpoch,
        candidate.signer,
        null,
        reviewPhaseStartedBlock,
        finalityFactor
      );
      if (reviewSelection.score < ELECTION_DIFFICULTY) {
        selected.push({ ...candidate, reviewProof: reviewSelection.proof });
      }
      if (selected.length === FAST_REVIEW_QUORUM) break;
    }
    expect(selected.length).to.equal(FAST_REVIEW_QUORUM);

    const reviewScores = [8000, 7000, 6000];
    const reviewCommits = [];
    for (let i = 0; i < selected.length; i++) {
      reviewCommits.push(
        await review(contracts.commitReveal, requestId, selected[i].signer, reviewScores[i], `ipfs://deployed-review-${i}`, selected[i].label, selected[i].reviewProof)
      );
    }
    expect(await contracts.commitReveal.getReviewParticipants(requestId, 0)).to.deep.equal(selected.map((reviewer) => reviewer.signer.address));

    for (let i = 0; i < selected.length; i++) {
      const revealTx = await contracts.commitReveal
        .connect(selected[i].signer)
        .revealReview(requestId, reviewCommits[i].score, reviewCommits[i].reportHash, reviewCommits[i].uri, reviewCommits[i].seed);
      await revealTx.wait();
    }

    const auditCommits = [];
    for (let i = 0; i < selected.length; i++) {
      const auditor = selected[i];
      const targets = selected.filter((target) => target.signer.address !== auditor.signer.address).map((target) => target.signer);
      const scores = targets.map((target) => (target.address === selected[0].signer.address ? 9000 : 7000));
      auditCommits.push(await audit(contracts.commitReveal, requestId, auditor.signer, targets, scores, auditor.label));
    }
    expect(await contracts.commitReveal.getAuditParticipants(requestId, 0)).to.deep.equal(selected.map((reviewer) => reviewer.signer.address));

    for (let i = 0; i < selected.length; i++) {
      await contracts.commitReveal.connect(selected[i].signer).revealAudit(requestId, auditCommits[i].targets, auditCommits[i].scores, auditCommits[i].seed);
    }

    const lifecycle = await contracts.core.getRequestLifecycle(requestId);
    const attempt = lifecycle.retryCount;
    expect(lifecycle.status).to.equal(FINALIZED);

    const round0 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_REVIEW);
    const round1 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_AUDIT_CONSENSUS);
    const round2 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_REPUTATION_FINAL);
    const firstRound2 = await contracts.roundLedger.getReviewerRoundScore(requestId, attempt, ROUND_REPUTATION_FINAL, selected[0].signer.address);
    const firstAccounting = await contracts.roundLedger.getReviewerRoundAccounting(requestId, attempt, ROUND_REPUTATION_FINAL, selected[0].signer.address);

    expect(round0.score).to.equal(7000n);
    expect(round0.closed).to.equal(true);
    expect(round1.score).to.be.gt(0n);
    expect(round1.closed).to.equal(true);
    expect(round2.coverage).to.equal(10000n);
    expect(round2.score).to.be.gt(0n);
    expect(round2.closed).to.equal(true);
    expect(firstRound2.reputationScore).to.equal(10000n);
    expect(firstAccounting.reward).to.be.gt(0n);

    latest = await contracts.paymentRouter.latestRequestState(requester.address);
    expect(latest.completed).to.equal(true);
  });
});
