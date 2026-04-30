const { expect } = require("chai");
const { ethers } = require("hardhat");

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const FINALIZED = 6n;
const QUEUED = 1n;
const REVIEW_COMMIT = 2n;

describe("DAIOCore", function () {
  async function deployFixture() {
    const [owner, treasury, requester, alice, bob, carol] = await ethers.getSigners();

    const USDAIO = await ethers.getContractFactory("USDAIOToken");
    const usdaio = await USDAIO.deploy(owner.address);
    await usdaio.waitForDeployment();

    const DAIOCore = await ethers.getContractFactory("DAIOCore");
    const core = await DAIOCore.deploy(await usdaio.getAddress(), treasury.address);
    await core.waitForDeployment();

    const coreAddress = await core.getAddress();
    const reviewerStake = ethers.parseEther("1000");
    const requesterFunds = ethers.parseEther("1000");

    for (const reviewer of [alice, bob, carol]) {
      await usdaio.mint(reviewer.address, reviewerStake);
      await usdaio.connect(reviewer).approve(coreAddress, reviewerStake);
    }

    await usdaio.mint(requester.address, requesterFunds);
    await usdaio.connect(requester).approve(coreAddress, requesterFunds);

    await core.connect(alice).registerReviewer("alice.daio.eth", ethers.id("alice.daio.eth"), 1001, DOMAIN_RESEARCH, reviewerStake);
    await core.connect(bob).registerReviewer("bob.daio.eth", ethers.id("bob.daio.eth"), 1002, DOMAIN_RESEARCH, reviewerStake);
    await core.connect(carol).registerReviewer("carol.daio.eth", ethers.id("carol.daio.eth"), 1003, DOMAIN_RESEARCH, reviewerStake);

    return { owner, treasury, requester, alice, bob, carol, usdaio, core };
  }

  async function createFastRequest(core, requester, priorityFee = 0n) {
    await core
      .connect(requester)
      .createRequest("ipfs://proposal-1", ethers.id("proposal-1"), ethers.id("rubric-1"), DOMAIN_RESEARCH, FAST, priorityFee);

    return core.requestCount();
  }

  async function buildReviewCommit(core, requestId, reviewer, proposalScore, reportURI, saltLabel) {
    const salt = ethers.id(`${saltLabel}:review`);
    const reportHash = ethers.id(`${reportURI}:hash`);
    const commitHash = await core.hashReviewReveal(requestId, reviewer.address, proposalScore, reportHash, reportURI, salt);

    return {
      proposalScore,
      reportHash,
      reportURI,
      salt,
      commitHash,
      proof: ethers.id(`${saltLabel}:review-proof`)
    };
  }

  async function buildAuditCommit(core, requestId, auditor, targetSigners, scores, saltLabel) {
    const salt = ethers.id(`${saltLabel}:audit`);
    const targets = targetSigners.map((signer) => signer.address);
    const commitHash = await core.hashAuditReveal(requestId, auditor.address, targets, scores, salt);

    return { targets, scores, salt, commitHash };
  }

  it("runs the post-audit scoring and settlement path", async function () {
    const { requester, alice, bob, carol, usdaio, core } = await deployFixture();
    const requestId = await createFastRequest(core, requester);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(core, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(core, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(core, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await core.connect(alice).submitReviewCommit(requestId, aliceReview.commitHash, aliceReview.proof);
    await core.connect(bob).submitReviewCommit(requestId, bobReview.commitHash, bobReview.proof);
    await core.connect(carol).submitReviewCommit(requestId, carolReview.commitHash, carolReview.proof);

    await core
      .connect(alice)
      .revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.salt);
    await core
      .connect(bob)
      .revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.salt);
    await core
      .connect(carol)
      .revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.salt);

    const aliceAudit = await buildAuditCommit(core, requestId, alice, [bob, carol], [7000, 4000], "alice");
    const bobAudit = await buildAuditCommit(core, requestId, bob, [alice, carol], [9000, 4500], "bob");
    const carolAudit = await buildAuditCommit(core, requestId, carol, [alice, bob], [8800, 7200], "carol");

    await core.connect(alice).submitAuditCommit(requestId, aliceAudit.commitHash);
    await core.connect(bob).submitAuditCommit(requestId, bobAudit.commitHash);
    await core.connect(carol).submitAuditCommit(requestId, carolAudit.commitHash);

    const aliceBalanceBefore = await usdaio.balanceOf(alice.address);
    const bobBalanceBefore = await usdaio.balanceOf(bob.address);
    const carolBalanceBefore = await usdaio.balanceOf(carol.address);

    await core.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.salt);
    await core.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.salt);
    await core.connect(carol).revealAudit(requestId, carolAudit.targets, carolAudit.scores, carolAudit.salt);

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

  it("rejects self-audit reveals", async function () {
    const { requester, alice, bob, carol, core } = await deployFixture();
    const requestId = await createFastRequest(core, requester);

    await core.startNextRequest();

    const aliceReview = await buildReviewCommit(core, requestId, alice, 8000, "ipfs://report-alice", "alice");
    const bobReview = await buildReviewCommit(core, requestId, bob, 6000, "ipfs://report-bob", "bob");
    const carolReview = await buildReviewCommit(core, requestId, carol, 2000, "ipfs://report-carol", "carol");

    await core.connect(alice).submitReviewCommit(requestId, aliceReview.commitHash, aliceReview.proof);
    await core.connect(bob).submitReviewCommit(requestId, bobReview.commitHash, bobReview.proof);
    await core.connect(carol).submitReviewCommit(requestId, carolReview.commitHash, carolReview.proof);

    await core
      .connect(alice)
      .revealReview(requestId, aliceReview.proposalScore, aliceReview.reportHash, aliceReview.reportURI, aliceReview.salt);
    await core
      .connect(bob)
      .revealReview(requestId, bobReview.proposalScore, bobReview.reportHash, bobReview.reportURI, bobReview.salt);
    await core
      .connect(carol)
      .revealReview(requestId, carolReview.proposalScore, carolReview.reportHash, carolReview.reportURI, carolReview.salt);

    const badAudit = await buildAuditCommit(core, requestId, alice, [alice], [9000], "alice-self");
    const bobAudit = await buildAuditCommit(core, requestId, bob, [alice], [9000], "bob");
    const carolAudit = await buildAuditCommit(core, requestId, carol, [bob], [7200], "carol");

    await core.connect(alice).submitAuditCommit(requestId, badAudit.commitHash);
    await core.connect(bob).submitAuditCommit(requestId, bobAudit.commitHash);
    await core.connect(carol).submitAuditCommit(requestId, carolAudit.commitHash);

    await expect(core.connect(alice).revealAudit(requestId, badAudit.targets, badAudit.scores, badAudit.salt))
      .to.be.revertedWithCustomError(core, "InvalidAuditTarget");
  });
});
