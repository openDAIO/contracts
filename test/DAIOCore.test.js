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
const AUDIT_COMMIT = 4n;
const UNRESOLVED = 9n;

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
    reviewElectionDifficulty: 10000,
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
    const [owner, treasury, requester, alice, bob, carol] = await ethers.getSigners();

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
        reviewCommitQuorum: 5,
        reviewRevealQuorum: 4,
        auditCommitQuorum: 4,
        auditRevealQuorum: 4,
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
        reviewCommitQuorum: 3,
        reviewRevealQuorum: 3,
        auditCommitQuorum: 3,
        auditRevealQuorum: 3,
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

    for (const reviewer of [alice, bob, carol]) {
      await usdaio.mint(reviewer.address, reviewerStake);
      await usdaio.connect(reviewer).approve(await stakeVault.getAddress(), reviewerStake);
    }

    await usdaio.mint(requester.address, requesterFunds);
    await usdaio.connect(requester).approve(await paymentRouter.getAddress(), requesterFunds);

    await reviewerRegistry
      .connect(alice)
      .registerReviewer("alice.daio.eth", ethers.id("alice.daio.eth"), 1001, DOMAIN_RESEARCH, vrfPublicKey, reviewerStake);
    await reviewerRegistry
      .connect(bob)
      .registerReviewer("bob.daio.eth", ethers.id("bob.daio.eth"), 1002, DOMAIN_RESEARCH, vrfPublicKey, reviewerStake);
    await reviewerRegistry
      .connect(carol)
      .registerReviewer("carol.daio.eth", ethers.id("carol.daio.eth"), 1003, DOMAIN_RESEARCH, vrfPublicKey, reviewerStake);

    return {
      owner,
      treasury,
      requester,
      alice,
      bob,
      carol,
      usdaio,
      stakeVault,
      reviewerRegistry,
      reputationLedger,
      commitReveal,
      paymentRouter,
      priorityQueue,
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

  function auditProofs(vrfProof, reviewerCount = 3) {
    return Array.from({ length: reviewerCount - 1 }, () => vrfProof);
  }

  async function commitAudit(commitReveal, auditor, requestId, audit, vrfProof, reviewerCount = 3) {
    await commitReveal.connect(auditor).commitAudit(requestId, audit.resultHash, audit.seed, auditProofs(vrfProof, reviewerCount));
  }

  it("runs the post-audit scoring and settlement path", async function () {
    const { requester, alice, bob, carol, usdaio, commitReveal, paymentRouter, vrfProof, core, reputationLedger } =
      await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(commitReveal, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(commitReveal, carol, requestId, carolReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);
    await commitReveal.connect(carol).revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.seed);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob, carol], [7000, 4000], "alice");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice, carol], [9000, 4500], "bob");
    const carolAudit = await buildAuditCommit(commitReveal, requestId, carol, [alice, bob], [8800, 7200], "carol");

    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);
    await commitAudit(commitReveal, carol, requestId, carolAudit, vrfProof);

    const aliceBalanceBefore = await usdaio.balanceOf(alice.address);
    const bobBalanceBefore = await usdaio.balanceOf(bob.address);
    const carolBalanceBefore = await usdaio.balanceOf(carol.address);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);
    await commitReveal.connect(carol).revealAudit(requestId, carolAudit.targets, carolAudit.scores, carolAudit.seed);

    await core.finalizeRequest(requestId);

    const result = await core.getRequestFinalResult(requestId);
    const aliceResult = await core.getReviewerResult(requestId, alice.address);
    const bobResult = await core.getReviewerResult(requestId, bob.address);
    const carolResult = await core.getReviewerResult(requestId, carol.address);

    expect(result.status).to.equal(FINALIZED);
    expect(result.finalProposalScore).to.equal(6000n);
    expect(result.auditCoverage).to.equal(10000n);
    expect(result.lowConfidence).to.equal(false);
    expect(result.confidence).to.equal(8000n);

    expect(aliceResult.reportQualityMedian).to.equal(8900n);
    expect(bobResult.reportQualityMedian).to.equal(7100n);
    expect(carolResult.reportQualityMedian).to.equal(4250n);

    expect(aliceResult.normalizedReportQuality).to.equal(10000n);
    expect(bobResult.normalizedReportQuality).to.equal(7977n);
    expect(carolResult.normalizedReportQuality).to.equal(4775n);

    expect(aliceResult.finalContribution).to.equal(9417n);
    expect(bobResult.finalContribution).to.equal(7977n);
    expect(carolResult.finalContribution).to.equal(4775n);

    expect(await usdaio.balanceOf(alice.address)).to.be.gt(aliceBalanceBefore);
    expect(await usdaio.balanceOf(bob.address)).to.be.gt(bobBalanceBefore);
    expect(await usdaio.balanceOf(carol.address)).to.be.gt(carolBalanceBefore);
    expect(await core.treasuryBalance()).to.be.gte(ethers.parseEther("10"));

    const aliceReputation = await reputationLedger.reputations(alice.address);
    expect(aliceReputation.samples).to.equal(1n);
    expect(aliceReputation.finalContribution).to.equal(9417n);
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

  it("slashes missed review reveals and continues Fast requests as low-confidence", async function () {
    const { requester, alice, bob, carol, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(commitReveal, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(commitReveal, carol, requestId, carolReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);

    const carolStakeBefore = (await reviewerRegistry.getReviewer(carol.address)).stake;

    await time.increase(30 * 60 + 1);
    await core.handleTimeout(requestId);

    const request = await core.getRequestLifecycle(requestId);
    const carolStakeAfter = (await reviewerRegistry.getReviewer(carol.address)).stake;

    expect(request.status).to.equal(AUDIT_COMMIT);
    expect(request.lowConfidence).to.equal(true);
    expect(carolStakeAfter).to.be.lt(carolStakeBefore);
    expect((await core.getRequestFinalResult(requestId)).faultSignal).to.equal(1n);
  });

  it("slashes and ignores non-canonical self-audit reveals", async function () {
    const { requester, alice, bob, carol, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(commitReveal, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(commitReveal, carol, requestId, carolReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);
    await commitReveal.connect(carol).revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.seed);

    const badAudit = await buildAuditCommit(commitReveal, requestId, alice, [alice], [9000], "alice-self");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice, carol], [9000, 4500], "bob");
    const carolAudit = await buildAuditCommit(commitReveal, requestId, carol, [alice, bob], [8800, 7200], "carol");

    await commitAudit(commitReveal, alice, requestId, badAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);
    await commitAudit(commitReveal, carol, requestId, carolAudit, vrfProof);

    const stakeBefore = (await reviewerRegistry.getReviewer(alice.address)).stake;

    await commitReveal.connect(alice).revealAudit(requestId, badAudit.targets, badAudit.scores, badAudit.seed);

    const stakeAfter = (await reviewerRegistry.getReviewer(alice.address)).stake;
    const request = await core.getRequestLifecycle(requestId);

    expect(stakeAfter).to.be.lt(stakeBefore);
    expect((await core.getRequestFinalResult(requestId)).faultSignal).to.equal(1n);
    expect(request.status).to.equal(5n);
  });

  it("slashes invalid target-specific audit VRF proofs without accepting the audit commit", async function () {
    const { requester, alice, bob, carol, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(commitReveal, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(commitReveal, carol, requestId, carolReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);
    await commitReveal.connect(carol).revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.seed);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob, carol], [7000, 4000], "alice");
    const badProof = [...vrfProof];
    badProof[0] = 0n;
    const stakeBefore = (await reviewerRegistry.getReviewer(alice.address)).stake;

    await commitReveal.connect(alice).commitAudit(requestId, aliceAudit.resultHash, aliceAudit.seed, [badProof, vrfProof]);

    const stakeAfter = (await reviewerRegistry.getReviewer(alice.address)).stake;
    expect(stakeAfter).to.be.lt(stakeBefore);
    expect((await core.getRequestLifecycle(requestId)).status).to.equal(AUDIT_COMMIT);
  });

  it("locks accepted reviewer stake until settlement", async function () {
    const { requester, alice, bob, carol, commitReveal, paymentRouter, reviewerRegistry, vrfProof, core } = await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, FAST);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(commitReveal, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    expect(await reviewerRegistry.lockedStake(alice.address)).to.equal(ethers.parseEther("1000"));
    await expect(reviewerRegistry.connect(alice).withdrawStake(1)).to.be.revertedWithCustomError(reviewerRegistry, "InvalidAmount");

    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(commitReveal, carol, requestId, carolReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);
    await commitReveal.connect(carol).revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.seed);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob, carol], [7000, 4000], "alice");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice, carol], [9000, 4500], "bob");
    const carolAudit = await buildAuditCommit(commitReveal, requestId, carol, [alice, bob], [8800, 7200], "carol");

    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);
    await commitAudit(commitReveal, carol, requestId, carolAudit, vrfProof);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);
    await commitReveal.connect(carol).revealAudit(requestId, carolAudit.targets, carolAudit.scores, carolAudit.seed);
    await core.finalizeRequest(requestId);

    expect(await reviewerRegistry.lockedStake(alice.address)).to.equal(0n);
  });

  it("marks Critical requests unresolved instead of finalizing below coverage quorum", async function () {
    const { requester, alice, bob, carol, commitReveal, paymentRouter, vrfProof, core } = await deployFixture();
    const requestId = await createRequest(paymentRouter, requester, CRITICAL, 0n, "critical-low-coverage");

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(commitReveal, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(commitReveal, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(commitReveal, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(commitReveal, carol, requestId, carolReview, vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);
    await commitReveal.connect(carol).revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.seed);

    const aliceAudit = await buildAuditCommit(commitReveal, requestId, alice, [bob, carol], [7000, 4000], "alice");
    const bobAudit = await buildAuditCommit(commitReveal, requestId, bob, [alice, carol], [9000, 4500], "bob");
    const carolAudit = await buildAuditCommit(commitReveal, requestId, carol, [alice, bob], [8800, 7200], "carol");

    await commitAudit(commitReveal, alice, requestId, aliceAudit, vrfProof);
    await commitAudit(commitReveal, bob, requestId, bobAudit, vrfProof);
    await commitAudit(commitReveal, carol, requestId, carolAudit, vrfProof);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);
    await commitReveal.connect(carol).revealAudit(requestId, carolAudit.targets, carolAudit.scores, carolAudit.seed);
    await core.finalizeRequest(requestId);

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
