const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const vrfData = require("../lib/vrf-solidity/test/data.json");
const { deployCoreProxy } = require("./helpers/deployCoreProxy");

const RUN_FORK = process.env.RUN_SEPOLIA_FORK === "true";
const describeFork = RUN_FORK ? describe : describe.skip;
const FORK_URL = process.env.SEPOLIA_RPC_URL || process.env.HARDHAT_FORK_URL || "https://sepolia.drpc.org";
const FORK_BLOCK = process.env.SEPOLIA_FORK_BLOCK ? Number(process.env.SEPOLIA_FORK_BLOCK) : undefined;

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const FINALIZED = 6n;
const SCALE = 10000n;
const ROUND_REVIEW = 0;
const ROUND_AUDIT_CONSENSUS = 1;
const ROUND_REPUTATION_FINAL = 2;
const ELECTION_DIFFICULTY = 8000n;
const FAST_REVIEW_QUORUM = 3;
const REVIEW_SORTITION = ethers.id("DAIO_REVIEW_SORTITION");

const SEPOLIA = {
  ensRegistry: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  universalRouter: "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b",
  erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  erc8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713"
};

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

async function deployForkFixture() {
  const signers = await ethers.getSigners();
  const [owner, treasury, requester] = signers;
  const reviewerSigners = signers.slice(3, 8);

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

  const MockVRFCoordinator = await ethers.getContractFactory("MockVRFCoordinator");
  const vrfCoordinator = await MockVRFCoordinator.deploy();
  await vrfCoordinator.waitForDeployment();

  const { core } = await deployCoreProxy({
    treasury: treasury.address,
    commitReveal: await commitReveal.getAddress(),
    priorityQueue: await priorityQueue.getAddress(),
    vrfCoordinator: await vrfCoordinator.getAddress(),
    maxActiveRequests: 2
  });

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
  await core.setTierConfig(FAST, fastConfig());
  await stakeVault.setCoreOrSettlement(await core.getAddress());
  await stakeVault.setAuthorized(await reviewerRegistry.getAddress(), true);
  await reviewerRegistry.setCore(await core.getAddress());
  await reviewerRegistry.setReputationGate(await reputationLedger.getAddress(), 3, 3000, 7000);
  await reputationLedger.setCore(await core.getAddress());
  await commitReveal.setCore(await core.getAddress());
  await priorityQueue.setCore(await core.getAddress());

  const MockUniversalRouter = await ethers.getContractFactory("MockUniversalRouter");
  const universalRouter = await MockUniversalRouter.deploy();
  await universalRouter.waitForDeployment();

  const AcceptedTokenRegistry = await ethers.getContractFactory("AcceptedTokenRegistry");
  const acceptedTokenRegistry = await AcceptedTokenRegistry.deploy(await usdaio.getAddress());
  await acceptedTokenRegistry.waitForDeployment();
  await acceptedTokenRegistry.setAcceptedToken(SEPOLIA.usdc, true, true);
  await acceptedTokenRegistry.setAcceptedToken(ethers.ZeroAddress, true, true);

  const UniswapV4SwapAdapter = await ethers.getContractFactory("UniswapV4SwapAdapter");
  const swapAdapter = await UniswapV4SwapAdapter.deploy(await universalRouter.getAddress());
  await swapAdapter.waitForDeployment();

  const PaymentRouter = await ethers.getContractFactory("PaymentRouter");
  const paymentRouter = await PaymentRouter.deploy(await usdaio.getAddress(), await core.getAddress(), await acceptedTokenRegistry.getAddress(), await swapAdapter.getAddress());
  await paymentRouter.waitForDeployment();
  await core.setPaymentRouter(await paymentRouter.getAddress());
  await swapAdapter.setPaymentRouter(await paymentRouter.getAddress());

  const FRAINVRFVerifier = await ethers.getContractFactory("FRAINVRFVerifier");
  const vrfVerifier = await FRAINVRFVerifier.deploy();
  await vrfVerifier.waitForDeployment();
  const vrfVector = vrfData.verify.valid[0];
  const vrfPublicKey = Array.from(await vrfVerifier.decodePoint(vrfVector.pub));
  const vrfProof = Array.from(await vrfVerifier.decodeProof(vrfVector.pi));

  const stake = ethers.parseEther("1000");
  for (let i = 0; i < reviewerSigners.length; i++) {
    const reviewer = reviewerSigners[i];
    await usdaio.mint(reviewer.address, stake);
    await usdaio.connect(reviewer).approve(await stakeVault.getAddress(), stake);
    await reviewerRegistry
      .connect(reviewer)
      .registerReviewer(`${reviewer.address}.daio.eth`, ethers.keccak256(ethers.toUtf8Bytes(reviewer.address)), 1001 + i, DOMAIN_RESEARCH, vrfPublicKey, stake);
  }

  await usdaio.mint(requester.address, ethers.parseEther("1000"));
  await usdaio.connect(requester).approve(await paymentRouter.getAddress(), ethers.parseEther("1000"));

  return { requester, reviewers: reviewerSigners, reviewerRegistry, vrfCoordinator, commitReveal, paymentRouter, core, roundLedger, vrfProof };
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

async function findReviewCommitteeForCurrentPhase(fixture, requestId) {
  const lifecycle = await fixture.core.getRequestLifecycle(requestId);
  const reviewPhaseStartedBlock = BigInt(await ethers.provider.getBlockNumber());
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
  const seed = BigInt(ethers.id(`${label}:review`));
  const reportHash = ethers.id(`${label}:report`);
  const resultHash = await commitReveal.hashReviewReveal(requestId, reviewer.address, score, reportHash, uri);
  await commitReveal.connect(reviewer).commitReview(requestId, resultHash, seed, vrfProof);
  return { score, reportHash, uri, seed };
}

async function audit(commitReveal, requestId, auditor, targets, scores, label) {
  const seed = BigInt(ethers.id(`${label}:audit`));
  const targetAddresses = targets.map((target) => target.address);
  const resultHash = await commitReveal.hashAuditReveal(requestId, auditor.address, targetAddresses, scores);
  await commitReveal.connect(auditor).commitAudit(requestId, resultHash, seed, []);
  return { targets: targetAddresses, scores, seed };
}

describeFork("Sepolia fork E2E", function () {
  this.timeout(Number(process.env.SEPOLIA_FORK_TIMEOUT || "600000"));

  before(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: FORK_URL, ...(FORK_BLOCK ? { blockNumber: FORK_BLOCK } : {}) } }]
    });
  });

  it("sees official Sepolia integrations and runs DAIO direct USDAIO E2E on the fork", async function () {
    for (const address of Object.values(SEPOLIA)) {
      expect(await ethers.provider.getCode(address)).to.not.equal("0x");
    }

    const fixture = await deployForkFixture();
    const { requester, reviewers, reviewerRegistry, commitReveal, paymentRouter, core, roundLedger, vrfProof } = fixture;
    const registeredReviewers = reviewers.map((reviewer) => reviewer.address);
    expect(await reviewerRegistry.reviewerCount()).to.equal(BigInt(registeredReviewers.length));
    expect(await reviewerRegistry.reviewerAt(0)).to.equal(registeredReviewers[0]);
    expect(await reviewerRegistry.getReviewers()).to.deep.equal(registeredReviewers);

    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://fork-proposal", ethers.id("fork-proposal"), ethers.id("fork-rubric"), DOMAIN_RESEARCH, FAST, 0);
    const requestId = 1n;

    await core.startNextRequest();
    const selectedReviewers = await findReviewCommitteeForCurrentPhase(fixture, requestId);
    const reviewScores = [8000, 7000, 6000];
    const reviewCommits = [];
    for (let i = 0; i < selectedReviewers.length; i++) {
      const reviewer = selectedReviewers[i];
      reviewCommits.push(await review(commitReveal, requestId, reviewer, reviewScores[i], `ipfs://fork-review-${i}`, `reviewer-${i}`, vrfProof));
    }
    expect(await commitReveal.getReviewParticipants(requestId, 0)).to.deep.equal(selectedReviewers.map((reviewer) => reviewer.address));

    for (let i = 0; i < selectedReviewers.length; i++) {
      const reviewer = selectedReviewers[i];
      const commit = reviewCommits[i];
      await commitReveal.connect(reviewer).revealReview(requestId, commit.score, commit.reportHash, commit.uri, commit.seed);
    }

    const auditCommits = [];
    for (let i = 0; i < selectedReviewers.length; i++) {
      const auditor = selectedReviewers[i];
      const targets = selectedReviewers.filter((target) => target.address !== auditor.address);
      const scores = targets.map((target) => (target.address === selectedReviewers[0].address ? 9000 : 7000));
      auditCommits.push(await audit(commitReveal, requestId, auditor, targets, scores, `auditor-${i}`));
    }
    expect(await commitReveal.getAuditParticipants(requestId, 0)).to.deep.equal(selectedReviewers.map((reviewer) => reviewer.address));

    for (let i = 0; i < selectedReviewers.length; i++) {
      const auditor = selectedReviewers[i];
      const commit = auditCommits[i];
      await commitReveal.connect(auditor).revealAudit(requestId, commit.targets, commit.scores, commit.seed);
    }

    const attempt = (await core.getRequestLifecycle(requestId)).retryCount;
    const round0 = await roundLedger.getRoundAggregate(requestId, attempt, ROUND_REVIEW);
    const round1 = await roundLedger.getRoundAggregate(requestId, attempt, ROUND_AUDIT_CONSENSUS);
    const round2 = await roundLedger.getRoundAggregate(requestId, attempt, ROUND_REPUTATION_FINAL);
    const firstReviewerRound2 = await roundLedger.getReviewerRoundScore(requestId, attempt, ROUND_REPUTATION_FINAL, selectedReviewers[0].address);
    const firstReviewerAccounting = await roundLedger.getReviewerRoundAccounting(requestId, attempt, ROUND_REPUTATION_FINAL, selectedReviewers[0].address);

    expect(round0.score).to.equal(7000n);
    expect(round0.closed).to.equal(true);
    expect(round1.score).to.be.gt(0n);
    expect(round1.closed).to.equal(true);
    expect(round2.coverage).to.equal(10000n);
    expect(round2.score).to.be.gt(0n);
    expect(round2.closed).to.equal(true);
    expect(firstReviewerRound2.reputationScore).to.equal(10000n);
    expect(firstReviewerAccounting.reward).to.be.gt(0n);
  });
});
