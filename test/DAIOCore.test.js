const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const vrfData = require("../lib/vrf-solidity/test/data.json");

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const STANDARD = 1;
const FINALIZED = 6n;
const QUEUED = 1n;
const REVIEW_COMMIT = 2n;
const AUDIT_COMMIT = 4n;

describe("DAIOCore", function () {
  async function deployFixture() {
    const [owner, treasury, requester, alice, bob, carol] = await ethers.getSigners();

    const USDAIO = await ethers.getContractFactory("USDAIOToken");
    const usdaio = await USDAIO.deploy(owner.address);
    await usdaio.waitForDeployment();

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
      await usdaio.getAddress(),
      treasury.address,
      await commitReveal.getAddress(),
      await priorityQueue.getAddress(),
      await vrfCoordinator.getAddress()
    );
    await core.waitForDeployment();
    await commitReveal.setCore(await core.getAddress());
    await priorityQueue.setCore(await core.getAddress());

    const vrfVector = vrfData.verify.valid[0];
    const vrfPublicKey = Array.from(await vrfVerifier.decodePoint(vrfVector.pub));
    const vrfProof = Array.from(await vrfVerifier.decodeProof(vrfVector.pi));

    const coreAddress = await core.getAddress();
    const reviewerStake = ethers.parseEther("1000");
    const requesterFunds = ethers.parseEther("1000");

    for (const reviewer of [alice, bob, carol]) {
      await usdaio.mint(reviewer.address, reviewerStake);
      await usdaio.connect(reviewer).approve(coreAddress, reviewerStake);
    }

    await usdaio.mint(requester.address, requesterFunds);
    await usdaio.connect(requester).approve(coreAddress, requesterFunds);

    await core
      .connect(alice)
      .registerReviewer("alice.daio.eth", ethers.id("alice.daio.eth"), 1001, DOMAIN_RESEARCH, vrfPublicKey, reviewerStake);
    await core
      .connect(bob)
      .registerReviewer("bob.daio.eth", ethers.id("bob.daio.eth"), 1002, DOMAIN_RESEARCH, vrfPublicKey, reviewerStake);
    await core
      .connect(carol)
      .registerReviewer("carol.daio.eth", ethers.id("carol.daio.eth"), 1003, DOMAIN_RESEARCH, vrfPublicKey, reviewerStake);

    return { owner, treasury, requester, alice, bob, carol, usdaio, commitReveal, priorityQueue, vrfVerifier, vrfCoordinator, vrfProof, core };
  }

  async function createFastRequest(core, requester, priorityFee = 0n) {
    await core
      .connect(requester)
      .createRequest("ipfs://proposal-1", ethers.id("proposal-1"), ethers.id("rubric-1"), DOMAIN_RESEARCH, FAST, priorityFee);

    return core.requestCount();
  }

  async function createRequest(core, requester, tier, priorityFee = 0n, label = "proposal-1") {
    await core
      .connect(requester)
      .createRequest(`ipfs://${label}`, ethers.id(label), ethers.id(`${label}:rubric`), DOMAIN_RESEARCH, tier, priorityFee);

    return core.requestCount();
  }

  async function buildReviewCommit(core, requestId, reviewer, proposalScore, reportURI, saltLabel) {
    const seed = BigInt(ethers.id(`${saltLabel}:review`));
    const reportHash = ethers.id(`${reportURI}:hash`);
    const resultHash = await core.hashReviewReveal(requestId, reviewer.address, proposalScore, reportHash, reportURI);

    return {
      proposalScore,
      reportHash,
      reportURI,
      seed,
      resultHash
    };
  }

  async function buildAuditCommit(core, requestId, auditor, targetSigners, scores, saltLabel) {
    const seed = BigInt(ethers.id(`${saltLabel}:audit`));
    const targets = targetSigners.map((signer) => signer.address);
    const resultHash = await core.hashAuditReveal(requestId, auditor.address, targets, scores);

    return { targets, scores, seed, resultHash };
  }

  async function commitReview(core, commitReveal, reviewer, requestId, review, vrfProof) {
    await commitReveal.connect(reviewer).commitReview(requestId, review.resultHash, review.seed, vrfProof);
  }

  async function commitAudit(core, commitReveal, auditor, requestId, audit) {
    await commitReveal.connect(auditor).commitAudit(requestId, audit.resultHash, audit.seed);
  }

  it("runs the post-audit scoring and settlement path", async function () {
    const { requester, alice, bob, carol, usdaio, commitReveal, vrfProof, core } = await deployFixture();
    const requestId = await createFastRequest(core, requester);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(core, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(core, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(core, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(core, commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(core, commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(core, commitReveal, carol, requestId, carolReview, vrfProof);

    await core
      .connect(alice)
      .revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await core
      .connect(bob)
      .revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);
    await core
      .connect(carol)
      .revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.seed);

    const aliceAudit = await buildAuditCommit(core, requestId, alice, [bob, carol], [7000, 4000], "alice");
    const bobAudit = await buildAuditCommit(core, requestId, bob, [alice, carol], [9000, 4500], "bob");
    const carolAudit = await buildAuditCommit(core, requestId, carol, [alice, bob], [8800, 7200], "carol");

    await commitAudit(core, commitReveal, alice, requestId, aliceAudit);
    await commitAudit(core, commitReveal, bob, requestId, bobAudit);
    await commitAudit(core, commitReveal, carol, requestId, carolAudit);

    const aliceBalanceBefore = await usdaio.balanceOf(alice.address);
    const bobBalanceBefore = await usdaio.balanceOf(bob.address);
    const carolBalanceBefore = await usdaio.balanceOf(carol.address);

    await core.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed, vrfProof);
    await core.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed, vrfProof);
    await core.connect(carol).revealAudit(requestId, carolAudit.targets, carolAudit.scores, carolAudit.seed, vrfProof);

    await core.finalizeRequest(requestId);

    const request = await core.requests(requestId);
    const aliceResult = await core.reviewerResults(requestId, alice.address);
    const bobResult = await core.reviewerResults(requestId, bob.address);
    const carolResult = await core.reviewerResults(requestId, carol.address);

    expect(request.status).to.equal(FINALIZED);
    expect(request.finalProposalScore).to.equal(6000n);
    expect(request.auditCoverage).to.equal(10000n);
    expect(request.lowConfidence).to.equal(false);
    expect(request.confidence).to.equal(8000n);

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

    const aliceReputation = await core.reputations(alice.address);
    expect(aliceReputation.samples).to.equal(1n);
    expect(aliceReputation.finalContribution).to.equal(9417n);
  });

  it("starts the highest priority queued request first", async function () {
    const { requester, core } = await deployFixture();

    await createFastRequest(core, requester, ethers.parseEther("1"));
    await createFastRequest(core, requester, ethers.parseEther("5"));

    await core.startNextRequest();

    const firstRequest = await core.requests(1);
    const secondRequest = await core.requests(2);

    expect(firstRequest.status).to.equal(QUEUED);
    expect(secondRequest.status).to.equal(REVIEW_COMMIT);
  });

  it("rejects invalid VRF proofs", async function () {
    const { requester, alice, commitReveal, vrfProof, core } = await deployFixture();
    const requestId = await createFastRequest(core, requester);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(core, requestId, alice, 8000, "ipfs://report-alice", "alice");
    await commitReveal.connect(alice).commit_hashed(aliceReview.resultHash, aliceReview.seed, await core.reviewCommitRound(requestId));

    const badProof = [...vrfProof];
    badProof[0] = 0n;

    await expect(core.connect(alice).submitReviewCommit(requestId, badProof)).to.be.revertedWith(
      "MockVRFCoordinator: invalid proof"
    );
  });

  it("requeues Standard requests once on review commit timeout", async function () {
    const { requester, core } = await deployFixture();
    const priorityFee = ethers.parseEther("3");
    const requestId = await createRequest(core, requester, STANDARD, priorityFee, "standard-timeout");

    await core.startNextRequest();
    const epochBefore = (await core.requests(requestId)).committeeEpoch;
    await time.increase(2 * 60 * 60 + 1);
    await core.handleTimeout(requestId);

    const request = await core.requests(requestId);
    expect(request.status).to.equal(QUEUED);
    expect(request.retryCount).to.equal(1n);
    expect(request.committeeEpoch).to.be.gt(epochBefore);
    expect(request.activePriority).to.equal(priorityFee - 1n);
  });

  it("slashes missed review reveals and continues Fast requests as low-confidence", async function () {
    const { requester, alice, bob, carol, commitReveal, vrfProof, core } = await deployFixture();
    const requestId = await createFastRequest(core, requester);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(core, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(core, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(core, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(core, commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(core, commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(core, commitReveal, carol, requestId, carolReview, vrfProof);

    await core
      .connect(alice)
      .revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await core
      .connect(bob)
      .revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);

    const carolStakeBefore = (await core.reviewers(carol.address)).stake;

    await time.increase(30 * 60 + 1);
    await core.handleTimeout(requestId);

    const request = await core.requests(requestId);
    const carolStakeAfter = (await core.reviewers(carol.address)).stake;
    const carolReviewSubmission = await core.reviewSubmissions(requestId, carol.address);

    expect(request.status).to.equal(AUDIT_COMMIT);
    expect(request.lowConfidence).to.equal(true);
    expect(carolStakeAfter).to.be.lt(carolStakeBefore);
    expect(carolReviewSubmission.protocolFault).to.equal(true);
  });

  it("slashes and ignores non-canonical self-audit reveals", async function () {
    const { requester, alice, bob, carol, commitReveal, vrfProof, core } = await deployFixture();
    const requestId = await createFastRequest(core, requester);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(core, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(core, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(core, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await commitReview(core, commitReveal, alice, requestId, aliceReview, vrfProof);
    await commitReview(core, commitReveal, bob, requestId, bobReview, vrfProof);
    await commitReview(core, commitReveal, carol, requestId, carolReview, vrfProof);

    await core
      .connect(alice)
      .revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.seed);
    await core
      .connect(bob)
      .revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.seed);
    await core
      .connect(carol)
      .revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.seed);

    const badAudit = await buildAuditCommit(core, requestId, alice, [alice], [9000], "alice-self");
    const bobAudit = await buildAuditCommit(core, requestId, bob, [alice], [9000], "bob");
    const carolAudit = await buildAuditCommit(core, requestId, carol, [bob], [7200], "carol");

    await commitAudit(core, commitReveal, alice, requestId, badAudit);
    await commitAudit(core, commitReveal, bob, requestId, bobAudit);
    await commitAudit(core, commitReveal, carol, requestId, carolAudit);

    const stakeBefore = (await core.reviewers(alice.address)).stake;

    await core.connect(alice).revealAudit(requestId, badAudit.targets, badAudit.scores, badAudit.seed, vrfProof);

    const stakeAfter = (await core.reviewers(alice.address)).stake;
    const auditSubmission = await core.auditSubmissions(requestId, alice.address);
    const request = await core.requests(requestId);

    expect(stakeAfter).to.be.lt(stakeBefore);
    expect(auditSubmission.protocolFault).to.equal(true);
    expect(request.auditRevealCount).to.equal(0n);
  });
});
