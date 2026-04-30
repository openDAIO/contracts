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
const UNRESOLVED = 9n;
const SCALE = 10000n;
const ELECTION_DIFFICULTY = 5000n;
const REVIEW_SORTITION = ethers.id("DAIO_REVIEW_SORTITION");
const AUDIT_SORTITION = ethers.id("DAIO_AUDIT_SORTITION");

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
    auditElectionDifficulty: Number(ELECTION_DIFFICULTY),
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
  async function deployFixture() {
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
      await vrfCoordinator.getAddress()
    );
    await core.waitForDeployment();

    await core.setModules(
      await stakeVault.getAddress(),
      await reviewerRegistry.getAddress(),
      await assignmentManager.getAddress(),
      await consensusScoring.getAddress(),
      await settlement.getAddress(),
      await reputationLedger.getAddress()
    );
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
        auditTargetLimit: 2,
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
        auditTargetLimit: 3,
        minIncomingAudit: 2,
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
        auditTargetLimit: 2,
        minIncomingAudit: 3,
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
      core
    };
  }

  async function createRequest(paymentRouter, requester, tier, priorityFee = 0n, label = "proposal-1") {
    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO(`ipfs://${label}`, ethers.id(label), ethers.id(`${label}:rubric`), DOMAIN_RESEARCH, tier, priorityFee);
    return 1n;
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
    const auditPhaseStartedBlock = reviewPhaseStartedBlock + 4n;

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

        const firstAuditPass = await sortitionPass(
          fixture,
          requestId,
          AUDIT_SORTITION,
          lifecycle.auditEpoch,
          first,
          second,
          auditPhaseStartedBlock,
          finalityFactor
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
          finalityFactor
        );
        if (
          secondAuditPass
            && (!requireNewFrom || !requireNewFrom.has(first.address) || !requireNewFrom.has(second.address))
        ) {
          return [first, second];
        }
      }
    }
    throw new Error("No reviewer pair passes review and audit sortition in this phase");
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

  function auditProofs(vrfProof, reviewerCount = 2) {
    return Array.from({ length: reviewerCount - 1 }, () => vrfProof);
  }

  async function commitAudit(commitReveal, auditor, requestId, audit, vrfProof, reviewerCount = 2) {
    await commitReveal.connect(auditor).commitAudit(requestId, audit.resultHash, audit.seed, auditProofs(vrfProof, reviewerCount));
  }

  async function enterAuditCommitWithSelectedPair(fixture, requestId) {
    const { commitReveal, vrfProof, core } = fixture;
    await core.startNextRequest();
    const [alice, bob] = await findReviewPairForCurrentPhase(fixture, requestId, fixture.reviewers);
    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", `alice-${requestId}`);
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", `bob-${requestId}`);

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);

    return { alice, bob, aliceReview, bobReview };
  }

  it("runs the post-audit scoring and settlement path", async function () {
    const fixture = await deployFixture();
    const { requester, usdaio, commitReveal, paymentRouter, vrfProof, core, reputationLedger } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

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

    const aliceBalanceBefore = await usdaio.balanceOf(alice.address);
    const bobBalanceBefore = await usdaio.balanceOf(bob.address);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);

    const result = await core.getRequestFinalResult(requestId);
    const aliceResult = await core.getReviewerResult(requestId, alice.address);
    const bobResult = await core.getReviewerResult(requestId, bob.address);

    expect(result.status).to.equal(FINALIZED);
    expect(result.finalProposalScore).to.equal(8000n);
    expect(result.auditCoverage).to.equal(10000n);
    expect(result.lowConfidence).to.equal(false);
    expect(result.confidence).to.equal(9000n);

    expect(aliceResult.reportQualityMedian).to.equal(9000n);
    expect(bobResult.reportQualityMedian).to.equal(7000n);

    expect(aliceResult.normalizedReportQuality).to.equal(10000n);
    expect(bobResult.normalizedReportQuality).to.equal(7777n);

    expect(aliceResult.finalContribution).to.equal(10000n);
    expect(bobResult.finalContribution).to.equal(7777n);

    expect(await usdaio.balanceOf(alice.address)).to.be.gt(aliceBalanceBefore);
    expect(await usdaio.balanceOf(bob.address)).to.be.gt(bobBalanceBefore);
    expect(await core.treasuryBalance()).to.be.gte(ethers.parseEther("10"));

    const aliceReputation = await reputationLedger.reputations(alice.address);
    expect(aliceReputation.samples).to.equal(1n);
    expect(aliceReputation.finalContribution).to.equal(10000n);
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

  it("slashes invalid VRF proofs without accepting the commit", async function () {
    const { requester, alice, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const badProof = [...vrfProof];
    badProof[0] = 0n;
    const stakeBefore = (await reviewerRegistry.getReviewer(alice.address)).stake;

    await commitReveal.connect(alice).commitReview(requestId, aliceReview.resultHash, aliceReview.seed, badProof);

    const stakeAfter = (await reviewerRegistry.getReviewer(alice.address)).stake;
    expect(stakeAfter).to.be.lt(stakeBefore);
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
    expect((await core.getRequestFinalResult(requestId)).faultSignal).to.equal(1n);
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

    expect(request.status).to.equal(AUDIT_COMMIT);
    expect(request.lowConfidence).to.equal(true);
    expect(bobStakeAfter).to.be.lt(bobStakeBefore);
    expect((await core.getRequestFinalResult(requestId)).faultSignal).to.equal(1n);
  });

  it("slashes and ignores non-canonical self-audit reveals", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = fixture;
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

    expect(stakeAfter).to.be.lt(stakeBefore);
    expect((await core.getRequestFinalResult(requestId)).faultSignal).to.equal(1n);
    expect(request.status).to.equal(5n);
  });

  it("slashes invalid target-specific audit VRF proofs without accepting the audit commit", async function () {
    const fixture = await deployFixture();
    const { requester, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = fixture;
    const requestId = await createRequest(paymentRouter, requester, FAST);

    const { alice, bob } = await enterAuditCommitWithSelectedPair(fixture, requestId);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob], [7000], "alice");
    const badProof = [...vrfProof];
    badProof[0] = 0n;
    const stakeBefore = (await reviewerRegistry.getReviewer(alice.address)).stake;

    await commitReveal.connect(alice).commitAudit(requestId, aliceAudit.resultHash, aliceAudit.seed, [badProof]);

    const stakeAfter = (await reviewerRegistry.getReviewer(alice.address)).stake;
    expect(stakeAfter).to.be.lt(stakeBefore);
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
    const { requester, commitReveal, paymentRouter, vrfProof, core } = fixture;
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
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);

    const result = await core.getRequestFinalResult(requestId);
    expect(result.status).to.equal(UNRESOLVED);
    expect(result.auditCoverage).to.equal(0n);
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
