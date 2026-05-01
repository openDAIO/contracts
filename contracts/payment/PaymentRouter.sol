// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IDAIOCorePayment {
    function baseRequestFee() external view returns (uint256);
    function stakeVault() external view returns (address);
    function getRequestLifecycle(uint256 requestId)
        external
        view
        returns (
            address requester,
            uint8 status,
            uint256 feePaid,
            uint256 priorityFee,
            uint256 retryCount,
            uint256 committeeEpoch,
            uint256 auditEpoch,
            uint256 activePriority,
            bool lowConfidence
        );

    function createRequestFor(
        address requester,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external returns (uint256);
}

interface IAcceptedTokenRegistry {
    function acceptedTokens(address token) external view returns (bool);
    function requiresSwap(address token) external view returns (bool);
}

interface IUniswapV4SwapAdapter {
    function swapExactOutput(
        address inputToken,
        address outputToken,
        uint256 amountInMax,
        uint256 amountOut,
        address payer,
        address recipient,
        bytes calldata routerCalldata,
        bytes32 intentHash
    ) external returns (uint256 amountInUsed);

    function swapExactOutputETH(
        address outputToken,
        uint256 amountOut,
        address recipient,
        bytes calldata routerCalldata,
        bytes32 intentHash
    ) external payable returns (uint256 amountInUsed);
}

contract PaymentRouter {
    uint8 internal constant STATUS_QUEUED = 1;
    uint8 internal constant STATUS_AUDIT_REVEAL = 5;
    uint8 internal constant STATUS_FINALIZED = 6;

    IERC20Minimal public immutable usdaio;
    IDAIOCorePayment public immutable core;
    IAcceptedTokenRegistry public immutable acceptedTokenRegistry;
    IUniswapV4SwapAdapter public immutable swapAdapter;
    mapping(address requester => uint256 requestId) public latestRequestByRequester;

    event RequestPaid(address indexed requester, uint256 indexed requestId, address indexed paymentToken, uint256 amountPaid);

    constructor(address usdaio_, address core_, address acceptedTokenRegistry_, address swapAdapter_) {
        require(usdaio_ != address(0) && core_ != address(0), "PaymentRouter: bad core");
        require(acceptedTokenRegistry_ != address(0) && swapAdapter_ != address(0), "PaymentRouter: bad adapter");
        usdaio = IERC20Minimal(usdaio_);
        core = IDAIOCorePayment(core_);
        acceptedTokenRegistry = IAcceptedTokenRegistry(acceptedTokenRegistry_);
        swapAdapter = IUniswapV4SwapAdapter(swapAdapter_);
    }

    receive() external payable {}

    function createRequestWithUSDAIO(
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external returns (uint256 requestId) {
        uint256 requiredUsdaio = core.baseRequestFee() + priorityFee;
        require(usdaio.transferFrom(msg.sender, address(this), requiredUsdaio), "PaymentRouter: pull USDAIO failed");
        require(usdaio.approve(core.stakeVault(), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
        latestRequestByRequester[msg.sender] = requestId;
        emit RequestPaid(msg.sender, requestId, address(usdaio), requiredUsdaio);
    }

    function createRequestWithERC20(
        address inputToken,
        uint256 amountInMax,
        bytes calldata routerCalldata,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external returns (uint256 requestId) {
        require(acceptedTokenRegistry.acceptedTokens(inputToken), "PaymentRouter: token not accepted");
        require(acceptedTokenRegistry.requiresSwap(inputToken), "PaymentRouter: USDAIO path required");

        uint256 inputBalanceBefore = IERC20Minimal(inputToken).balanceOf(address(this));
        require(IERC20Minimal(inputToken).transferFrom(msg.sender, address(this), amountInMax), "PaymentRouter: pull input failed");
        require(IERC20Minimal(inputToken).approve(address(swapAdapter), amountInMax), "PaymentRouter: approve input failed");

        uint256 requiredUsdaio = core.baseRequestFee() + priorityFee;
        bytes32 intentHash =
            keccak256(abi.encode(msg.sender, inputToken, requiredUsdaio, proposalHash, rubricHash, domainMask, tier, priorityFee, block.chainid));
        swapAdapter.swapExactOutput(inputToken, address(usdaio), amountInMax, requiredUsdaio, address(this), address(this), routerCalldata, intentHash);
        require(usdaio.approve(core.stakeVault(), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
        latestRequestByRequester[msg.sender] = requestId;
        uint256 leftoverInput = IERC20Minimal(inputToken).balanceOf(address(this)) - inputBalanceBefore;
        if (leftoverInput > 0) {
            require(IERC20Minimal(inputToken).transfer(msg.sender, leftoverInput), "PaymentRouter: refund input failed");
        }
        emit RequestPaid(msg.sender, requestId, inputToken, amountInMax);
    }

    function createRequestWithETH(
        bytes calldata routerCalldata,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external payable returns (uint256 requestId) {
        require(acceptedTokenRegistry.acceptedTokens(address(0)), "PaymentRouter: ETH not accepted");
        uint256 ethBalanceBefore = address(this).balance - msg.value;
        uint256 requiredUsdaio = core.baseRequestFee() + priorityFee;
        bytes32 intentHash =
            keccak256(abi.encode(msg.sender, address(0), requiredUsdaio, proposalHash, rubricHash, domainMask, tier, priorityFee, block.chainid));
        swapAdapter.swapExactOutputETH{value: msg.value}(address(usdaio), requiredUsdaio, address(this), routerCalldata, intentHash);
        require(usdaio.approve(core.stakeVault(), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
        latestRequestByRequester[msg.sender] = requestId;
        uint256 leftoverEth = address(this).balance - ethBalanceBefore;
        if (leftoverEth > 0) {
            (bool ok,) = msg.sender.call{value: leftoverEth}("");
            require(ok, "PaymentRouter: refund ETH failed");
        }
        emit RequestPaid(msg.sender, requestId, address(0), msg.value);
    }

    function latestRequestState(address requester)
        external
        view
        returns (uint256 requestId, uint8 status, bool processing, bool completed)
    {
        requestId = latestRequestByRequester[requester];
        if (requestId == 0) return (0, 0, false, false);

        (, status,,,,,,,) = core.getRequestLifecycle(requestId);
        processing = status >= STATUS_QUEUED && status <= STATUS_AUDIT_REVEAL;
        completed = status >= STATUS_FINALIZED;
    }
}
