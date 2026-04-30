// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IDAIOAutoConvertHookLike {
    function registerIntent(bytes32 intentHash, address paymentToken, uint256 requiredUsdaio) external;
    function consumeValidation(bytes32 intentHash) external;
}

contract UniswapV4SwapAdapter {
    address public owner;
    address public paymentRouter;
    address public universalRouter;
    IDAIOAutoConvertHookLike public autoConvertHook;

    event ExactOutputSwap(address indexed inputToken, address indexed outputToken, uint256 amountInMax, uint256 amountOut);
    event AutoConvertHookUpdated(address indexed hook);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PaymentRouterUpdated(address indexed paymentRouter);
    event UniversalRouterUpdated(address indexed universalRouter);

    modifier onlyOwner() {
        require(msg.sender == owner, "UniswapV4SwapAdapter: not owner");
        _;
    }

    modifier onlyPaymentRouter() {
        require(msg.sender == paymentRouter, "UniswapV4SwapAdapter: not payment router");
        _;
    }

    constructor(address universalRouter_) {
        require(universalRouter_ != address(0), "UniswapV4SwapAdapter: bad router");
        owner = msg.sender;
        universalRouter = universalRouter_;
        emit OwnershipTransferred(address(0), msg.sender);
        emit UniversalRouterUpdated(universalRouter_);
    }

    receive() external payable {}

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "UniswapV4SwapAdapter: bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPaymentRouter(address newPaymentRouter) external onlyOwner {
        require(newPaymentRouter != address(0), "UniswapV4SwapAdapter: bad payment router");
        paymentRouter = newPaymentRouter;
        emit PaymentRouterUpdated(newPaymentRouter);
    }

    function setUniversalRouter(address newUniversalRouter) external onlyOwner {
        require(newUniversalRouter != address(0), "UniswapV4SwapAdapter: bad router");
        universalRouter = newUniversalRouter;
        emit UniversalRouterUpdated(newUniversalRouter);
    }

    function setAutoConvertHook(address newHook) external onlyOwner {
        autoConvertHook = IDAIOAutoConvertHookLike(newHook);
        emit AutoConvertHookUpdated(newHook);
    }

    function swapExactOutput(
        address inputToken,
        address outputToken,
        uint256 amountInMax,
        uint256 amountOut,
        address payer,
        address recipient,
        bytes calldata routerCalldata,
        bytes32 intentHash
    ) external onlyPaymentRouter returns (uint256 amountInUsed) {
        require(inputToken != address(0) && outputToken != address(0), "UniswapV4SwapAdapter: bad token");
        if (address(autoConvertHook) != address(0)) {
            autoConvertHook.registerIntent(intentHash, inputToken, amountOut);
        }

        uint256 outputBefore = IERC20Minimal(outputToken).balanceOf(recipient);
        uint256 inputBefore = IERC20Minimal(inputToken).balanceOf(address(this));

        require(IERC20Minimal(inputToken).transferFrom(payer, address(this), amountInMax), "UniswapV4SwapAdapter: pull failed");
        require(IERC20Minimal(inputToken).approve(universalRouter, amountInMax), "UniswapV4SwapAdapter: approve failed");
        (bool ok,) = universalRouter.call(routerCalldata);
        require(ok, "UniswapV4SwapAdapter: router failed");
        require(IERC20Minimal(inputToken).approve(universalRouter, 0), "UniswapV4SwapAdapter: reset approve failed");

        uint256 outputDelta = IERC20Minimal(outputToken).balanceOf(recipient) - outputBefore;
        require(outputDelta >= amountOut, "UniswapV4SwapAdapter: insufficient output");
        if (address(autoConvertHook) != address(0)) {
            autoConvertHook.consumeValidation(intentHash);
        }

        uint256 inputAfter = IERC20Minimal(inputToken).balanceOf(address(this));
        amountInUsed = amountInMax > inputAfter - inputBefore ? amountInMax - (inputAfter - inputBefore) : amountInMax;
        uint256 refund = IERC20Minimal(inputToken).balanceOf(address(this)) - inputBefore;
        if (refund > 0) {
            require(IERC20Minimal(inputToken).transfer(payer, refund), "UniswapV4SwapAdapter: refund failed");
        }

        emit ExactOutputSwap(inputToken, outputToken, amountInMax, amountOut);
    }

    function swapExactOutputETH(
        address outputToken,
        uint256 amountOut,
        address recipient,
        bytes calldata routerCalldata,
        bytes32 intentHash
    ) external payable onlyPaymentRouter returns (uint256 amountInUsed) {
        if (address(autoConvertHook) != address(0)) {
            autoConvertHook.registerIntent(intentHash, address(0), amountOut);
        }

        uint256 outputBefore = IERC20Minimal(outputToken).balanceOf(recipient);
        uint256 ethBefore = address(this).balance - msg.value;
        (bool ok,) = universalRouter.call{value: msg.value}(routerCalldata);
        require(ok, "UniswapV4SwapAdapter: router failed");

        uint256 outputDelta = IERC20Minimal(outputToken).balanceOf(recipient) - outputBefore;
        require(outputDelta >= amountOut, "UniswapV4SwapAdapter: insufficient output");
        if (address(autoConvertHook) != address(0)) {
            autoConvertHook.consumeValidation(intentHash);
        }

        uint256 refund = address(this).balance - ethBefore;
        if (refund > 0) {
            (bool refunded,) = msg.sender.call{value: refund}("");
            require(refunded, "UniswapV4SwapAdapter: ETH refund failed");
            amountInUsed = msg.value - refund;
        } else {
            amountInUsed = msg.value;
        }

        emit ExactOutputSwap(address(0), outputToken, msg.value, amountOut);
    }
}
