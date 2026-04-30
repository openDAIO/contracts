// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../../lib/hash-contract/contracts/CommitReveal.sol";

interface IDAIOCommitSink {
    function submitReviewCommitFor(address reviewer, uint256 requestId, uint256[4] calldata vrfProof) external;
    function revealReviewFor(
        address reviewer,
        uint256 requestId,
        uint16 proposalScore,
        bytes32 reportHash,
        string calldata reportURI,
        uint256 seed
    ) external;
    function submitAuditCommitFor(address auditor, uint256 requestId, uint256[4] calldata vrfProof) external;
    function revealAuditFor(address auditor, uint256 requestId, address[] calldata targets, uint16[] calldata scores, uint256 seed) external;
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

    function hashReviewReveal(
        uint256 requestId,
        address reviewer,
        uint16 proposalScore,
        bytes32 reportHash,
        string memory reportURI
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(requestId, reviewer, proposalScore, reportHash, keccak256(bytes(reportURI))));
    }

    function hashAuditReveal(
        uint256 requestId,
        address auditor,
        address[] memory targets,
        uint16[] memory scores
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(requestId, auditor, targets, scores));
    }

    function revealReview(
        uint256 requestId,
        uint16 proposalScore,
        bytes32 reportHash,
        string calldata reportURI,
        uint256 seed
    ) external {
        require(core != address(0), "DAIOCommitRevealManager: core unset");
        IDAIOCommitSink(core).revealReviewFor(msg.sender, requestId, proposalScore, reportHash, reportURI, seed);
    }

    function commitAudit(uint256 requestId, bytes32 resultHash, uint256 seed, uint256[4] calldata vrfProof) external {
        require(core != address(0), "DAIOCommitRevealManager: core unset");
        commit_hashed(resultHash, seed, IDAIOCommitSink(core).auditCommitRound(requestId));
        IDAIOCommitSink(core).submitAuditCommitFor(msg.sender, requestId, vrfProof);
    }

    function revealAudit(uint256 requestId, address[] calldata targets, uint16[] calldata scores, uint256 seed) external {
        require(core != address(0), "DAIOCommitRevealManager: core unset");
        IDAIOCommitSink(core).revealAuditFor(msg.sender, requestId, targets, scores, seed);
    }
}
