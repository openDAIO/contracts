const { expect } = require("chai");
const { ethers } = require("hardhat");
const vrfData = require("../lib/vrf-solidity/test/data.json");

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const QUEUED = 1n;
const REVIEW_COMMIT = 2n;

function tierConfig() {
  return {
    reviewElectionDifficulty: 5000,
    auditElectionDifficulty: 5000,
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

function intentHash(requester, token, requiredUsdaio, proposalHash, rubricHash, domainMask, tier, priorityFee, chainId) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256", "bytes32", "bytes32", "uint256", "uint8", "uint256", "uint256"],
      [requester, token, requiredUsdaio, proposalHash, rubricHash, domainMask, tier, priorityFee, chainId]
    )
  );
}

function sortCurrencies(a, b) {
  return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
}

async function signRequestIntent(paymentRouter, requester, values) {
  const chainId = (await ethers.provider.getNetwork()).chainId;
  return requester.signTypedData(
    {
      name: "DAIOPaymentRouter",
      version: "1",
      chainId,
      verifyingContract: await paymentRouter.getAddress()
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

describe("PROPOSAL parity modules", function () {
  async function deployCoreFixture() {
    const [owner, treasury, requester, alice, bob] = await ethers.getSigners();

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
    const core = await DAIOCore.deploy(
      treasury.address,
      await commitReveal.getAddress(),
      await priorityQueue.getAddress(),
      await vrfCoordinator.getAddress(),
      2
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
    await core.setTierConfig(FAST, tierConfig());
    await stakeVault.setCoreOrSettlement(await core.getAddress());
    await stakeVault.setAuthorized(await reviewerRegistry.getAddress(), true);
    await reviewerRegistry.setCore(await core.getAddress());
    await reputationLedger.setCore(await core.getAddress());
    await reviewerRegistry.setReputationGate(await reputationLedger.getAddress(), 3, 3000, 7000);
    await commitReveal.setCore(await core.getAddress());
    await priorityQueue.setCore(await core.getAddress());

    const FRAINVRFVerifier = await ethers.getContractFactory("FRAINVRFVerifier");
    const vrfVerifier = await FRAINVRFVerifier.deploy();
    await vrfVerifier.waitForDeployment();
    const vrfVector = vrfData.verify.valid[0];
    const vrfPublicKey = Array.from(await vrfVerifier.decodePoint(vrfVector.pub));
    const vrfProof = Array.from(await vrfVerifier.decodeProof(vrfVector.pi));

    return {
      owner,
      treasury,
      requester,
      alice,
      bob,
      usdaio,
      stakeVault,
      reviewerRegistry,
      reputationLedger,
      commitReveal,
      priorityQueue,
      roundLedger,
      vrfPublicKey,
      vrfProof,
      core
    };
  }

  async function deployPaymentFixture(usdaio, core) {
    const USDAIO = await ethers.getContractFactory("USDAIOToken");
    const inputToken = await USDAIO.deploy((await ethers.getSigners())[0].address);
    await inputToken.waitForDeployment();

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

    return { inputToken, universalRouter, acceptedTokenRegistry, swapAdapter, paymentRouter };
  }

  it("keeps request creation and commit/reveal behind Router and Manager", async function () {
    const { requester, alice, core, vrfProof } = await deployCoreFixture();

    await expect(
      core
        .connect(requester)
        .createRequestFor(
          requester.address,
          "ipfs://direct",
          ethers.id("direct"),
          ethers.id("direct:rubric"),
          DOMAIN_RESEARCH,
          FAST,
          0
        )
    ).to.be.revertedWithCustomError(core, "InvalidAddress");

    await expect(core.connect(alice).submitReviewCommitFor(alice.address, 1, vrfProof)).to.be.revertedWithCustomError(core, "InvalidAddress");
    await expect(
      core.connect(alice).revealReviewFor(alice.address, 1, 8000, ethers.id("report"), "ipfs://report", 1)
    ).to.be.revertedWithCustomError(core, "InvalidAddress");
  });

  it("rejects ENS resolver mismatches and accepts ERC-8004 authorized agent wallets", async function () {
    const { alice, bob, usdaio, stakeVault, reviewerRegistry, vrfPublicKey } = await deployCoreFixture();
    const stake = ethers.parseEther("1000");
    const node = ethers.id("alice.daio.eth");

    const MockENSRegistry = await ethers.getContractFactory("MockENSRegistry");
    const ensRegistry = await MockENSRegistry.deploy();
    await ensRegistry.waitForDeployment();
    const MockENSResolver = await ethers.getContractFactory("MockENSResolver");
    const ensResolver = await MockENSResolver.deploy();
    await ensResolver.waitForDeployment();
    await ensRegistry.setResolver(node, await ensResolver.getAddress());

    const ENSVerifier = await ethers.getContractFactory("ENSVerifier");
    const ensVerifier = await ENSVerifier.deploy(await ensRegistry.getAddress());
    await ensVerifier.waitForDeployment();

    const MockERC8004Registry = await ethers.getContractFactory("MockERC8004Registry");
    const erc8004Registry = await MockERC8004Registry.deploy();
    await erc8004Registry.waitForDeployment();
    const ERC8004Adapter = await ethers.getContractFactory("ERC8004Adapter");
    const erc8004Adapter = await ERC8004Adapter.deploy(await erc8004Registry.getAddress(), await erc8004Registry.getAddress());
    await erc8004Adapter.waitForDeployment();

    await reviewerRegistry.setIdentityModules(await ensVerifier.getAddress(), await erc8004Adapter.getAddress());
    await erc8004Registry.setAgentWallet(1001, alice.address);
    await ensResolver.setAddr(node, bob.address);
    await usdaio.mint(alice.address, stake * 2n);
    await usdaio.connect(alice).approve(await stakeVault.getAddress(), stake * 2n);

    await expect(
      reviewerRegistry.connect(alice).registerReviewer("alice.daio.eth", node, 1001, DOMAIN_RESEARCH, vrfPublicKey, stake)
    ).to.be.revertedWithCustomError(reviewerRegistry, "IneligibleReviewer");

    await ensResolver.setAddr(node, alice.address);
    await reviewerRegistry.connect(alice).registerReviewer("alice.daio.eth", node, 1001, DOMAIN_RESEARCH, vrfPublicKey, stake);

    const reviewer = await reviewerRegistry.getReviewer(alice.address);
    expect(reviewer.registered).to.equal(true);
    expect(reviewer.ensNode).to.equal(node);
    expect(reviewer.ensName).to.equal("alice.daio.eth");
  });

  it("keeps ENS and ERC-8004 optional for reviewer registration", async function () {
    const { alice, bob, usdaio, stakeVault, reviewerRegistry, vrfPublicKey } = await deployCoreFixture();
    const stake = ethers.parseEther("1000");
    const node = ethers.id("alice.daio.eth");

    const MockENSRegistry = await ethers.getContractFactory("MockENSRegistry");
    const ensRegistry = await MockENSRegistry.deploy();
    await ensRegistry.waitForDeployment();
    const ENSVerifier = await ethers.getContractFactory("ENSVerifier");
    const ensVerifier = await ENSVerifier.deploy(await ensRegistry.getAddress());
    await ensVerifier.waitForDeployment();

    const MockERC8004Registry = await ethers.getContractFactory("MockERC8004Registry");
    const erc8004Registry = await MockERC8004Registry.deploy();
    await erc8004Registry.waitForDeployment();
    const ERC8004Adapter = await ethers.getContractFactory("ERC8004Adapter");
    const erc8004Adapter = await ERC8004Adapter.deploy(await erc8004Registry.getAddress(), await erc8004Registry.getAddress());
    await erc8004Adapter.waitForDeployment();

    await reviewerRegistry.setIdentityModules(await ensVerifier.getAddress(), await erc8004Adapter.getAddress());
    await usdaio.connect(bob).mint(bob.address, stake);
    await usdaio.connect(bob).approve(await stakeVault.getAddress(), stake);

    await reviewerRegistry.connect(bob).registerReviewer("", ethers.ZeroHash, 0, DOMAIN_RESEARCH, vrfPublicKey, stake);

    const reviewer = await reviewerRegistry.getReviewer(bob.address);
    expect(reviewer.registered).to.equal(true);
    expect(reviewer.agentId_).to.equal(0n);
    expect(reviewer.ensNode).to.equal(ethers.ZeroHash);
    expect(reviewer.ensName).to.equal("");

    await usdaio.connect(alice).mint(alice.address, stake);
    await usdaio.connect(alice).approve(await stakeVault.getAddress(), stake);
    await expect(
      reviewerRegistry.connect(alice).registerReviewer("alice.daio.eth", node, 0, DOMAIN_RESEARCH, vrfPublicKey, stake)
    ).to.be.revertedWithCustomError(reviewerRegistry, "IneligibleReviewer");
  });

  it("enumerates registered reviewers without duplicating re-registrations", async function () {
    const { alice, bob, usdaio, stakeVault, reviewerRegistry, vrfPublicKey } = await deployCoreFixture();
    const stake = ethers.parseEther("1000");

    await usdaio.mint(alice.address, stake * 2n);
    await usdaio.connect(alice).approve(await stakeVault.getAddress(), stake * 2n);
    await reviewerRegistry.connect(alice).registerReviewer("", ethers.ZeroHash, 0, DOMAIN_RESEARCH, vrfPublicKey, stake);
    await reviewerRegistry.connect(alice).registerReviewer("", ethers.ZeroHash, 0, DOMAIN_RESEARCH, vrfPublicKey, stake);

    await usdaio.mint(bob.address, stake);
    await usdaio.connect(bob).approve(await stakeVault.getAddress(), stake);
    await reviewerRegistry.connect(bob).registerReviewer("", ethers.ZeroHash, 0, DOMAIN_RESEARCH, vrfPublicKey, stake);

    expect(await reviewerRegistry.reviewerCount()).to.equal(2n);
    expect(await reviewerRegistry.reviewerAt(0)).to.equal(alice.address);
    expect(await reviewerRegistry.reviewerAt(1)).to.equal(bob.address);
    expect(await reviewerRegistry.getReviewers()).to.deep.equal([alice.address, bob.address]);
  });

  it("lets registered reviewers add stake without changing metadata", async function () {
    const { alice, bob, usdaio, stakeVault, reviewerRegistry, vrfPublicKey } = await deployCoreFixture();
    const stake = ethers.parseEther("1000");
    const topUp = ethers.parseEther("250");
    const agentId = 42;

    await expect(reviewerRegistry.connect(bob).addStake(topUp)).to.be.revertedWithCustomError(reviewerRegistry, "InvalidAmount");

    await usdaio.mint(alice.address, stake + topUp);
    await usdaio.connect(alice).approve(await stakeVault.getAddress(), stake + topUp);
    await reviewerRegistry.connect(alice).registerReviewer("", ethers.ZeroHash, agentId, DOMAIN_RESEARCH, vrfPublicKey, stake);

    await expect(reviewerRegistry.connect(alice).addStake(0)).to.be.revertedWithCustomError(reviewerRegistry, "InvalidAmount");
    await expect(reviewerRegistry.connect(alice).addStake(topUp))
      .to.emit(reviewerRegistry, "StakeAdded")
      .withArgs(alice.address, topUp, stake + topUp);

    const reviewer = await reviewerRegistry.getReviewer(alice.address);
    expect(reviewer.registered).to.equal(true);
    expect(reviewer.agentId_).to.equal(BigInt(agentId));
    expect(reviewer.domainMask).to.equal(DOMAIN_RESEARCH);
    expect(reviewer.stake).to.equal(stake + topUp);
    expect(await reviewerRegistry.availableStake(alice.address)).to.equal(stake + topUp);
    expect(await stakeVault.stakes(alice.address)).to.equal(stake + topUp);
  });

  it("lets any account faucet-mint USDAIO on test deployments", async function () {
    const { bob, usdaio } = await deployCoreFixture();
    const amount = ethers.parseEther("12345");

    await expect(usdaio.connect(bob).mint(bob.address, amount))
      .to.emit(usdaio, "Transfer")
      .withArgs(ethers.ZeroAddress, bob.address, amount);
    expect(await usdaio.balanceOf(bob.address)).to.equal(amount);
  });

  it("blocks external priority queue poisoning", async function () {
    const { alice, priorityQueue } = await deployCoreFixture();
    await expect(priorityQueue.connect(alice).push(1, ethers.id("poison"))).to.be.revertedWith("DAIOPriorityQueue: not core");
    await expect(priorityQueue.connect(alice).pop()).to.be.revertedWith("DAIOPriorityQueue: not core");
  });

  it("builds request, phase, epoch, and target specific VRF messages", async function () {
    const [, , , alice, bob] = await ethers.getSigners();
    const FRAINVRFVerifier = await ethers.getContractFactory("FRAINVRFVerifier");
    const vrfVerifier = await FRAINVRFVerifier.deploy();
    await vrfVerifier.waitForDeployment();
    const DAIOVRFCoordinator = await ethers.getContractFactory("DAIOVRFCoordinator");
    const coordinator = await DAIOVRFCoordinator.deploy(await vrfVerifier.getAddress());
    await coordinator.waitForDeployment();

    const coreAddress = ethers.Wallet.createRandom().address;
    const base = await coordinator.messageFor(coreAddress, 1, ethers.id("review"), 0, alice.address, ethers.ZeroAddress, 10, 2);
    const differentRequest = await coordinator.messageFor(coreAddress, 2, ethers.id("review"), 0, alice.address, ethers.ZeroAddress, 10, 2);
    const differentTarget = await coordinator.messageFor(coreAddress, 1, ethers.id("audit"), 0, alice.address, bob.address, 10, 2);

    expect(base).to.not.equal(differentRequest);
    expect(base).to.not.equal(differentTarget);
  });

  it("records ERC-8004 feedback only through the configured writer", async function () {
    const MockERC8004Registry = await ethers.getContractFactory("MockERC8004Registry");
    const erc8004Registry = await MockERC8004Registry.deploy();
    await erc8004Registry.waitForDeployment();
    const ERC8004Adapter = await ethers.getContractFactory("ERC8004Adapter");
    const adapter = await ERC8004Adapter.deploy(await erc8004Registry.getAddress(), await erc8004Registry.getAddress());
    await adapter.waitForDeployment();

    await expect(
      adapter.recordDAIOSignals(1001, 9000, 8000, 7000, 6000, 10000, 9500, true, "endpoint", "ipfs://feedback", ethers.id("feedback"))
    ).to.be.revertedWith("ERC8004Adapter: not writer");

    await adapter.setWriter((await ethers.getSigners())[0].address);
    await adapter.recordDAIOSignals(1001, 9000, 8000, 7000, 6000, 10000, 9500, true, "endpoint", "ipfs://feedback", ethers.id("feedback"));

    expect(await erc8004Registry.feedbackCount()).to.equal(7n);
    const reportQuality = await erc8004Registry.feedbackAt(0);
    const minorityOpinion = await erc8004Registry.feedbackAt(6);

    expect(reportQuality.tag1).to.equal("daio.reportQuality");
    expect(reportQuality.valueDecimals).to.equal(4n);
    expect(minorityOpinion.tag1).to.equal("daio.minorityOpinion");
    expect(minorityOpinion.value).to.equal(1n);
    expect(minorityOpinion.valueDecimals).to.equal(0n);
  });

  it("creates direct USDAIO requests through PaymentRouter and funds StakeVault escrow", async function () {
    const { requester, owner, usdaio, stakeVault, core } = await deployCoreFixture();
    const { paymentRouter } = await deployPaymentFixture(usdaio, core);

    const required = await core.baseRequestFee();
    await usdaio.mint(requester.address, required);
    await usdaio.connect(requester).approve(await paymentRouter.getAddress(), required);

    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://proposal", ethers.id("proposal"), ethers.id("rubric"), DOMAIN_RESEARCH, FAST, 0);

    const request = await core.getRequestLifecycle(1);
    expect(request.requester).to.equal(requester.address);
    expect(request.status).to.equal(QUEUED);
    expect(await stakeVault.requestRewardPool(1)).to.equal((required * 9000n) / 10000n);
    expect(await stakeVault.requestProtocolFee(1)).to.equal((required * 1000n) / 10000n);

    expect(await paymentRouter.latestRequestByRequester(requester.address)).to.equal(1n);
    expect(await paymentRouter.latestRequestByRequester(owner.address)).to.equal(0n);
    let latest = await paymentRouter.latestRequestState(requester.address);
    expect(latest.requestId).to.equal(1n);
    expect(latest.status).to.equal(QUEUED);
    expect(latest.processing).to.equal(true);
    expect(latest.completed).to.equal(false);

    await core.startNextRequest();
    latest = await paymentRouter.latestRequestState(requester.address);
    expect(latest.status).to.equal(REVIEW_COMMIT);
    expect(latest.processing).to.equal(true);
    expect(latest.completed).to.equal(false);
  });

  it("exposes settings, progress, and submission details through DAIOInfoReader", async function () {
    const { requester, alice, usdaio, stakeVault, reviewerRegistry, commitReveal, vrfPublicKey, vrfProof, core } =
      await deployCoreFixture();
    const { paymentRouter } = await deployPaymentFixture(usdaio, core);
    const DAIOInfoReader = await ethers.getContractFactory("DAIOInfoReader");
    const infoReader = await DAIOInfoReader.deploy(await core.getAddress());
    await infoReader.waitForDeployment();

    await core.setTierConfig(FAST, {
      ...tierConfig(),
      reviewElectionDifficulty: 10000,
      auditElectionDifficulty: 10000,
      reviewCommitQuorum: 1,
      reviewRevealQuorum: 1,
      auditCommitQuorum: 1,
      auditRevealQuorum: 1
    });

    const stake = ethers.parseEther("1000");
    await usdaio.mint(alice.address, stake);
    await usdaio.connect(alice).approve(await stakeVault.getAddress(), stake);
    await reviewerRegistry.connect(alice).registerReviewer("", ethers.ZeroHash, 0, DOMAIN_RESEARCH, vrfPublicKey, stake);

    const required = await core.baseRequestFee();
    await usdaio.mint(requester.address, required);
    await usdaio.connect(requester).approve(await paymentRouter.getAddress(), required);
    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://info-reader", ethers.id("info-reader"), ethers.id("rubric"), DOMAIN_RESEARCH, FAST, 0);

    const overview = await infoReader.systemOverview();
    expect(overview.paymentRouter).to.equal(await paymentRouter.getAddress());
    expect(overview.stakeVault).to.equal(await stakeVault.getAddress());
    expect(overview.requestCount).to.equal(1n);

    const fastConfig = await infoReader.tierConfig(FAST);
    expect(fastConfig.reviewCommitQuorum).to.equal(1n);
    expect(fastConfig.auditRevealTimeout).to.equal(30n * 60n);

    let requestInfo = await infoReader.requestInfo(1);
    expect(requestInfo.requester).to.equal(requester.address);
    expect(requestInfo.status).to.equal(QUEUED);
    expect(requestInfo.feePaid).to.equal(required);
    expect(requestInfo.rewardPool).to.equal((required * 9000n) / 10000n);

    await core.startNextRequest();
    let phase = await infoReader.requestPhase(1);
    expect(phase.status).to.equal(REVIEW_COMMIT);
    expect(phase.count).to.equal(0n);
    expect(phase.quorum).to.equal(1n);
    expect(phase.timeout).to.equal(30n * 60n);
    expect(phase.processing).to.equal(true);
    expect(phase.completed).to.equal(false);

    const reportHash = ethers.id("alice-report");
    const reportURI = "ipfs://alice-report";
    const score = 8000;
    const seed = 123n;
    const resultHash = await commitReveal.hashReviewReveal(1, alice.address, score, reportHash, reportURI);
    await commitReveal.connect(alice).commitReview(1, resultHash, seed, vrfProof);

    let [reviewCommitters, revealedReviewers] = await infoReader.requestParticipants(1);
    expect(reviewCommitters).to.deep.equal([alice.address]);
    expect(revealedReviewers).to.deep.equal([]);

    let submission = await infoReader.reviewSubmission(1, alice.address);
    expect(submission.commitHash).to.equal(
      ethers.solidityPackedKeccak256(["bytes32", "address", "uint256"], [resultHash, alice.address, seed])
    );
    expect(submission.committed).to.equal(true);
    expect(submission.revealed).to.equal(false);

    await commitReveal.connect(alice).revealReview(1, score, reportHash, reportURI, seed);

    [reviewCommitters, revealedReviewers] = await infoReader.requestParticipants(1);
    expect(reviewCommitters).to.deep.equal([alice.address]);
    expect(revealedReviewers).to.deep.equal([alice.address]);

    requestInfo = await infoReader.requestInfo(1);
    expect(requestInfo.reviewCommitCount).to.equal(1n);
    expect(requestInfo.reviewRevealCount).to.equal(1n);

    submission = await infoReader.reviewSubmission(1, alice.address);
    expect(submission.revealed).to.equal(true);
    expect(submission.proposalScore).to.equal(BigInt(score));
    expect(submission.reportHash).to.equal(reportHash);
  });

  it("lets a relayer submit a signed USDAIO request while preserving the requester", async function () {
    const { requester, alice: relayer, usdaio, stakeVault, core } = await deployCoreFixture();
    const { paymentRouter } = await deployPaymentFixture(usdaio, core);

    const priorityFee = ethers.parseEther("3");
    const required = (await core.baseRequestFee()) + priorityFee;
    await usdaio.mint(requester.address, required);
    await usdaio.connect(requester).approve(await paymentRouter.getAddress(), required);

    const block = await ethers.provider.getBlock("latest");
    const intent = {
      proposalURI: "ipfs://gasless-proposal",
      proposalHash: ethers.id("gasless-proposal"),
      rubricHash: ethers.id("gasless-rubric"),
      domainMask: DOMAIN_RESEARCH,
      tier: FAST,
      priorityFee,
      deadline: BigInt(block.timestamp + 3600)
    };
    const signature = await signRequestIntent(paymentRouter, requester, intent);

    await expect(
      paymentRouter
        .connect(relayer)
        .createRequestWithUSDAIOBySig(
          requester.address,
          "ipfs://tampered-proposal",
          intent.proposalHash,
          intent.rubricHash,
          intent.domainMask,
          intent.tier,
          intent.priorityFee,
          intent.deadline,
          signature
        )
    ).to.be.revertedWith("PaymentRouter: bad signature");
    expect(await paymentRouter.nonces(requester.address)).to.equal(0n);

    await expect(
      paymentRouter
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
          signature
        )
    )
      .to.emit(paymentRouter, "RequestPaid")
      .withArgs(requester.address, 1n, await usdaio.getAddress(), required);

    const request = await core.getRequestLifecycle(1);
    expect(request.requester).to.equal(requester.address);
    expect(request.status).to.equal(QUEUED);
    expect(await stakeVault.requestRewardPool(1)).to.equal((required * 9000n) / 10000n);
    expect(await paymentRouter.latestRequestByRequester(requester.address)).to.equal(1n);
    expect(await paymentRouter.latestRequestByRequester(relayer.address)).to.equal(0n);
    expect(await paymentRouter.nonces(requester.address)).to.equal(1n);

    await expect(
      paymentRouter
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
          signature
        )
    ).to.be.revertedWith("PaymentRouter: bad signature");
  });

  it("swaps accepted ERC20 exact-output payments, consumes hook validation, and refunds leftover input", async function () {
    const { requester, owner, usdaio, core } = await deployCoreFixture();
    const { inputToken, universalRouter, paymentRouter, acceptedTokenRegistry, swapAdapter } = await deployPaymentFixture(usdaio, core);

    const MockV4PoolManager = await ethers.getContractFactory("MockV4PoolManager");
    const poolManager = await MockV4PoolManager.deploy();
    await poolManager.waitForDeployment();
    const DAIOAutoConvertHook = await ethers.getContractFactory("DAIOAutoConvertHook");
    const hook = await DAIOAutoConvertHook.deploy(await poolManager.getAddress(), await paymentRouter.getAddress(), await usdaio.getAddress(), owner.address);
    await hook.waitForDeployment();
    await hook.setIntentWriter(await swapAdapter.getAddress(), true);
    await hook.setAllowedRouter(await universalRouter.getAddress(), true);
    await swapAdapter.setAutoConvertHook(await hook.getAddress());

    await acceptedTokenRegistry.setAcceptedToken(await inputToken.getAddress(), true, true);

    const required = await core.baseRequestFee();
    const amountInMax = ethers.parseEther("200");
    const inputUsed = ethers.parseEther("50");
    const proposalHash = ethers.id("proposal-swap");
    const rubricHash = ethers.id("rubric-swap");
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const calculatedIntent = intentHash(
      requester.address,
      await inputToken.getAddress(),
      required,
      proposalHash,
      rubricHash,
      DOMAIN_RESEARCH,
      FAST,
      0,
      chainId
    );
    const [currency0, currency1] = sortCurrencies(await inputToken.getAddress(), await usdaio.getAddress());
    const key = { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: await hook.getAddress() };
    const poolKey = await hook.poolKeyHash(key);
    const usdaioIsCurrency0 = currency0.toLowerCase() === (await usdaio.getAddress()).toLowerCase();
    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [calculatedIntent]);
    await hook.setPool(poolKey, true);

    await inputToken.mint(requester.address, amountInMax);
    await inputToken.connect(requester).approve(await paymentRouter.getAddress(), amountInMax);
    await usdaio.mint(await universalRouter.getAddress(), required);

    const routerCalldata = universalRouter.interface.encodeFunctionData("swapWithV4Hook", [
      await inputToken.getAddress(),
      await usdaio.getAddress(),
      await paymentRouter.getAddress(),
      inputUsed,
      required,
      await poolManager.getAddress(),
      await hook.getAddress(),
      await universalRouter.getAddress(),
      key,
      usdaioIsCurrency0 ? required : 0,
      usdaioIsCurrency0 ? 0 : required,
      hookData
    ]);

    await paymentRouter
      .connect(requester)
      .createRequestWithERC20(
        await inputToken.getAddress(),
        amountInMax,
        routerCalldata,
        "ipfs://proposal-swap",
        proposalHash,
        rubricHash,
        DOMAIN_RESEARCH,
        FAST,
        0
      );

    expect(await inputToken.balanceOf(requester.address)).to.equal(amountInMax - inputUsed);
    expect((await core.getRequestLifecycle(1)).requester).to.equal(requester.address);
    expect((await hook.intents(calculatedIntent)).registered).to.equal(false);
    expect(await usdaio.balanceOf(owner.address)).to.be.gte(0n);
  });

  it("reverts adapter swaps when Universal Router does not consume hook validation", async function () {
    const { requester, owner, usdaio, core } = await deployCoreFixture();
    const { inputToken, universalRouter, paymentRouter, acceptedTokenRegistry, swapAdapter } = await deployPaymentFixture(usdaio, core);

    const MockV4PoolManager = await ethers.getContractFactory("MockV4PoolManager");
    const poolManager = await MockV4PoolManager.deploy();
    await poolManager.waitForDeployment();
    const DAIOAutoConvertHook = await ethers.getContractFactory("DAIOAutoConvertHook");
    const hook = await DAIOAutoConvertHook.deploy(await poolManager.getAddress(), await paymentRouter.getAddress(), await usdaio.getAddress(), owner.address);
    await hook.waitForDeployment();
    await hook.setIntentWriter(await swapAdapter.getAddress(), true);
    await swapAdapter.setAutoConvertHook(await hook.getAddress());
    await acceptedTokenRegistry.setAcceptedToken(await inputToken.getAddress(), true, true);

    const required = await core.baseRequestFee();
    const amountInMax = ethers.parseEther("200");
    const inputUsed = ethers.parseEther("50");
    await inputToken.mint(requester.address, amountInMax);
    await inputToken.connect(requester).approve(await paymentRouter.getAddress(), amountInMax);
    await usdaio.mint(await universalRouter.getAddress(), required);

    const routerCalldata = universalRouter.interface.encodeFunctionData("swap", [
      await inputToken.getAddress(),
      await usdaio.getAddress(),
      await paymentRouter.getAddress(),
      inputUsed,
      required
    ]);

    await expect(
      paymentRouter
        .connect(requester)
        .createRequestWithERC20(
          await inputToken.getAddress(),
          amountInMax,
          routerCalldata,
          "ipfs://proposal-swap",
          ethers.id("proposal-swap"),
          ethers.id("rubric-swap"),
          DOMAIN_RESEARCH,
          FAST,
          0
        )
    ).to.be.revertedWith("DAIOAutoConvertHook: unconsumed intent");
  });

  it("validates real v4 afterSwap hook sender, pool pair, intent, and USDAIO output", async function () {
    const [owner, router, blockedRouter] = await ethers.getSigners();
    const USDAIO = await ethers.getContractFactory("USDAIOToken");
    const usdaio = await USDAIO.deploy(owner.address);
    await usdaio.waitForDeployment();
    const inputToken = await USDAIO.deploy(owner.address);
    await inputToken.waitForDeployment();
    const otherToken = await USDAIO.deploy(owner.address);
    await otherToken.waitForDeployment();

    const MockV4PoolManager = await ethers.getContractFactory("MockV4PoolManager");
    const poolManager = await MockV4PoolManager.deploy();
    await poolManager.waitForDeployment();
    const DAIOAutoConvertHook = await ethers.getContractFactory("DAIOAutoConvertHook");
    const hook = await DAIOAutoConvertHook.deploy(await poolManager.getAddress(), owner.address, await usdaio.getAddress(), owner.address);
    await hook.waitForDeployment();
    await hook.setAllowedRouter(router.address, true);

    const [currency0, currency1] = sortCurrencies(await inputToken.getAddress(), await usdaio.getAddress());
    const key = { currency0, currency1, fee: 3000, tickSpacing: 60, hooks: await hook.getAddress() };
    const poolKey = await hook.poolKeyHash(key);
    await hook.setPool(poolKey, true);

    const required = 10_000n;
    const intent = ethers.id("after-swap-intent");
    await hook.registerIntent(intent, await inputToken.getAddress(), required);
    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [intent]);
    const usdaioIsCurrency0 = currency0.toLowerCase() === (await usdaio.getAddress()).toLowerCase();
    await expect(
      poolManager.callAfterSwap(
        await hook.getAddress(),
        router.address,
        key,
        true,
        -1,
        0,
        usdaioIsCurrency0 ? required : 0,
        usdaioIsCurrency0 ? 0 : required,
        hookData
      )
    ).to.emit(hook, "AutoConvertValidated");

    const negativeOutputIntent = ethers.id("negative-output-intent");
    await hook.registerIntent(negativeOutputIntent, await inputToken.getAddress(), required);
    await expect(
      poolManager.callAfterSwap(
        await hook.getAddress(),
        router.address,
        key,
        true,
        -1,
        0,
        usdaioIsCurrency0 ? -required : 0,
        usdaioIsCurrency0 ? 0 : -required,
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [negativeOutputIntent])
      )
    ).to.be.revertedWith("DAIOAutoConvertHook: insufficient output");

    const wrongRouterIntent = ethers.id("wrong-router-intent");
    await hook.registerIntent(wrongRouterIntent, await inputToken.getAddress(), required);
    await expect(
      poolManager.callAfterSwap(
        await hook.getAddress(),
        blockedRouter.address,
        key,
        true,
        -1,
        0,
        usdaioIsCurrency0 ? required : 0,
        usdaioIsCurrency0 ? 0 : required,
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [wrongRouterIntent])
      )
    ).to.be.revertedWith("DAIOAutoConvertHook: router not allowed");

    const [badCurrency0, badCurrency1] = sortCurrencies(await otherToken.getAddress(), await usdaio.getAddress());
    const badKey = { currency0: badCurrency0, currency1: badCurrency1, fee: 3000, tickSpacing: 60, hooks: await hook.getAddress() };
    await hook.setPool(await hook.poolKeyHash(badKey), true);
    const badPairIntent = ethers.id("bad-pair-intent");
    await hook.registerIntent(badPairIntent, await inputToken.getAddress(), required);
    const usdaioIsBadCurrency0 = badCurrency0.toLowerCase() === (await usdaio.getAddress()).toLowerCase();
    await expect(
      poolManager.callAfterSwap(
        await hook.getAddress(),
        router.address,
        badKey,
        true,
        -1,
        0,
        usdaioIsBadCurrency0 ? required : 0,
        usdaioIsBadCurrency0 ? 0 : required,
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [badPairIntent])
      )
    ).to.be.revertedWith("DAIOAutoConvertHook: bad pair");

    const lowOutputIntent = ethers.id("low-output-intent");
    await hook.registerIntent(lowOutputIntent, await inputToken.getAddress(), required);
    await expect(
      poolManager.callAfterSwap(
        await hook.getAddress(),
        router.address,
        key,
        true,
        -1,
        0,
        usdaioIsCurrency0 ? required - 1n : 0,
        usdaioIsCurrency0 ? 0 : required - 1n,
        ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [lowOutputIntent])
      )
    ).to.be.revertedWith("DAIOAutoConvertHook: insufficient output");
  });
});
