// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract MockV4PoolManager {
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
    ) external returns (bytes4 selector, int128 hookDelta) {
        BalanceDelta delta = toBalanceDelta(amount0, amount1);
        return IHooks(hook).afterSwap(
            sender,
            key,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: sqrtPriceLimitX96}),
            delta,
            hookData
        );
    }
}
