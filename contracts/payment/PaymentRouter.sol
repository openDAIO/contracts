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
        bytes calldata routerCalldata
    ) external returns (uint256 amountInUsed);

    function swapExactOutputETH(
        address outputToken,
        uint256 amountOut,
        address recipient,
        bytes calldata routerCalldata
    ) external payable returns (uint256 amountInUsed);
}

contract PaymentRouter {
    IERC20Minimal public immutable usdaio;
    IDAIOCorePayment public immutable core;
    IAcceptedTokenRegistry public immutable acceptedTokenRegistry;
    IUniswapV4SwapAdapter public immutable swapAdapter;

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
        require(usdaio.approve(address(core), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
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
        swapAdapter.swapExactOutput(inputToken, address(usdaio), amountInMax, requiredUsdaio, address(this), address(this), routerCalldata);
        require(usdaio.approve(address(core), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
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
        swapAdapter.swapExactOutputETH{value: msg.value}(address(usdaio), requiredUsdaio, address(this), routerCalldata);
        require(usdaio.approve(address(core), requiredUsdaio), "PaymentRouter: approve failed");
        requestId = core.createRequestFor(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
        uint256 leftoverEth = address(this).balance - ethBalanceBefore;
        if (leftoverEth > 0) {
            (bool ok,) = msg.sender.call{value: leftoverEth}("");
            require(ok, "PaymentRouter: refund ETH failed");
        }
        emit RequestPaid(msg.sender, requestId, address(0), msg.value);
    }
}
