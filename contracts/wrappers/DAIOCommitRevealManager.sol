// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../../lib/hash-contract/contracts/CommitReveal.sol";

interface IDAIOCommitSink {
    function submitReviewCommitFor(address reviewer, uint256 requestId, uint256[4] calldata vrfProof) external;
    function submitAuditCommitFor(address auditor, uint256 requestId) external;
    function reviewCommitRound(uint256 requestId) external view returns (uint256);
    function auditCommitRound(uint256 requestId) external view returns (uint256);
}

contract DAIOCommitRevealManager is CommitReveal {
    address public owner;
    address public core;

    event CoreUpdated(address indexed core);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "DAIOCommitRevealManager: not owner");
        _;
    }

    constructor() public {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "DAIOCommitRevealManager: bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setCore(address newCore) external onlyOwner {
        require(newCore != address(0), "DAIOCommitRevealManager: bad core");
        core = newCore;
        emit CoreUpdated(newCore);
    }

    function commitReview(uint256 requestId, bytes32 resultHash, uint256 seed, uint256[4] calldata vrfProof) external {
        require(core != address(0), "DAIOCommitRevealManager: core unset");
        commit_hashed(resultHash, seed, IDAIOCommitSink(core).reviewCommitRound(requestId));
        IDAIOCommitSink(core).submitReviewCommitFor(msg.sender, requestId, vrfProof);
    }

    function commitAudit(uint256 requestId, bytes32 resultHash, uint256 seed) external {
        require(core != address(0), "DAIOCommitRevealManager: core unset");
        commit_hashed(resultHash, seed, IDAIOCommitSink(core).auditCommitRound(requestId));
        IDAIOCommitSink(core).submitAuditCommitFor(msg.sender, requestId);
    }
}
