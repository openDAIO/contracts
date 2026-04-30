// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../../lib/queue-contract/contracts/PriorityQueue.sol";

contract DAIOPriorityQueue is PriorityQueue {
    address public owner;
    address public core;

    event CoreUpdated(address indexed core);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "DAIOPriorityQueue: not owner");
        _;
    }

    modifier onlyCore() {
        require(msg.sender == core, "DAIOPriorityQueue: not core");
        _;
    }

    constructor() public {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DAIOPriorityQueue: bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setCore(address newCore) external onlyOwner {
        require(newCore != address(0), "DAIOPriorityQueue: bad core");
        core = newCore;
        emit CoreUpdated(newCore);
    }

    function push(uint256 priority, bytes32 hashedValue) public override onlyCore {
        super.push(priority, hashedValue);
    }

    function pop() public override onlyCore returns (uint256, bytes32) {
        return super.pop();
    }

    function pushRequest(uint256 priority, uint256 requestId) external onlyCore {
        super.push(priority, bytes32(requestId));
    }

    function popRequest() external onlyCore returns (uint256 priority, uint256 requestId) {
        bytes32 encodedRequestId;
        (priority, encodedRequestId) = super.pop();
        requestId = uint256(encodedRequestId);
    }
}
