// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import "../../lib/hash-contract/contracts/CommitReveal.sol";

interface IDAIOCommitSink {
    function syncRequest(uint256 requestId) external returns (uint8 status);
    function submitReviewCommitFor(address reviewer, uint256 requestId, uint256[4] calldata vrfProof) external returns (bool accepted);
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
    function revealReviewFor(
        address reviewer,
        uint256 requestId,
        uint16 proposalScore,
        bytes32 reportHash,
        string calldata reportURI,
        uint256 seed
    ) external;
    function submitAuditCommitFor(address auditor, uint256 requestId, uint256[4][] calldata targetProofs) external returns (bool accepted);
    function revealAuditFor(address auditor, uint256 requestId, address[] calldata targets, uint16[] calldata scores, uint256 seed) external;
    function reviewCommitRound(uint256 requestId) external view returns (uint256);
    function auditCommitRound(uint256 requestId) external view returns (uint256);
}

contract DAIOCommitRevealManager is CommitReveal {
    uint8 internal constant REVIEW_COMMIT = 2;
    uint8 internal constant REVIEW_REVEAL = 3;
    uint8 internal constant AUDIT_COMMIT = 4;
    uint8 internal constant AUDIT_REVEAL = 5;

    address public owner;
    address public core;
    mapping(uint256 => mapping(uint256 => address[])) private _reviewParticipants;
    mapping(uint256 => mapping(uint256 => address[])) private _auditParticipants;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) private _reviewParticipantSeen;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) private _auditParticipantSeen;

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
        if (IDAIOCommitSink(core).syncRequest(requestId) != REVIEW_COMMIT) return;
        (,,,, uint256 attempt,,,,) = IDAIOCommitSink(core).getRequestLifecycle(requestId);
        commit_hashed(resultHash, seed, IDAIOCommitSink(core).reviewCommitRound(requestId));
        if (IDAIOCommitSink(core).submitReviewCommitFor(msg.sender, requestId, vrfProof)) {
            _recordParticipant(_reviewParticipants, _reviewParticipantSeen, requestId, attempt, msg.sender);
        }
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
        if (IDAIOCommitSink(core).syncRequest(requestId) != REVIEW_REVEAL) return;
        IDAIOCommitSink(core).revealReviewFor(msg.sender, requestId, proposalScore, reportHash, reportURI, seed);
    }

    function commitAudit(uint256 requestId, bytes32 resultHash, uint256 seed, uint256[4][] calldata targetProofs) external {
        require(core != address(0), "DAIOCommitRevealManager: core unset");
        if (IDAIOCommitSink(core).syncRequest(requestId) != AUDIT_COMMIT) return;
        (,,,, uint256 attempt,,,,) = IDAIOCommitSink(core).getRequestLifecycle(requestId);
        commit_hashed(resultHash, seed, IDAIOCommitSink(core).auditCommitRound(requestId));
        if (IDAIOCommitSink(core).submitAuditCommitFor(msg.sender, requestId, targetProofs)) {
            _recordParticipant(_auditParticipants, _auditParticipantSeen, requestId, attempt, msg.sender);
        }
    }

    function revealAudit(uint256 requestId, address[] calldata targets, uint16[] calldata scores, uint256 seed) external {
        require(core != address(0), "DAIOCommitRevealManager: core unset");
        if (IDAIOCommitSink(core).syncRequest(requestId) != AUDIT_REVEAL) return;
        IDAIOCommitSink(core).revealAuditFor(msg.sender, requestId, targets, scores, seed);
    }

    function getReviewParticipants(uint256 requestId, uint256 attempt) external view returns (address[] memory) {
        return _reviewParticipants[requestId][attempt];
    }

    function getAuditParticipants(uint256 requestId, uint256 attempt) external view returns (address[] memory) {
        return _auditParticipants[requestId][attempt];
    }

    function _recordParticipant(
        mapping(uint256 => mapping(uint256 => address[])) storage participants,
        mapping(uint256 => mapping(uint256 => mapping(address => bool))) storage seen,
        uint256 requestId,
        uint256 attempt,
        address participant
    ) internal {
        if (seen[requestId][attempt][participant]) return;
        seen[requestId][attempt][participant] = true;
        participants[requestId][attempt].push(participant);
    }
}
