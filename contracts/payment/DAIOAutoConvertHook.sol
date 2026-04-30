// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

contract DAIOAutoConvertHook is BaseHook {
    using BalanceDeltaLibrary for BalanceDelta;

    struct Intent {
        address paymentToken;
        uint256 requiredUsdaio;
        bool registered;
        bool consumed;
    }

    address public owner;
    address public paymentRouter;
    Currency public immutable usdaio;

    mapping(address router => bool allowed) public allowedRouters;
    mapping(address writer => bool allowed) public intentWriters;
    mapping(bytes32 intentHash => bool allowed) public allowedIntents;
    mapping(bytes32 poolKey => bool allowed) public allowedPools;
    mapping(bytes32 intentHash => Intent intent) public intents;

    event AutoConvertValidated(bytes32 indexed intentHash, bytes32 indexed poolKey, address indexed router, uint256 outputAmount);
    event IntentRegistered(bytes32 indexed intentHash, address indexed paymentToken, uint256 requiredUsdaio);
    event IntentSet(bytes32 indexed intentHash, bool allowed);
    event IntentWriterSet(address indexed writer, bool allowed);
    event PoolSet(bytes32 indexed poolKey, bool allowed);
    event PaymentRouterUpdated(address indexed paymentRouter);
    event RouterSet(address indexed router, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "DAIOAutoConvertHook: not owner");
        _;
    }

    modifier onlyIntentWriter() {
        require(msg.sender == paymentRouter || intentWriters[msg.sender], "DAIOAutoConvertHook: not intent writer");
        _;
    }

    constructor(IPoolManager poolManager, address paymentRouter_, address usdaio_) BaseHook(poolManager) {
        require(paymentRouter_ != address(0) && usdaio_ != address(0), "DAIOAutoConvertHook: bad config");
        owner = msg.sender;
        paymentRouter = paymentRouter_;
        usdaio = Currency.wrap(usdaio_);
        intentWriters[paymentRouter_] = true;
        emit PaymentRouterUpdated(paymentRouter_);
        emit IntentWriterSet(paymentRouter_, true);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function validateHookAddress(BaseHook) internal pure override {}

    function setPaymentRouter(address newPaymentRouter) external onlyOwner {
        require(newPaymentRouter != address(0), "DAIOAutoConvertHook: bad router");
        paymentRouter = newPaymentRouter;
        intentWriters[newPaymentRouter] = true;
        emit PaymentRouterUpdated(newPaymentRouter);
        emit IntentWriterSet(newPaymentRouter, true);
    }

    function setIntentWriter(address writer, bool allowed) external onlyOwner {
        require(writer != address(0), "DAIOAutoConvertHook: bad writer");
        intentWriters[writer] = allowed;
        emit IntentWriterSet(writer, allowed);
    }

    function setAllowedRouter(address router, bool allowed) external onlyOwner {
        require(router != address(0), "DAIOAutoConvertHook: bad router");
        allowedRouters[router] = allowed;
        emit RouterSet(router, allowed);
    }

    function setPool(bytes32 poolKey, bool allowed) external onlyOwner {
        allowedPools[poolKey] = allowed;
        emit PoolSet(poolKey, allowed);
    }

    function registerIntent(bytes32 intentHash, address paymentToken, uint256 requiredUsdaio) external onlyIntentWriter {
        require(intentHash != bytes32(0) && requiredUsdaio != 0, "DAIOAutoConvertHook: bad intent");
        allowedIntents[intentHash] = true;
        intents[intentHash] = Intent({paymentToken: paymentToken, requiredUsdaio: requiredUsdaio, registered: true, consumed: false});
        emit IntentRegistered(intentHash, paymentToken, requiredUsdaio);
        emit IntentSet(intentHash, true);
    }

    function consumeValidation(bytes32 intentHash) external onlyIntentWriter {
        require(intents[intentHash].consumed, "DAIOAutoConvertHook: unconsumed intent");
        delete intents[intentHash];
        allowedIntents[intentHash] = false;
        emit IntentSet(intentHash, false);
    }

    function _afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata,
        BalanceDelta delta,
        bytes calldata hookData
    ) internal override returns (bytes4, int128) {
        require(allowedRouters[sender], "DAIOAutoConvertHook: router not allowed");
        bytes32 intentHash = abi.decode(hookData, (bytes32));
        Intent storage intent = intents[intentHash];
        require(allowedIntents[intentHash] && intent.registered, "DAIOAutoConvertHook: unknown intent");

        bytes32 poolKey = poolKeyHash(key);
        require(allowedPools[poolKey], "DAIOAutoConvertHook: pool not allowed");
        require(_poolContains(key, Currency.wrap(intent.paymentToken)) && _poolContains(key, usdaio), "DAIOAutoConvertHook: bad pair");

        uint256 outputAmount = _usdaioOutput(key, delta);
        require(outputAmount >= intent.requiredUsdaio, "DAIOAutoConvertHook: insufficient output");

        intent.consumed = true;
        emit AutoConvertValidated(intentHash, poolKey, sender, outputAmount);
        return (IHooks.afterSwap.selector, 0);
    }

    function poolKeyHash(PoolKey calldata key) public pure returns (bytes32) {
        return keccak256(abi.encode(Currency.unwrap(key.currency0), Currency.unwrap(key.currency1), key.fee, key.tickSpacing, address(key.hooks)));
    }

    function _poolContains(PoolKey calldata key, Currency currency) internal pure returns (bool) {
        return Currency.unwrap(key.currency0) == Currency.unwrap(currency) || Currency.unwrap(key.currency1) == Currency.unwrap(currency);
    }

    function _usdaioOutput(PoolKey calldata key, BalanceDelta delta) internal view returns (uint256) {
        int128 amount = Currency.unwrap(key.currency0) == Currency.unwrap(usdaio) ? delta.amount0() : delta.amount1();
        return amount > 0 ? uint256(uint128(amount)) : 0;
    }
}
