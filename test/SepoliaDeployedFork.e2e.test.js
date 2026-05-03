const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const crypto = require("crypto");
const { ec: EC } = require("elliptic");
const BN = require("bn.js");

const RUN_DEPLOYED_FORK = process.env.RUN_SEPOLIA_DEPLOYED_FORK === "true";
const describeDeployedFork = RUN_DEPLOYED_FORK ? describe : describe.skip;
const FORK_URL = process.env.SEPOLIA_RPC_URL || process.env.HARDHAT_FORK_URL || "https://sepolia.drpc.org";
const FORK_BLOCK = Number(process.env.SEPOLIA_FORK_BLOCK || "10778505");

const DEPLOYER = "0x2f149CaA0e931e13f6F32bd3E46eFc6e96bcC36A";
const DOMAIN_RESEARCH = 1;
const FAST = 0;
const REVIEW_COMMIT = 2n;
const FINALIZED = 6n;
const SCALE = 10000n;
const ROUND_REVIEW = 0;
const ROUND_AUDIT_CONSENSUS = 1;
const ROUND_REPUTATION_FINAL = 2;
const ELECTION_DIFFICULTY = 10000n;
const REVIEW_SORTITION = ethers.id("DAIO_REVIEW_SORTITION");
const AUDIT_SORTITION = ethers.id("DAIO_AUDIT_SORTITION");
const SECP256K1 = new EC("secp256k1");
const SECP256K1_N = SECP256K1.curve.n;

function fastConfig() {
  return {
    reviewElectionDifficulty: Number(ELECTION_DIFFICULTY),
    auditElectionDifficulty: Number(ELECTION_DIFFICULTY),
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
    minorityThreshold: 1500,
    semanticStrikeThreshold: 3,
    protocolFaultSlashBps: 500,
    missedRevealSlashBps: 100,
    semanticSlashBps: 200,
    cooldownBlocks: 100,
    reviewCommitTimeout: 30 * 60,
    reviewRevealTimeout: 30 * 60,
    auditCommitTimeout: 30 * 60,
    auditRevealTimeout: 30 * 60
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

const DEPLOYED = {
  usdaio: "0x3bB1A142b5abE17e5B2e577fa83b5247b6532606",
  stakeVault: "0x9b790bf0bB552716dc8d3234DFf3e4a3A5a6a8F8",
  reviewerRegistry: "0x7e7Ea105168dd18293dC128eA43b3d1BE0000686",
  assignmentManager: "0xA77B2A24474F839616D9a1696D53861C8029E306",
  consensusScoring: "0xfEa92280128c4dc6d658F1D18b38019336ae452d",
  settlement: "0xde10633fEa33c0f56919d9eFa632294Bde6AA5A1",
  reputationLedger: "0xBe13def9be39A5235FEDAa1571296f3C384258Be",
  commitReveal: "0xBd2f6A66f4AD5162aE3eb564119C8325A660CD02",
  priorityQueue: "0x4e7179a751F09e643f27CAD157BF40d5e9915c79",
  vrfVerifier: "0x5E43cE1E1dE9a7C041463C189aA5c2dC975C10df",
  vrfCoordinator: "0x97dD41B2950C203bA75F0FD9189144047EF0B374",
  core: "0x41D1570eA26561C381FC94e61d1381826F45cD4d",
  roundLedger: "0x30D6A783716bC30aAF04cf1022d31627D00c6f9D",
  erc8004Adapter: "0xF89d23b89f3c4C514b90073A36cc9618E127c0eA",
  acceptedTokenRegistry: "0x449c80B3E923DB9CB8E2E592Ba3Ec5E4a19a49a7",
  swapAdapter: "0x42dfA56F457aAcc6243931534C08E99DEA4f6866",
  paymentRouter: "0x28e88241B4E887619E21869fDb835efD10B4bb80",
  ensVerifier: "0x87B674Ec26F8F8001E2FCfB25a47a93746760cc1",
  autoConvertHook: "0xc0f32B14f0529158dDceD48Bfd2558F0AB134040"
};

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
  expect(sortitionScore(phase, requestId, reviewer.address, targetAddress, randomness)).to.be.lt(ELECTION_DIFFICULTY);
  return proof;
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

async function findReviewPairForPhase(fixture, requestId, reviewPhaseStartedBlock) {
  const lifecycle = await fixture.core.getRequestLifecycle(requestId);
  const auditPhaseStartedBlock = BigInt(reviewPhaseStartedBlock) + 10n;

  for (let i = 0; i < fixture.reviewers.length; i++) {
    for (let j = 0; j < fixture.reviewers.length; j++) {
      if (i === j) continue;
      const first = fixture.reviewers[i];
      const second = fixture.reviewers[j];
      const firstReviewPass = await sortitionPass(
        fixture,
        requestId,
        REVIEW_SORTITION,
        lifecycle.committeeEpoch,
        first,
        null,
        reviewPhaseStartedBlock,
        2
      );
      if (!firstReviewPass) continue;
      const secondReviewPass = await sortitionPass(
        fixture,
        requestId,
        REVIEW_SORTITION,
        lifecycle.committeeEpoch,
        second,
        null,
        reviewPhaseStartedBlock,
        2
      );
      if (!secondReviewPass) continue;
      const firstAuditPass = await sortitionPass(
        fixture,
        requestId,
        AUDIT_SORTITION,
        lifecycle.auditEpoch,
        first,
        second,
        auditPhaseStartedBlock,
        2
      );
      if (!firstAuditPass) continue;
      const secondAuditPass = await sortitionPass(
        fixture,
        requestId,
        AUDIT_SORTITION,
        lifecycle.auditEpoch,
        second,
        first,
        auditPhaseStartedBlock,
        2
      );
      if (secondAuditPass) return [first, second];
    }
  }
  throw new Error("No reviewer pair passes review and audit sortition in this phase");
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
    await network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: FORK_URL, blockNumber: FORK_BLOCK } }]
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
    const [alice, bob] = signers.slice(2);
    const aliceVrfKey = privateKeyFor(0);
    const bobVrfKey = privateKeyFor(1);
    const aliceVrfPublicKey = publicKeyFor(aliceVrfKey);
    const bobVrfPublicKey = publicKeyFor(bobVrfKey);
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
    for (const [index, reviewer] of [alice, bob].entries()) {
      const publicKey = index === 0 ? aliceVrfPublicKey : bobVrfPublicKey;
      await contracts.usdaio.connect(owner).mint(reviewer.address, stake);
      await contracts.usdaio.connect(reviewer).approve(DEPLOYED.stakeVault, stake);
      await contracts.reviewerRegistry
        .connect(reviewer)
        .registerReviewer(`${reviewer.address}.deployed.daio.eth`, ethers.keccak256(ethers.toUtf8Bytes(reviewer.address)), 10_001 + index, DOMAIN_RESEARCH, publicKey, stake);
    }
    expect(await contracts.reviewerRegistry.getReviewers()).to.deep.equal([...reviewersBefore, alice.address, bob.address]);

    const lifecycleAfterStart = await contracts.core.getRequestLifecycle(requestId);
    const reviewPhaseStartedBlock = BigInt(startReceipt.blockNumber);
    const aliceReviewProof = await proofForDeployedCoordinator(
      contracts,
      aliceVrfKey,
      requestId,
      REVIEW_SORTITION,
      lifecycleAfterStart.committeeEpoch,
      alice,
      null,
      reviewPhaseStartedBlock,
      finalityFactor
    );
    const bobReviewProof = await proofForDeployedCoordinator(
      contracts,
      bobVrfKey,
      requestId,
      REVIEW_SORTITION,
      lifecycleAfterStart.committeeEpoch,
      bob,
      null,
      reviewPhaseStartedBlock,
      finalityFactor
    );

    const aliceReview = await review(contracts.commitReveal, requestId, alice, 8000, "ipfs://deployed-alice", "alice", aliceReviewProof);
    const bobReview = await review(contracts.commitReveal, requestId, bob, 6000, "ipfs://deployed-bob", "bob", bobReviewProof);
    expect(await contracts.commitReveal.getReviewParticipants(requestId, 0)).to.deep.equal([alice.address, bob.address]);

    await contracts.commitReveal.connect(alice).revealReview(requestId, aliceReview.score, aliceReview.reportHash, aliceReview.uri, aliceReview.seed);
    const bobRevealTx = await contracts.commitReveal.connect(bob).revealReview(requestId, bobReview.score, bobReview.reportHash, bobReview.uri, bobReview.seed);
    const bobRevealReceipt = await bobRevealTx.wait();
    const lifecycleAfterReview = await contracts.core.getRequestLifecycle(requestId);
    const auditPhaseStartedBlock = BigInt(bobRevealReceipt.blockNumber);
    expect(auditPhaseStartedBlock).to.equal(BigInt(bobRevealReceipt.blockNumber));
    expect(lifecycleAfterReview.auditEpoch).to.be.gt(0n);

    const aliceAudit = await audit(contracts.commitReveal, requestId, alice, [bob], [7000], "alice");
    const bobAudit = await audit(contracts.commitReveal, requestId, bob, [alice], [9000], "bob");
    expect(await contracts.commitReveal.getAuditParticipants(requestId, 0)).to.deep.equal([alice.address, bob.address]);

    await contracts.commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await contracts.commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);

    const lifecycle = await contracts.core.getRequestLifecycle(requestId);
    const attempt = lifecycle.retryCount;
    expect(lifecycle.status).to.equal(FINALIZED);

    const round0 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_REVIEW);
    const round1 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_AUDIT_CONSENSUS);
    const round2 = await contracts.roundLedger.getRoundAggregate(requestId, attempt, ROUND_REPUTATION_FINAL);
    const aliceRound2 = await contracts.roundLedger.getReviewerRoundScore(requestId, attempt, ROUND_REPUTATION_FINAL, alice.address);
    const aliceAccounting = await contracts.roundLedger.getReviewerRoundAccounting(requestId, attempt, ROUND_REPUTATION_FINAL, alice.address);

    expect(round0.score).to.equal(7000n);
    expect(round0.closed).to.equal(true);
    expect(round1.score).to.equal(8000n);
    expect(round1.closed).to.equal(true);
    expect(round2.coverage).to.equal(10000n);
    expect(round2.score).to.equal(8000n);
    expect(round2.closed).to.equal(true);
    expect(aliceRound2.reputationScore).to.equal(10000n);
    expect(aliceAccounting.reward).to.be.gt(0n);

    latest = await contracts.paymentRouter.latestRequestState(requester.address);
    expect(latest.completed).to.equal(true);
  });
});
