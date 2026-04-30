// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

interface IMockERC20Like {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IMockV4PoolManagerLike {
    function callAfterSwap(
        address hook,
        address sender,
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        int128 amount0,
        int128 amount1,
        bytes calldata hookData
    ) external returns (bytes4 selector, int128 hookDelta);
}

contract MockUniversalRouter {
    receive() external payable {}

    function swap(
        address inputToken,
        address outputToken,
        address recipient,
        uint256 inputUsed,
        uint256 outputAmount
    ) external {
        require(IMockERC20Like(inputToken).transferFrom(msg.sender, address(this), inputUsed), "MockUniversalRouter: input failed");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
    }

    function swapETH(address outputToken, address recipient, uint256 ethUsed, uint256 outputAmount) external payable {
        require(msg.value >= ethUsed, "MockUniversalRouter: insufficient ETH");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
        if (msg.value > ethUsed) {
            (bool ok,) = msg.sender.call{value: msg.value - ethUsed}("");
            require(ok, "MockUniversalRouter: refund failed");
        }
    }

    function swapWithV4Hook(
        address inputToken,
        address outputToken,
        address recipient,
        uint256 inputUsed,
        uint256 outputAmount,
        address poolManager,
        address hook,
        address swapSender,
        PoolKey calldata key,
        int128 amount0,
        int128 amount1,
        bytes calldata hookData
    ) external {
        require(IMockERC20Like(inputToken).transferFrom(msg.sender, address(this), inputUsed), "MockUniversalRouter: input failed");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
        IMockV4PoolManagerLike(poolManager).callAfterSwap(hook, swapSender, key, true, -int256(inputUsed), 0, amount0, amount1, hookData);
    }

    function swapETHWithV4Hook(
        address outputToken,
        address recipient,
        uint256 ethUsed,
        uint256 outputAmount,
        address poolManager,
        address hook,
        address swapSender,
        PoolKey calldata key,
        int128 amount0,
        int128 amount1,
        bytes calldata hookData
    ) external payable {
        require(msg.value >= ethUsed, "MockUniversalRouter: insufficient ETH");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
        IMockV4PoolManagerLike(poolManager).callAfterSwap(hook, swapSender, key, true, -int256(ethUsed), 0, amount0, amount1, hookData);
        if (msg.value > ethUsed) {
            (bool ok,) = msg.sender.call{value: msg.value - ethUsed}("");
            require(ok, "MockUniversalRouter: refund failed");
        }
    }
}
