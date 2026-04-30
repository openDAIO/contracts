// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DAIOAutoConvertHook {
    address public owner;
    address public paymentRouter;
    mapping(bytes32 intentHash => bool allowed) public allowedIntents;
    mapping(bytes32 poolKey => bool allowed) public allowedPools;

    event AutoConvertValidated(bytes32 indexed intentHash, bytes32 indexed poolKey, address indexed router);
    event IntentSet(bytes32 indexed intentHash, bool allowed);
    event PoolSet(bytes32 indexed poolKey, bool allowed);
    event PaymentRouterUpdated(address indexed paymentRouter);

    modifier onlyOwner() {
        require(msg.sender == owner, "DAIOAutoConvertHook: not owner");
        _;
    }

    constructor(address paymentRouter_) {
        require(paymentRouter_ != address(0), "DAIOAutoConvertHook: bad router");
        owner = msg.sender;
        paymentRouter = paymentRouter_;
        emit PaymentRouterUpdated(paymentRouter_);
    }

    function setPaymentRouter(address newPaymentRouter) external onlyOwner {
        require(newPaymentRouter != address(0), "DAIOAutoConvertHook: bad router");
        paymentRouter = newPaymentRouter;
        emit PaymentRouterUpdated(newPaymentRouter);
    }

    function setIntent(bytes32 intentHash, bool allowed) external onlyOwner {
        allowedIntents[intentHash] = allowed;
        emit IntentSet(intentHash, allowed);
    }

    function setPool(bytes32 poolKey, bool allowed) external onlyOwner {
        allowedPools[poolKey] = allowed;
        emit PoolSet(poolKey, allowed);
    }

    function validateAutoConvert(bytes32 intentHash, bytes32 poolKey) external {
        require(msg.sender == paymentRouter, "DAIOAutoConvertHook: wrong router");
        require(allowedIntents[intentHash], "DAIOAutoConvertHook: unknown intent");
        require(allowedPools[poolKey], "DAIOAutoConvertHook: unknown pool");
        emit AutoConvertValidated(intentHash, poolKey, msg.sender);
    }
}
