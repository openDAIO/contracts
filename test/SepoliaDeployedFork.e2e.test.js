const { expect } = require("chai");
const { artifacts, ethers, network } = require("hardhat");
const vrfData = require("../lib/vrf-solidity/test/data.json");

const RUN_DEPLOYED_FORK = process.env.RUN_SEPOLIA_DEPLOYED_FORK === "true";
const describeDeployedFork = RUN_DEPLOYED_FORK ? describe : describe.skip;
const FORK_URL = process.env.SEPOLIA_RPC_URL || process.env.HARDHAT_FORK_URL || "https://sepolia.drpc.org";
const FORK_BLOCK = Number(process.env.SEPOLIA_FORK_BLOCK || "10769290");

const DEPLOYER = "0x2f149CaA0e931e13f6F32bd3E46eFc6e96bcC36A";
const DOMAIN_RESEARCH = 1;
const FAST = 0;
const REVIEW_COMMIT = 2n;
const FINALIZED = 6n;
const SCALE = 10000n;
const ROUND_REVIEW = 0;
const ROUND_AUDIT_CONSENSUS = 1;
const ROUND_REPUTATION_FINAL = 2;
const ELECTION_DIFFICULTY = 5000n;
const REVIEW_SORTITION = ethers.id("DAIO_REVIEW_SORTITION");
const AUDIT_SORTITION = ethers.id("DAIO_AUDIT_SORTITION");

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
  usdaio: "0x7F302FDD7787B9f910eb17D622f464e2069579a5",
  stakeVault: "0xa176D7E4017d23731abbc3F1346d409EaDE758b9",
  reviewerRegistry: "0xb7Ac502df1243bf1F8f0CF40Db94FC8CA7438750",
  assignmentManager: "0x2b75393c25Eb25994FECF277bB2E7a64262da5b0",
  consensusScoring: "0x4b4C039984eD8b10F5462E484eCC3699e6316a39",
  settlement: "0x892965b210d2C7D992D04B9bbd24A3fB5424ad38",
  reputationLedger: "0xdf7aED5a791D0Ad11Ff4bdF830596d867CbB2382",
  commitReveal: "0xf0FfFD8a1eFddaC5D6338C0874723536f51908BB",
  priorityQueue: "0x165896b4D193f31fD275d41Ae121af141B0eff16",
  vrfVerifier: "0xCfedf4e7bDAfE887aBC448703463C7ee5203f1F7",
  vrfCoordinator: "0x3C1a4a64CBa60606BF68f7232d8488d60f750f93",
  core: "0x615739d66bf0cB1429401fbB71B737A59B53967C",
  roundLedger: "0x4afb1cf2e243e5EFF1b9e6bF8ec70466BA7fFC36",
  erc8004Adapter: "0x1aEeDB2bC6f9c0Db0C18066815c8066462dCD2bC",
  acceptedTokenRegistry: "0x70C99D34ac5D90C5AaaA519A4a05daae81959A65",
  swapAdapter: "0xf63f1d7F73Ce069217F3ef56dB743c00BD4eB821",
  paymentRouter: "0x0c824cfa27C1F355DF3996B721AE30aE1C9d1920",
  ensVerifier: "0x0A22019CB6EE37eD924334785850fc792a524dC8",
  autoConvertHook: "0xDDEbF6068997502F80CD1dAe5AB5d5Dd9ED9C040"
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
  const auditPhaseStartedBlock = BigInt(reviewPhaseStartedBlock) + 4n;

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

async function audit(commitReveal, requestId, auditor, targets, scores, label, vrfProof) {
  const seed = BigInt(ethers.id(`${label}:deployed-audit`));
  const targetAddresses = targets.map((target) => target.address);
  const resultHash = await commitReveal.hashAuditReveal(requestId, auditor.address, targetAddresses, scores);
  await commitReveal.connect(auditor).commitAudit(requestId, resultHash, seed, [vrfProof]);
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
    const reviewerCandidates = signers.slice(2);

    await contracts.reviewerRegistry.connect(owner).setIdentityModules(ethers.ZeroAddress, ethers.ZeroAddress);
    await contracts.core.connect(owner).setTierConfig(FAST, fastConfig());
    const mockVrf = await artifacts.readArtifact("MockVRFCoordinator");
    await network.provider.request({ method: "hardhat_setCode", params: [DEPLOYED.vrfCoordinator, mockVrf.deployedBytecode] });

    const vrfVector = vrfData.verify.valid[0];
    const vrfPublicKey = Array.from(await contracts.vrfVerifier.decodePoint(vrfVector.pub));
    const vrfProof = Array.from(await contracts.vrfVerifier.decodeProof(vrfVector.pi));
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

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const fixture = { ...contracts, reviewers: reviewerCandidates, vrfPublicKey, vrfProof, chainId, useOnchainSortition: true };
    const [alice, bob] = await findReviewPairForPhase(fixture, requestId, BigInt(startReceipt.blockNumber));
    for (const [index, reviewer] of [alice, bob].entries()) {
      await contracts.usdaio.connect(owner).mint(reviewer.address, stake);
      await contracts.usdaio.connect(reviewer).approve(DEPLOYED.stakeVault, stake);
      await contracts.reviewerRegistry
        .connect(reviewer)
        .registerReviewer(`${reviewer.address}.deployed.daio.eth`, ethers.keccak256(ethers.toUtf8Bytes(reviewer.address)), 10_001 + index, DOMAIN_RESEARCH, vrfPublicKey, stake);
    }

    const aliceReview = await review(contracts.commitReveal, requestId, alice, 8000, "ipfs://deployed-alice", "alice", vrfProof);
    const bobReview = await review(contracts.commitReveal, requestId, bob, 6000, "ipfs://deployed-bob", "bob", vrfProof);
    expect(await contracts.commitReveal.getReviewParticipants(requestId, 0)).to.deep.equal([alice.address, bob.address]);

    await contracts.commitReveal.connect(alice).revealReview(requestId, aliceReview.score, aliceReview.reportHash, aliceReview.uri, aliceReview.seed);
    await contracts.commitReveal.connect(bob).revealReview(requestId, bobReview.score, bobReview.reportHash, bobReview.uri, bobReview.seed);

    const aliceAudit = await audit(contracts.commitReveal, requestId, alice, [bob], [7000], "alice", vrfProof);
    const bobAudit = await audit(contracts.commitReveal, requestId, bob, [alice], [9000], "bob", vrfProof);
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
