const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const vrfData = require("../lib/vrf-solidity/test/data.json");

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const STANDARD = 1;
const CRITICAL = 2;
const FINALIZED = 6n;
const QUEUED = 1n;
const REVIEW_COMMIT = 2n;
const REVIEW_REVEAL = 3n;
const AUDIT_COMMIT = 4n;
const AUDIT_REVEAL = 5n;
const UNRESOLVED = 9n;
const CANCELLED = 7n;
const SCALE = 10000n;
const ROUND_REVIEW = 0;
const ROUND_AUDIT_CONSENSUS = 1;
const ROUND_REPUTATION_FINAL = 2;
const ELECTION_DIFFICULTY = 5000n;
const REVIEW_SORTITION = ethers.id("DAIO_REVIEW_SORTITION");

function tierConfig({
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
  semanticStrikeThreshold = 3,
  protocolFaultSlashBps,
  missedRevealSlashBps,
  semanticSlashBps,
  cooldownBlocks,
  reviewCommitTimeout,
  reviewRevealTimeout,
  auditCommitTimeout,
  auditRevealTimeout
}) {
  return {
    reviewElectionDifficulty: Number(ELECTION_DIFFICULTY),
    auditElectionDifficulty: Number(SCALE),
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
    semanticStrikeThreshold,
    protocolFaultSlashBps,
    missedRevealSlashBps,
    semanticSlashBps,
    cooldownBlocks,
    reviewCommitTimeout,
    reviewRevealTimeout,
    auditCommitTimeout,
    auditRevealTimeout
  };
}

describe("DAIOCore", function () {
  async function deployFixture(maxActiveRequests = 1) {
    const signers = await ethers.getSigners();
    const [owner, treasury, requester] = signers;
    const reviewerSigners = signers.slice(3);
    const [alice, bob, carol] = reviewerSigners;

    const USDAIO = await ethers.getContractFactory("USDAIOToken");
    const usdaio = await USDAIO.deploy(owner.address);
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

    const MockVRFCoordinator = await ethers.getContractFactory("MockVRFCoordinator");
    const vrfCoordinator = await MockVRFCoordinator.deploy();
    await vrfCoordinator.waitForDeployment();

    const DAIOCore = await ethers.getContractFactory("DAIOCore");
    const core = await DAIOCore.deploy(
      treasury.address,
      await commitReveal.getAddress(),
      await priorityQueue.getAddress(),
      await vrfCoordinator.getAddress(),
      maxActiveRequests
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
    await stakeVault.setCoreOrSettlement(await core.getAddress());
    await stakeVault.setAuthorized(await reviewerRegistry.getAddress(), true);
    await reviewerRegistry.setCore(await core.getAddress());
    await reputationLedger.setCore(await core.getAddress());
    await reviewerRegistry.setReputationGate(await reputationLedger.getAddress(), 3, 3000, 7000);
    await commitReveal.setCore(await core.getAddress());
    await priorityQueue.setCore(await core.getAddress());

    await core.setTierConfig(
      FAST,
      tierConfig({
        reviewCommitQuorum: 2,
        reviewRevealQuorum: 2,
        auditCommitQuorum: 2,
        auditRevealQuorum: 2,
        auditTargetLimit: 1,
        minIncomingAudit: 1,
        auditCoverageQuorum: 7000,
        contributionThreshold: 1000,
        reviewEpochSize: 25,
        auditEpochSize: 25,
        finalityFactor: 2,
        maxRetries: 0,
        protocolFaultSlashBps: 500,
        missedRevealSlashBps: 100,
        semanticSlashBps: 200,
        cooldownBlocks: 100,
        reviewCommitTimeout: 30 * 60,
        reviewRevealTimeout: 30 * 60,
        auditCommitTimeout: 30 * 60,
        auditRevealTimeout: 30 * 60
      })
    );
    await core.setTierConfig(
      STANDARD,
      tierConfig({
        reviewCommitQuorum: 2,
        reviewRevealQuorum: 2,
        auditCommitQuorum: 2,
        auditRevealQuorum: 2,
        auditTargetLimit: 1,
        minIncomingAudit: 1,
        auditCoverageQuorum: 8000,
        contributionThreshold: 1500,
        reviewEpochSize: 50,
        auditEpochSize: 50,
        finalityFactor: 3,
        maxRetries: 1,
        protocolFaultSlashBps: 500,
        missedRevealSlashBps: 100,
        semanticSlashBps: 200,
        cooldownBlocks: 300,
        reviewCommitTimeout: 2 * 60 * 60,
        reviewRevealTimeout: 2 * 60 * 60,
        auditCommitTimeout: 2 * 60 * 60,
        auditRevealTimeout: 2 * 60 * 60
      })
    );
    await core.setTierConfig(
      CRITICAL,
      tierConfig({
        reviewCommitQuorum: 2,
        reviewRevealQuorum: 2,
        auditCommitQuorum: 2,
        auditRevealQuorum: 2,
        auditTargetLimit: 1,
        minIncomingAudit: 1,
        auditCoverageQuorum: 10000,
        contributionThreshold: 1000,
        reviewEpochSize: 25,
        auditEpochSize: 25,
        finalityFactor: 2,
        maxRetries: 0,
        protocolFaultSlashBps: 500,
        missedRevealSlashBps: 100,
        semanticSlashBps: 200,
        cooldownBlocks: 100,
        reviewCommitTimeout: 30 * 60,
        reviewRevealTimeout: 30 * 60,
        auditCommitTimeout: 30 * 60,
        auditRevealTimeout: 30 * 60
      })
    );

    const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
    const universalRouter = await MockUniversalRouter.deploy();
    await universalRouter.waitForDeployment();

    const AcceptedTokenRegistry = await ethers.getContractFactory("AcceptedTokenRegistry");
    const acceptedTokenRegistry = await AcceptedTokenRegistry.deploy(await usdaio.getAddress());
    await acceptedTokenRegistry.waitForDeployment();

    const UniswapV4SwapAdapter = await ethers.getContractFactory("UniswapV4SwapAdapter");
    const swapAdapter = await UniswapV4SwapAdapter.deploy(await universalRouter.getAddress());
    await swapAdapter.waitForDeployment();

    const PaymentRouter = await ethers.getContractFactory("PaymentRouter");
    const paymentRouter = await PaymentRouter.deploy(
      await usdaio.getAddress(),
      await core.getAddress(),
      await acceptedTokenRegistry.getAddress(),
      await swapAdapter.getAddress()
    );
    await paymentRouter.waitForDeployment();
    await core.setPaymentRouter(await paymentRouter.getAddress());
    await swapAdapter.setPaymentRouter(await paymentRouter.getAddress());

    const vrfVector = vrfData.verify.valid[0];
    const vrfPublicKey = Array.from(await vrfVerifier.decodePoint(vrfVector.pub));
    const vrfProof = Array.from(await vrfVerifier.decodeProof(vrfVector.pi));

    const reviewerStake = ethers.parseEther("1000");
    const requesterFunds = ethers.parseEther("1000");

    for (const reviewer of reviewerSigners) {
      await usdaio.mint(reviewer.address, reviewerStake);
      await usdaio.connect(reviewer).approve(await stakeVault.getAddress(), reviewerStake);
    }

    await usdaio.mint(requester.address, requesterFunds);
    await usdaio.connect(requester).approve(await paymentRouter.getAddress(), requesterFunds);

    for (let i = 0; i < reviewerSigners.length; i++) {
      const reviewer = reviewerSigners[i];
      const ensName = `reviewer-${i}.daio.eth`;
      await reviewerRegistry
        .connect(reviewer)
        .registerReviewer(ensName, ethers.id(ensName), 1001 + i, DOMAIN_RESEARCH, vrfPublicKey, reviewerStake);
    }

    return {
      owner,
      treasury,
      requester,
      alice,
      bob,
      carol,
      reviewers: reviewerSigners,
      usdaio,
      stakeVault,
      reviewerRegistry,
      reputationLedger,
      commitReveal,
      paymentRouter,
      priorityQueue,
      vrfCoordinator,
      vrfProof,
      roundLedger,
      core
    };
  }

  async function createRequest(paymentRouter, requester, tier, priorityFee = 0n, label = "proposal-1") {
    const tx = await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO(`ipfs://${label}`, ethers.id(label), ethers.id(`${label}:rubric`), DOMAIN_RESEARCH, tier, priorityFee);
    await tx.wait();
    return paymentRouter.latestRequestByRequester(requester.address);
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

  async function sortitionPass(fixture, requestId, phase, epoch, reviewer, target, phaseStartedBlock, finalityFactor) {
    const targetAddress = target ? target.address : ethers.ZeroAddress;
    const publicKey = Array.from(await fixture.reviewerRegistry.vrfPublicKey(reviewer.address));
    const randomness = await fixture.vrfCoordinator.randomness(
      publicKey,
      fixture.vrfProof,
      await fixture.core.getAddress(),
      requestId,
      phase,
      epoch,
      reviewer.address,
      targetAddress,
      phaseStartedBlock,
      finalityFactor
    );
    return sortitionScore(phase, requestId, reviewer.address, targetAddress, randomness) < ELECTION_DIFFICULTY;
  }

  async function findReviewPairForCurrentPhase(fixture, requestId, reviewers, finalityFactor = 2n, requireNewFrom = undefined) {
    const lifecycle = await fixture.core.getRequestLifecycle(requestId);
    const reviewPhaseStartedBlock = BigInt(await ethers.provider.getBlockNumber());

    for (let i = 0; i < reviewers.length; i++) {
      for (let j = 0; j < reviewers.length; j++) {
        if (i === j) continue;
        const first = reviewers[i];
        const second = reviewers[j];
        const firstReviewPass = await sortitionPass(
          fixture,
          requestId,
          REVIEW_SORTITION,
          lifecycle.committeeEpoch,
          first,
          null,
          reviewPhaseStartedBlock,
          finalityFactor
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
          finalityFactor
        );
        if (!secondReviewPass) continue;

        if (!requireNewFrom || !requireNewFrom.has(first.address) || !requireNewFrom.has(second.address)) {
          return [first, second];
        }
      }
    }
    throw new Error("No reviewer pair passes review sortition in this phase");
  }

  async function findNonSelectedReviewer(fixture, requestId, reviewers, finalityFactor = 2n) {
    const lifecycle = await fixture.core.getRequestLifecycle(requestId);
    const phaseStartedBlock = BigInt(await ethers.provider.getBlockNumber());
    for (const reviewer of reviewers) {
      const pass = await sortitionPass(
        fixture,
        requestId,
        REVIEW_SORTITION,
        lifecycle.committeeEpoch,
        reviewer,
        null,
        phaseStartedBlock,
        finalityFactor
      );
      if (!pass) return reviewer;
    }
    throw new Error("Every reviewer passed review sortition in this phase");
  }

  async function buildReviewCommit(commitReveal, requestId, reviewer, proposalScore, reportURI, saltLabel) {
    const seed = BigInt(ethers.id(`${saltLabel}:review`));
    const reportHash = ethers.id(`${reportURI}:hash`);
    const resultHash = await commitReveal.hashReviewReveal(requestId, reviewer.address, proposalScore, reportHash, reportURI);
    return { proposalScore, reportHash, reportURI, seed, resultHash };
  }

  async function buildAuditCommit(commitReveal, requestId, auditor, targetSigners, scores, saltLabel) {
    const seed = BigInt(ethers.id(`${saltLabel}:audit`));
    const targets = targetSigners.map((signer) => signer.address);
    const resultHash = await commitReveal.hashAuditReveal(requestId, auditor.address, targets, scores);
    return { targets, scores, seed, resultHash };
  }

  async function commitReview(commitReveal, reviewer, requestId, review, vrfProof) {
    await commitReveal.connect(reviewer).commitReview(requestId, review.resultHash, review.seed, vrfProof);
  }

  async function commitAudit(commitReveal, auditor, requestId, audit) {
    await commitReveal.connect(auditor).commitAudit(requestId, audit.resultHash, audit.seed, []);
  }

  async function enterAuditCommitWithSelectedPair(fixture, requestId) {
    const { commitReveal, vrfProof, core } = fixture;
    await core.startNextRequest();
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers);
    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", `alice-${requestId}`);
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", `bob-${requestId}`);

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);

    expect(await commitReveal.getReviewParticipants(requestId, 0)).to.deep.equal([alice.address, bob.address]);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);

    return { alice, bob, aliceReview, bobReview };
  }

  async function finishAuditWithPair(fixture, requestId, alice, bob, aliceScoreForBob = 7000, bobScoreForAlice = 9000) {
    const { commitReveal, vrfProof } = fixture;
    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob], [aliceScoreForBob], `alice-audit-${requestId}-${aliceScoreForBob}`);
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice], [bobScoreForAlice], `bob-audit-${requestId}-${bobScoreForAlice}`);

    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);

    return { aliceAudit, bobAudit };
  }

  it("enumerates every registered reviewer in registration order", async function () {
    const { reviewerRegistry, reviewers } = await deployFixture();
    const expected = reviewers.map((reviewer) => reviewer.address);

    expect(await reviewerRegistry.reviewerCount()).to.equal(BigInt(expected.length));
    expect(await reviewerRegistry.reviewerAt(0)).to.equal(expected[0]);
    expect(await reviewerRegistry.getReviewers()).to.deep.equal(expected);
  });

  it("runs the post-audit scoring and settlement path", async function () {
    const fixture = await deployFixture();
    const { requester, usdaio, stakeVault, commitReveal, paymentRouter, vrfProof, core, reputationLedger, roundLedger } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers);

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);

    const previewRound0 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_REVIEW);
    const previewAliceRound0 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_REVIEW, alice.address);
    expect(previewRound0.score).to.equal(7000n);
    expect(previewRound0.closed).to.equal(true);
    expect(previewAliceRound0.score).to.equal(8000n);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob], [7000], "alice");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice], [9000], "bob");

    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);

    expect(await commitReveal.getAuditParticipants(requestId, 0)).to.deep.equal([alice.address, bob.address]);

    const aliceBalanceBefore = await usdaio.balanceOf(alice.address);
    const bobBalanceBefore = await usdaio.balanceOf(bob.address);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);

    const lifecycle = await core.getRequestLifecycle(requestId);
    expect(lifecycle.status).to.equal(FINALIZED);
    expect(lifecycle.lowConfidence).to.equal(false);
    const latestState = await paymentRouter.latestRequestState(requester.address);
    expect(latestState.requestId).to.equal(requestId);
    expect(latestState.status).to.equal(FINALIZED);
    expect(latestState.processing).to.equal(false);
    expect(latestState.completed).to.equal(true);

    expect(await usdaio.balanceOf(alice.address)).to.be.gt(aliceBalanceBefore);
    expect(await usdaio.balanceOf(bob.address)).to.be.gt(bobBalanceBefore);
    expect(await stakeVault.treasuryBalance()).to.be.gte(ethers.parseEther("10"));

    expect((await core.getRequestLifecycle(requestId)).retryCount).to.equal(0n);
    const round0 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_REVIEW);
    expect(round0.score).to.equal(7000n);
    expect(round0.totalWeight).to.equal(20000n);
    expect(round0.closed).to.equal(true);
    expect(round0.aborted).to.equal(false);

    const aliceRound0 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_REVIEW, alice.address);
    expect(aliceRound0.score).to.equal(8000n);
    expect(aliceRound0.weight).to.equal(10000n);
    expect(aliceRound0.weightedScore).to.equal(8000n);
    expect(aliceRound0.available).to.equal(true);

    const round1 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_AUDIT_CONSENSUS);
    expect(round1.score).to.equal(8000n);
    expect(round1.totalWeight).to.equal(17777n);
    expect(round1.coverage).to.equal(10000n);
    expect(round1.closed).to.equal(true);

    const aliceRound1 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_AUDIT_CONSENSUS, alice.address);
    expect(aliceRound1.auditScore).to.equal(9000n);
    expect(aliceRound1.weight).to.equal(10000n);

    const bobRound1 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_AUDIT_CONSENSUS, bob.address);
    expect(bobRound1.auditScore).to.equal(7000n);
    expect(bobRound1.weight).to.equal(7777n);

    const round2 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_REPUTATION_FINAL);
    expect(round2.score).to.equal(8000n);
    expect(round2.totalWeight).to.equal(17777n);
    expect(round2.coverage).to.equal(10000n);
    expect(round2.confidence).to.equal(9000n);
    expect(round2.closed).to.equal(true);

    const aliceRound2 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_REPUTATION_FINAL, alice.address);
    expect(aliceRound2.reputationScore).to.equal(10000n);
    expect(aliceRound2.weight).to.equal(10000n);

    const aliceAccounting = await roundLedger.getReviewerRoundAccounting(requestId, 0, ROUND_REPUTATION_FINAL, alice.address);
    expect(aliceAccounting.reward).to.be.gt(0n);
    expect(aliceAccounting.slashed).to.equal(0n);

    const aliceReputation = await reputationLedger.reputations(alice.address);
    expect(aliceReputation.samples).to.equal(1n);
    expect(aliceReputation.finalContribution).to.equal(10000n);
  });

  it("uses ReputationLedger as the round 2 final-score weight source", async function () {
    const fixture = await deployFixture();
    const { owner, requester, paymentRouter, reputationLedger, reviewerRegistry, core, roundLedger } = fixture;

    const requestId = await createRequest(paymentRouter, requester, FAST, 0n, "reputation-weighted");
    const { alice, bob } = await enterAuditCommitWithSelectedPair(fixture, requestId);

    await reputationLedger.setCore(owner.address);
    await reputationLedger.record(
      alice.address,
      await reviewerRegistry.agentId(alice.address),
      1000,
      1000,
      1000,
      1000,
      false,
      10000,
      false,
      "ipfs://seed-low-reputation",
      ethers.id("seed-low-reputation")
    );
    await reputationLedger.setCore(await core.getAddress());

    await finishAuditWithPair(fixture, requestId, alice, bob);

    const round1 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_AUDIT_CONSENSUS);
    const round2 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_REPUTATION_FINAL);
    const aliceRound2 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_REPUTATION_FINAL, alice.address);
    const bobRound2 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_REPUTATION_FINAL, bob.address);

    expect(round1.score).to.equal(8000n);
    expect(round2.score).to.equal(6000n);
    expect(aliceRound2.reputationScore).to.equal(3250n);
    expect(aliceRound2.weight).to.equal(3250n);
    expect(bobRound2.reputationScore).to.equal(10000n);
    expect(bobRound2.weight).to.equal(7777n);
  });

  it("records semantic slashing in round 2 accounting", async function () {
    const fixture = await deployFixture();
    const { requester, paymentRouter, reviewerRegistry, core, roundLedger } = fixture;
    await core.setTierConfig(
      FAST,
      tierConfig({
        reviewCommitQuorum: 2,
        reviewRevealQuorum: 2,
        auditCommitQuorum: 2,
        auditRevealQuorum: 2,
        auditTargetLimit: 1,
        minIncomingAudit: 1,
        auditCoverageQuorum: 7000,
        contributionThreshold: 1000,
        reviewEpochSize: 25,
        auditEpochSize: 25,
        finalityFactor: 2,
        maxRetries: 0,
        semanticStrikeThreshold: 1,
        protocolFaultSlashBps: 500,
        missedRevealSlashBps: 100,
        semanticSlashBps: 200,
        cooldownBlocks: 100,
        reviewCommitTimeout: 30 * 60,
        reviewRevealTimeout: 30 * 60,
        auditCommitTimeout: 30 * 60,
        auditRevealTimeout: 30 * 60
      })
    );

    const requestId = await createRequest(paymentRouter, requester, FAST, 0n, "semantic-slash");
    const { alice, bob } = await enterAuditCommitWithSelectedPair(fixture, requestId);
    const bobStakeBefore = (await reviewerRegistry.getReviewer(bob.address)).stake;

    await finishAuditWithPair(fixture, requestId, alice, bob, 0, 9000);

    const bobStakeAfter = (await reviewerRegistry.getReviewer(bob.address)).stake;
    const bobAccounting = await roundLedger.getReviewerRoundAccounting(requestId, 0, ROUND_REPUTATION_FINAL, bob.address);
    const bobRound2 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_REPUTATION_FINAL, bob.address);

    expect(bobRound2.weight).to.equal(0n);
    expect(bobAccounting.semanticFault).to.equal(true);
    expect(bobAccounting.slashed).to.equal(bobStakeBefore - bobStakeAfter);
    expect(bobAccounting.slashed).to.be.gt(0n);
    expect(bobAccounting.slashCount).to.equal(1n);
  });

  it("starts the highest priority queued request first", async function () {
    const { requester, paymentRouter, core } = await deployFixture();

    await createRequest(paymentRouter, requester, FAST, ethers.parseEther("1"), "p1");
    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://p2", ethers.id("p2"), ethers.id("p2:rubric"), DOMAIN_RESEARCH, FAST, ethers.parseEther("5"));

    await core.startNextRequest();

    expect((await core.getRequestLifecycle(1)).status).to.equal(QUEUED);
    expect((await core.getRequestLifecycle(2)).status).to.equal(REVIEW_COMMIT);
  });

  it("rejects non-full-audit tier configurations", async function () {
    const { core } = await deployFixture();
    const validConfig = tierConfig({
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
      maxRetries: 0,
      protocolFaultSlashBps: 500,
      missedRevealSlashBps: 100,
      semanticSlashBps: 200,
      cooldownBlocks: 100,
      reviewCommitTimeout: 30 * 60,
      reviewRevealTimeout: 30 * 60,
      auditCommitTimeout: 30 * 60,
      auditRevealTimeout: 30 * 60
    });

    await expect(core.setTierConfig(FAST, { ...validConfig, auditElectionDifficulty: 9999 })).to.be.revertedWithCustomError(core, "BadConfig");
    await expect(core.setTierConfig(FAST, { ...validConfig, auditTargetLimit: 1 })).to.be.revertedWithCustomError(core, "BadConfig");
    await expect(core.setTierConfig(FAST, { ...validConfig, auditCommitQuorum: 2 })).to.be.revertedWithCustomError(core, "BadConfig");
  });

  it("enforces maxActiveRequests as an on-chain permissionless cap", async function () {
    const { requester, paymentRouter, core } = await deployFixture();

    await createRequest(paymentRouter, requester, FAST, 0n, "cap-1");
    await createRequest(paymentRouter, requester, FAST, 0n, "cap-2");

    expect(await core.maxActiveRequests()).to.equal(1n);

    await core.startNextRequest();

    await expect(core.startNextRequest()).to.be.revertedWithCustomError(core, "TooEarly");
  });

  it("allows multiple active requests up to the constructor cap", async function () {
    const { requester, paymentRouter, core } = await deployFixture(2);

    await createRequest(paymentRouter, requester, FAST, 0n, "cap-open-1");
    await createRequest(paymentRouter, requester, FAST, 0n, "cap-open-2");

    await core.startNextRequest();
    await core.startNextRequest();

    expect((await core.getRequestLifecycle(1)).status).to.equal(REVIEW_COMMIT);
    expect((await core.getRequestLifecycle(2)).status).to.equal(REVIEW_COMMIT);
  });

  it("caps over-quorum review joins even when more reviewers pass sortition", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = fixture;
    await core.setTierConfig(
      FAST,
      {
        ...tierConfig({
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
          maxRetries: 0,
          protocolFaultSlashBps: 500,
          missedRevealSlashBps: 100,
          semanticSlashBps: 200,
          cooldownBlocks: 100,
          reviewCommitTimeout: 30 * 60,
          reviewRevealTimeout: 30 * 60,
          auditCommitTimeout: 30 * 60,
          auditRevealTimeout: 30 * 60
        }),
        reviewElectionDifficulty: 10000,
        auditElectionDifficulty: 10000
      }
    );

    const requestId = await createRequest(paymentRouter, requester, FAST, 0n, "over-quorum");
    await core.startNextRequest();

    const reviewers = fixture.reviewers.slice(0, 4);
    for (let i = 0; i < reviewers.length; i++) {
      const review = await buildReviewCommit(
        commitReveal,
        requestId,
        reviewers[i],
        7000 + i,
        `ipfs://over-quorum-${i}`,
        `over-quorum-${i}`
      );
      await commitReview(commitReveal, reviewers[i], requestId, review, vrfProof);
    }

    const participants = await commitReveal.getReviewParticipants(requestId, 0);
    expect(participants).to.deep.equal(reviewers.slice(0, 3).map((reviewer) => reviewer.address));
    expect((await core.getRequestLifecycle(requestId)).status).to.equal(REVIEW_REVEAL);
    expect(await reviewerRegistry.requestLockedStake(requestId, reviewers[3].address)).to.equal(0n);
  });

  it("allows full-sortition review and audit commits without VRF proofs", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, core } = fixture;
    await core.setTierConfig(
      FAST,
      {
        ...tierConfig({
          reviewCommitQuorum: 4,
          reviewRevealQuorum: 4,
          auditCommitQuorum: 4,
          auditRevealQuorum: 4,
          auditTargetLimit: 3,
          minIncomingAudit: 3,
          auditCoverageQuorum: 7000,
          contributionThreshold: 1000,
          reviewEpochSize: 25,
          auditEpochSize: 25,
          finalityFactor: 2,
          maxRetries: 0,
          protocolFaultSlashBps: 500,
          missedRevealSlashBps: 100,
          semanticSlashBps: 200,
          cooldownBlocks: 100,
          reviewCommitTimeout: 30 * 60,
          reviewRevealTimeout: 30 * 60,
          auditCommitTimeout: 30 * 60,
          auditRevealTimeout: 30 * 60
        }),
        reviewElectionDifficulty: 10000,
        auditElectionDifficulty: 10000
      }
    );

    const requestId = await createRequest(paymentRouter, requester, FAST, 0n, "full-sortition");
    await core.startNextRequest();

    const reviewers = fixture.reviewers.slice(0, 4);
    const emptyReviewProof = [0n, 0n, 0n, 0n];
    const reviews = [];
    for (let i = 0; i < reviewers.length; i++) {
      const review = await buildReviewCommit(
        commitReveal,
        requestId,
        reviewers[i],
        7000 + i * 100,
        `ipfs://full-sortition-${i}`,
        `full-sortition-${i}`
      );
      reviews.push(review);
      await commitReview(commitReveal, reviewers[i], requestId, review, emptyReviewProof);
    }

    expect(await commitReveal.getReviewParticipants(requestId, 0)).to.deep.equal(reviewers.map((reviewer) => reviewer.address));
    expect((await core.getRequestLifecycle(requestId)).status).to.equal(REVIEW_REVEAL);

    for (let i = 0; i < reviewers.length; i++) {
      await commitReveal
        .connect(reviewers[i])
        .revealReview(requestId, reviews[i].proposalScore, reviews[i].reportHash, reviews[i].reportURI, reviews[i].seed);
    }

    expect((await core.getRequestLifecycle(requestId)).status).to.equal(AUDIT_COMMIT);

    const audits = [];
    for (let i = 0; i < reviewers.length; i++) {
      const targets = reviewers.filter((_, j) => j !== i);
      const audit = await buildAuditCommit(
        commitReveal,
        requestId,
        reviewers[i],
        targets,
        targets.map((_, j) => 8000 - j * 100),
        `full-sortition-audit-${i}`
      );
      audits.push(audit);
      await commitReveal.connect(reviewers[i]).commitAudit(requestId, audit.resultHash, audit.seed, []);
    }

    expect(await commitReveal.getAuditParticipants(requestId, 0)).to.deep.equal(reviewers.map((reviewer) => reviewer.address));

    for (let i = 0; i < reviewers.length; i++) {
      await commitReveal.connect(reviewers[i]).revealAudit(requestId, audits[i].targets, audits[i].scores, audits[i].seed);
    }

    const lifecycle = await core.getRequestLifecycle(requestId);
    expect(lifecycle.status).to.equal(FINALIZED);
    expect(lifecycle.lowConfidence).to.equal(false);
  });

  it("limits concurrently active requests to two", async function () {
    const { requester, paymentRouter, core } = await deployFixture(2);

    await createRequest(paymentRouter, requester, FAST, 0n, "active-1");
    await createRequest(paymentRouter, requester, FAST, ethers.parseEther("1"), "active-2");
    await createRequest(paymentRouter, requester, FAST, ethers.parseEther("2"), "active-3");

    await core.startNextRequest();
    await core.startNextRequest();

    await expect(core.startNextRequest()).to.be.revertedWithCustomError(core, "TooEarly");
    expect((await core.getRequestLifecycle(1)).status).to.equal(QUEUED);
  });

  it("slashes invalid VRF proofs without accepting the commit", async function () {
    const { requester, alice, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core, roundLedger } = await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const badProof = [...vrfProof];
    badProof[0] = 0n;
    const stakeBefore = (await reviewerRegistry.getReviewer(alice.address)).stake;

    await commitReveal.connect(alice).commitReview(requestId, aliceReview.resultHash, aliceReview.seed, badProof);

    const stakeAfter = (await reviewerRegistry.getReviewer(alice.address)).stake;
    const accounting = await roundLedger.getReviewerRoundAccounting(requestId, 0, ROUND_REVIEW, alice.address);
    expect(await commitReveal.getReviewParticipants(requestId, 0)).to.deep.equal([]);
    expect(stakeAfter).to.be.lt(stakeBefore);
    expect(accounting.slashed).to.equal(stakeBefore - stakeAfter);
    expect(accounting.slashCount).to.equal(1n);
    expect(accounting.protocolFault).to.equal(true);
    expect((await core.getRequestLifecycle(requestId)).status).to.equal(REVIEW_COMMIT);
  });

  it("slashes valid proofs that do not pass the 50% review sortition", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();
    const reviewer = await findNonSelectedReviewer(fixture, requestId, fixture.reviewers);
    const review = await buildReviewCommit(commitReveal, requestId, reviewer, 8000, "ipfs://report-not-selected", "not-selected");
    const stakeBefore = (await reviewerRegistry.getReviewer(reviewer.address)).stake;

    await commitReveal.connect(reviewer).commitReview(requestId, review.resultHash, review.seed, vrfProof);

    const stakeAfter = (await reviewerRegistry.getReviewer(reviewer.address)).stake;
    expect(stakeAfter).to.be.lt(stakeBefore);
    expect((await core.getRequestLifecycle(requestId)).status).to.equal(REVIEW_COMMIT);
  });

  it("requeues Standard requests once on review commit timeout", async function () {
    const { requester, paymentRouter, core } = await deployFixture();
    const priorityFee = ethers.parseEther("3");
    const requestId = await createRequest(paymentRouter, requester, STANDARD, priorityFee, "standard-timeout");

    await core.startNextRequest();
    const epochBefore = (await core.getRequestLifecycle(requestId)).committeeEpoch;
    await time.increase(2 * 60 * 60 + 1);
    await core.handleTimeout(requestId);

    const request = await core.getRequestLifecycle(requestId);
    expect(request.status).to.equal(QUEUED);
    expect(request.retryCount).to.equal(1n);
    expect(request.committeeEpoch).to.be.gt(epochBefore);
    expect(request.activePriority).to.equal(priorityFee - 1n);
  });

  it("preserves aborted round history across retry cleanup", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core, roundLedger } = fixture;
    const requestId = await createRequest(paymentRouter, requester, STANDARD, ethers.parseEther("1"), "standard-partial-retry");

    await core.startNextRequest();
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers, 3n);
    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://partial-alice", "partial-alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://partial-bob", "partial-bob");
    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);

    const bobStakeBefore = (await reviewerRegistry.getReviewer(bob.address)).stake;
    await time.increase(2 * 60 * 60 + 1);
    await core.handleTimeout(requestId);
    const bobStakeAfter = (await reviewerRegistry.getReviewer(bob.address)).stake;

    const latestAttempt = (await core.getRequestLifecycle(requestId)).retryCount;
    const oldRound0 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_REVIEW);
    const oldAliceRound0 = await roundLedger.getReviewerRoundScore(requestId, 0, ROUND_REVIEW, alice.address);
    const oldBobAccounting = await roundLedger.getReviewerRoundAccounting(requestId, 0, ROUND_REVIEW, bob.address);

    expect(latestAttempt).to.equal(1n);
    expect(oldRound0.score).to.equal(8000n);
    expect(oldRound0.closed).to.equal(true);
    expect(oldRound0.aborted).to.equal(true);
    expect(oldAliceRound0.available).to.equal(true);
    expect(oldAliceRound0.score).to.equal(8000n);
    expect(oldBobAccounting.slashed).to.equal(bobStakeBefore - bobStakeAfter);
    expect(oldBobAccounting.protocolFault).to.equal(true);
  });

  it("admits newly selected reviewers after the retry epoch changes", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, vrfProof, core } = fixture;
    const priorityFee = ethers.parseEther("2");
    const requestId = await createRequest(paymentRouter, requester, STANDARD, priorityFee, "standard-retry-selection");

    await core.startNextRequest();
    const initialLifecycle = await core.getRequestLifecycle(requestId);
    const initialPhaseStartedBlock = BigInt(await ethers.provider.getBlockNumber());
    const initiallySelected = new Set();
    for (const reviewer of fixture.reviewers) {
      const pass = await sortitionPass(
        fixture,
        requestId,
        REVIEW_SORTITION,
        initialLifecycle.committeeEpoch,
        reviewer,
        null,
        initialPhaseStartedBlock,
        3
      );
      if (pass) initiallySelected.add(reviewer.address);
    }

    await time.increase(2 * 60 * 60 + 1);
    await core.handleTimeout(requestId);
    await core.startNextRequest();

    const retryLifecycle = await core.getRequestLifecycle(requestId);
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers, 3n, initiallySelected);
    expect(retryLifecycle.retryCount).to.equal(1n);
    expect(retryLifecycle.committeeEpoch).to.be.gt(initialLifecycle.committeeEpoch);
    expect(!initiallySelected.has(alice.address) || !initiallySelected.has(bob.address)).to.equal(true);

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://retry-alice", "retry-alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://retry-bob", "retry-bob");
    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);

    expect((await core.getRequestLifecycle(requestId)).status).to.equal(REVIEW_REVEAL);
  });

  it("handles retry epoch selection while maxActiveRequests capacity is temporarily unavailable", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, vrfProof, core } = fixture;
    const firstRequestId = await createRequest(paymentRouter, requester, STANDARD, ethers.parseEther("1"), "cap-retry-1");

    await core.startNextRequest();
    const initialLifecycle = await core.getRequestLifecycle(firstRequestId);
    const initialPhaseStartedBlock = BigInt(await ethers.provider.getBlockNumber());
    const initiallySelected = new Set();
    for (const reviewer of fixture.reviewers) {
      const pass = await sortitionPass(
        fixture,
        firstRequestId,
        REVIEW_SORTITION,
        initialLifecycle.committeeEpoch,
        reviewer,
        null,
        initialPhaseStartedBlock,
        3
      );
      if (pass) initiallySelected.add(reviewer.address);
    }

    const secondRequestId = await createRequest(paymentRouter, requester, FAST, ethers.parseEther("5"), "cap-retry-2");

    await time.increase(2 * 60 * 60 + 1);
    await core.handleTimeout(firstRequestId);
    const retryQueued = await core.getRequestLifecycle(firstRequestId);
    expect(retryQueued.status).to.equal(QUEUED);
    expect(retryQueued.committeeEpoch).to.be.gt(initialLifecycle.committeeEpoch);

    await core.startNextRequest();
    expect((await core.getRequestLifecycle(secondRequestId)).status).to.equal(REVIEW_COMMIT);
    expect((await core.getRequestLifecycle(firstRequestId)).status).to.equal(QUEUED);

    const ignoredReview = await buildReviewCommit(
      commitReveal,
      firstRequestId,
      fixture.alice,
      8000,
      "ipfs://queued-review",
      "queued-review"
    );
    await commitReview(commitReveal, fixture.alice, firstRequestId, ignoredReview, vrfProof);
    expect(await commitReveal.getReviewParticipants(firstRequestId, retryQueued.retryCount)).to.deep.equal([]);
    await expect(core.startNextRequest()).to.be.revertedWithCustomError(core, "TooEarly");

    await time.increase(30 * 60 + 1);
    await core.handleTimeout(secondRequestId);
    expect((await core.getRequestLifecycle(secondRequestId)).status).to.equal(CANCELLED);

    await core.startNextRequest();
    const retryActive = await core.getRequestLifecycle(firstRequestId);
    expect(retryActive.status).to.equal(REVIEW_COMMIT);

    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, firstRequestId, fixture.reviewers, 3n, initiallySelected);
    expect(!initiallySelected.has(alice.address) || !initiallySelected.has(bob.address)).to.equal(true);

    const aliceReview = await buildReviewCommit(commitReveal, firstRequestId, alice, 8000, "ipfs://retry-cap-alice", "retry-cap-alice");
    const bobReview = await buildReviewCommit(commitReveal, firstRequestId, bob, 6000, "ipfs://retry-cap-bob", "retry-cap-bob");
    await commitReview(commitReveal, alice, firstRequestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, firstRequestId, bobReview, vrfProof);

    expect((await core.getRequestLifecycle(firstRequestId)).status).to.equal(REVIEW_REVEAL);
    expect(await commitReveal.getReviewParticipants(firstRequestId, retryActive.retryCount)).to.deep.equal([alice.address, bob.address]);
  });

  it("slashes missed review reveals and continues Fast requests as low-confidence", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers);

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);

    const bobStakeBefore = (await reviewerRegistry.getReviewer(bob.address)).stake;

    await time.increase(30 * 60 + 1);
    await core.handleTimeout(requestId);

    const request = await core.getRequestLifecycle(requestId);
    const bobStakeAfter = (await reviewerRegistry.getReviewer(bob.address)).stake;

    expect(request.status).to.equal(FINALIZED);
    expect(request.lowConfidence).to.equal(true);
    expect(bobStakeAfter).to.be.lt(bobStakeBefore);
  });

  it("slashes missed audit commits and lets submitted audits continue", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core, roundLedger } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);
    const { alice, bob } = await enterAuditCommitWithSelectedPair(fixture, requestId);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob], [7000], "alice");
    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);

    const bobStakeBefore = (await reviewerRegistry.getReviewer(bob.address)).stake;
    await time.increase(30 * 60 + 1);
    await core.handleTimeout(requestId);
    const bobStakeAfter = (await reviewerRegistry.getReviewer(bob.address)).stake;

    const request = await core.getRequestLifecycle(requestId);
    const accounting = await roundLedger.getReviewerRoundAccounting(requestId, 0, ROUND_AUDIT_CONSENSUS, bob.address);
    expect(request.status).to.equal(AUDIT_REVEAL);
    expect(request.lowConfidence).to.equal(true);
    expect(bobStakeAfter).to.be.lt(bobStakeBefore);
    expect(accounting.protocolFault).to.equal(true);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await time.increase(30 * 60 + 1);
    await core.handleTimeout(requestId);
    expect((await core.getRequestLifecycle(requestId)).status).to.equal(FINALIZED);
  });

  it("slashes and ignores non-canonical self-audit reveals", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core, roundLedger } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

    const { alice, bob } = await enterAuditCommitWithSelectedPair(fixture, requestId);

    const badAudit = await buildAuditCommit(commitReveal, requestId, alice, [alice], [9000], "alice-self");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice], [9000], "bob");

    await commitAudit(commitReveal, alice, requestId, badAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);

    const stakeBefore = (await reviewerRegistry.getReviewer(alice.address)).stake;

    await commitReveal.connect(alice).revealAudit(requestId, badAudit.targets, badAudit.scores, badAudit.seed);

    const stakeAfter = (await reviewerRegistry.getReviewer(alice.address)).stake;
    const request = await core.getRequestLifecycle(requestId);
    const accounting = await roundLedger.getReviewerRoundAccounting(requestId, 0, ROUND_AUDIT_CONSENSUS, alice.address);

    expect(stakeAfter).to.be.lt(stakeBefore);
    expect(accounting.slashed).to.equal(stakeBefore - stakeAfter);
    expect(accounting.slashCount).to.equal(1n);
    expect(accounting.protocolFault).to.equal(true);
    expect(request.status).to.equal(5n);
  });

  it("rejects target-specific audit VRF proofs in full-audit mode", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

    const { alice, bob } = await enterAuditCommitWithSelectedPair(fixture, requestId);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob], [7000], "alice");
    const badProof = [...vrfProof];
    badProof[0] = 0n;
    const stakeBefore = (await reviewerRegistry.getReviewer(alice.address)).stake;

    await expect(commitReveal.connect(alice).commitAudit(requestId, aliceAudit.resultHash, aliceAudit.seed, [badProof]))
      .to.be.revertedWithCustomError(core, "InvalidAuditTarget");

    const stakeAfter = (await reviewerRegistry.getReviewer(alice.address)).stake;
    expect(stakeAfter).to.equal(stakeBefore);
    expect((await core.getRequestLifecycle(requestId)).status).to.equal(AUDIT_COMMIT);
  });

  it("locks accepted reviewer stake until settlement", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers);

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    expect(await reviewerRegistry.lockedStake(alice.address)).to.equal(ethers.parseEther("1000"));
    await expect(reviewerRegistry.connect(alice).withdrawStake.staticCall(1)).to.be.revertedWithCustomError(reviewerRegistry, "InvalidAmount");

    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob], [7000], "alice");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice], [9000], "bob");

    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);

    expect(await reviewerRegistry.lockedStake(alice.address)).to.equal(0n);
  });

  it("marks Critical requests unresolved instead of finalizing below coverage quorum", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, vrfProof, core, roundLedger } = fixture;
    const requestId = await createRequest(paymentRouter, requester, CRITICAL, 0n, "critical-low-coverage");

    await core.startNextRequest();
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers);

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob], [7000], "alice");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice], [9000], "bob");

    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await time.increase(30 * 60 + 1);
    await core.handleTimeout(requestId);

    const lifecycle = await core.getRequestLifecycle(requestId);
    const round1 = await roundLedger.getRoundAggregate(requestId, 0, ROUND_AUDIT_CONSENSUS);
    expect(lifecycle.status).to.equal(UNRESOLVED);
    expect(round1.coverage).to.equal(5000n);
  });

  it("excludes reviewers from eligibility after enough low long-term reputation samples", async function () {
    const { owner, alice, reviewerRegistry, reputationLedger, core } = await deployFixture();

    await reputationLedger.setCore(owner.address);
    for (let i = 0; i < 3; i++) {
      await reputationLedger.record(alice.address, 1001, 1000, 1000, 1000, 1000, false, 1000, false, "ipfs://low", ethers.id(`low-${i}`));
    }
    await reputationLedger.setCore(await core.getAddress());

    expect(await reviewerRegistry.isEligible(alice.address, DOMAIN_RESEARCH)).to.equal(false);
  });
});
