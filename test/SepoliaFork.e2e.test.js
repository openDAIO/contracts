const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const vrfData = require("../lib/vrf-solidity/test/data.json");

const RUN_FORK = process.env.RUN_SEPOLIA_FORK === "true";
const describeFork = RUN_FORK ? describe : describe.skip;
const FORK_URL = process.env.SEPOLIA_RPC_URL || process.env.HARDHAT_FORK_URL || "https://sepolia.drpc.org";

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const FINALIZED = 6n;

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
    reviewElectionDifficulty: 10000,
    auditElectionDifficulty: 10000,
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

async function deployForkFixture() {
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

  const MockVRFCoordinator = await ethers.getContractFactory("MockVRFCoordinator");
  const vrfCoordinator = await MockVRFCoordinator.deploy();
  await vrfCoordinator.waitForDeployment();

  const DAIOCore = await ethers.getContractFactory("DAIOCore");
  const core = await DAIOCore.deploy(treasury.address, await commitReveal.getAddress(), await priorityQueue.getAddress(), await vrfCoordinator.getAddress());
  await core.waitForDeployment();

  await core.setModules(
    await stakeVault.getAddress(),
    await reviewerRegistry.getAddress(),
    await assignmentManager.getAddress(),
    await consensusScoring.getAddress(),
    await settlement.getAddress(),
    await reputationLedger.getAddress()
  );
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
  const reviewers = [alice, bob, carol];
  for (let i = 0; i < reviewers.length; i++) {
    const reviewer = reviewers[i];
    await usdaio.mint(reviewer.address, stake);
    await usdaio.connect(reviewer).approve(await stakeVault.getAddress(), stake);
    await reviewerRegistry
      .connect(reviewer)
      .registerReviewer(`${reviewer.address}.daio.eth`, ethers.keccak256(ethers.toUtf8Bytes(reviewer.address)), 1001 + i, DOMAIN_RESEARCH, vrfPublicKey, stake);
  }

  await usdaio.mint(requester.address, ethers.parseEther("1000"));
  await usdaio.connect(requester).approve(await paymentRouter.getAddress(), ethers.parseEther("1000"));

  return { requester, alice, bob, carol, commitReveal, paymentRouter, core, vrfProof };
}

async function review(commitReveal, requestId, reviewer, score, uri, label, vrfProof) {
  const seed = BigInt(ethers.id(`${label}:review`));
  const reportHash = ethers.id(`${label}:report`);
  const resultHash = await commitReveal.hashReviewReveal(requestId, reviewer.address, score, reportHash, uri);
  await commitReveal.connect(reviewer).commitReview(requestId, resultHash, seed, vrfProof);
  return { score, reportHash, uri, seed };
}

async function audit(commitReveal, requestId, auditor, targets, scores, label, vrfProof) {
  const seed = BigInt(ethers.id(`${label}:audit`));
  const targetAddresses = targets.map((target) => target.address);
  const resultHash = await commitReveal.hashAuditReveal(requestId, auditor.address, targetAddresses, scores);
  await commitReveal.connect(auditor).commitAudit(requestId, resultHash, seed, [vrfProof, vrfProof]);
  return { targets: targetAddresses, scores, seed };
}

describeFork("Sepolia fork E2E", function () {
  this.timeout(120000);

  before(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [{ forking: { jsonRpcUrl: FORK_URL } }]
    });
  });

  it("sees official Sepolia integrations and runs DAIO direct USDAIO E2E on the fork", async function () {
    for (const address of Object.values(SEPOLIA)) {
      expect(await ethers.provider.getCode(address)).to.not.equal("0x");
    }

    const { requester, alice, bob, carol, commitReveal, paymentRouter, core, vrfProof } = await deployForkFixture();
    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://fork-proposal", ethers.id("fork-proposal"), ethers.id("fork-rubric"), DOMAIN_RESEARCH, FAST, 0);
    const requestId = 1n;

    await core.startNextRequest();
    const aliceReview = await review(commitReveal, requestId, alice, 8000, "ipfs://fork-alice", "alice", vrfProof);
    const bobReview = await review(commitReveal, requestId, bob, 6000, "ipfs://fork-bob", "bob", vrfProof);
    const carolReview = await review(commitReveal, requestId, carol, 2000, "ipfs://fork-carol", "carol", vrfProof);

    await commitReveal.connect(alice).revealReview(requestId, aliceReview.score, aliceReview.reportHash, aliceReview.uri, aliceReview.seed);
    await commitReveal.connect(bob).revealReview(requestId, bobReview.score, bobReview.reportHash, bobReview.uri, bobReview.seed);
    await commitReveal.connect(carol).revealReview(requestId, carolReview.score, carolReview.reportHash, carolReview.uri, carolReview.seed);

    const aliceAudit = await audit(commitReveal, requestId, alice, [bob, carol], [7000, 4000], "alice", vrfProof);
    const bobAudit = await audit(commitReveal, requestId, bob, [alice, carol], [9000, 4500], "bob", vrfProof);
    const carolAudit = await audit(commitReveal, requestId, carol, [alice, bob], [8800, 7200], "carol", vrfProof);

    await commitReveal.connect(alice).revealAudit(requestId, aliceAudit.targets, aliceAudit.scores, aliceAudit.seed);
    await commitReveal.connect(bob).revealAudit(requestId, bobAudit.targets, bobAudit.scores, bobAudit.seed);
    await commitReveal.connect(carol).revealAudit(requestId, carolAudit.targets, carolAudit.scores, carolAudit.seed);
    await core.finalizeRequest(requestId);

    const result = await core.getRequestFinalResult(requestId);
    expect(result.status).to.equal(FINALIZED);
    expect(result.auditCoverage).to.equal(10000n);
  });
});
