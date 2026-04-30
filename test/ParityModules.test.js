const { expect } = require("chai");
const { ethers } = require("hardhat");
const vrfData = require("../lib/vrf-solidity/test/data.json");

const DOMAIN_RESEARCH = 1;
const FAST = 0;
const QUEUED = 1n;

describe("PROPOSAL parity modules", function () {
  async function deployCoreFixture() {
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

    const FRAINVRFVerifier = await ethers.getContractFactory("FRAINVRFVerifier");
    const vrfVerifier = await FRAINVRFVerifier.deploy();
    await vrfVerifier.waitForDeployment();
    const vrfVector = vrfData.verify.valid[0];
    const vrfPublicKey = Array.from(await vrfVerifier.decodePoint(vrfVector.pub));

    return { owner, treasury, requester, alice, bob, carol, usdaio, commitReveal, priorityQueue, vrfCoordinator, vrfPublicKey, core };
  }

  async function fundAndApproveReviewer(usdaio, core, reviewer, amount = ethers.parseEther("1000")) {
    await usdaio.mint(reviewer.address, amount);
    await usdaio.connect(reviewer).approve(await core.getAddress(), amount);
    return amount;
  }

  it("rejects ENS resolver mismatches and accepts ERC-8004 authorized agent wallets", async function () {
    const { alice, bob, usdaio, vrfPublicKey, core } = await deployCoreFixture();
    const stake = await fundAndApproveReviewer(usdaio, core, alice);
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

    await core.setIdentityModules(await ensVerifier.getAddress(), await erc8004Adapter.getAddress());
    await erc8004Registry.setAgentWallet(1001, alice.address);
    await ensResolver.setAddr(node, bob.address);

    await expect(
      core.connect(alice).registerReviewer("alice.daio.eth", node, 1001, DOMAIN_RESEARCH, vrfPublicKey, stake)
    ).to.be.revertedWithCustomError(core, "IneligibleReviewer");

    await ensResolver.setAddr(node, alice.address);
    await core.connect(alice).registerReviewer("alice.daio.eth", node, 1001, DOMAIN_RESEARCH, vrfPublicKey, stake);

    const reviewer = await core.reviewers(alice.address);
    expect(reviewer.registered).to.equal(true);
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

  it("records ERC-8004 feedback with DAIO tags and expected decimals", async function () {
    const MockERC8004Registry = await ethers.getContractFactory("MockERC8004Registry");
    const erc8004Registry = await MockERC8004Registry.deploy();
    await erc8004Registry.waitForDeployment();
    const ERC8004Adapter = await ethers.getContractFactory("ERC8004Adapter");
    const adapter = await ERC8004Adapter.deploy(await erc8004Registry.getAddress(), await erc8004Registry.getAddress());
    await adapter.waitForDeployment();

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

  it("creates direct USDAIO requests through PaymentRouter", async function () {
    const { requester, usdaio, core } = await deployCoreFixture();
    const { paymentRouter } = await deployPaymentFixture(usdaio, core);

    const required = await core.baseRequestFee();
    await usdaio.mint(requester.address, required);
    await usdaio.connect(requester).approve(await paymentRouter.getAddress(), required);

    await paymentRouter
      .connect(requester)
      .createRequestWithUSDAIO("ipfs://proposal", ethers.id("proposal"), ethers.id("rubric"), DOMAIN_RESEARCH, FAST, 0);

    const request = await core.requests(1);
    expect(request.requester).to.equal(requester.address);
    expect(request.status).to.equal(QUEUED);
  });

  it("swaps accepted ERC20 exact-output payments and refunds leftover input", async function () {
    const { owner, requester, usdaio, core } = await deployCoreFixture();
    const { inputToken, universalRouter, paymentRouter, acceptedTokenRegistry } = await deployPaymentFixture(usdaio, core);

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

    await paymentRouter
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
      );

    expect(await inputToken.balanceOf(requester.address)).to.equal(amountInMax - inputUsed);
    expect((await core.requests(1)).requester).to.equal(requester.address);
    expect(await usdaio.balanceOf(owner.address)).to.be.gte(0n);
  });

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
});
