// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ICommitReveal {
    function saved_commits(uint256 round, address participant) external view returns (bytes32);
    function reveal_hashed(bytes32 resultHash, address participant, uint256 seed, uint256 round) external returns (bool);
}

interface IPriorityQueue {
    function currentSize() external view returns (uint256);
    function top() external view returns (uint256, bytes32);
    function pushRequest(uint256 priority, uint256 requestId) external;
    function popRequest() external returns (uint256 priority, uint256 requestId);
}

interface IDAIOVRFCoordinator {
    function randomness(
        uint256[2] calldata publicKey,
        uint256[4] calldata proof,
        address core,
        uint256 requestId,
        bytes32 phase,
        uint256 epoch,
        address reviewer,
        address target,
        uint256 phaseStartBlock,
        uint256 finalityFactor
    ) external view returns (bytes32);
}

interface IStakeVaultLike {
    function stakeFor(address reviewer, uint256 amount) external;
    function withdrawStake(address reviewer, address recipient, uint256 amount) external;
    function slashStake(address reviewer, uint256 amount, string calldata reason) external returns (uint256);
    function fundRequest(uint256 requestId, address payer, uint256 rewardPool, uint256 protocolFee) external;
    function refundRequest(uint256 requestId, address requester) external returns (uint256 refund);
    function payReward(uint256 requestId, address reviewer, uint256 amount) external;
    function closeRequestToTreasury(uint256 requestId) external returns (uint256 accrued);
}

interface IConsensusScoringLike {
    struct Input {
        uint256 reviewRevealCount;
        uint256 auditRevealCount;
        uint256 reviewCommitQuorum;
        uint256 auditCommitQuorum;
        uint256 minIncomingAudit;
        uint256 auditCoverageQuorum;
        uint256 contributionThreshold;
        uint256 minorityThreshold;
        bool lowConfidence;
        uint256[] proposalScores;
        uint256[][] incomingScoresByTarget;
        uint256[][] auditorTargetIndexes;
        uint256[][] auditorScores;
    }

    struct Output {
        uint256 finalScore;
        uint256 confidence;
        uint256 coverage;
        uint256 scoreDispersion;
        bool lowConfidence;
        uint256 totalContribution;
        uint256[] medians;
        uint256[] incomingCounts;
        uint256[] rawReliability;
        uint256[] normalizedQuality;
        uint256[] normalizedReliability;
        uint256[] contributions;
        uint256[] weights;
        bool[] covered;
        bool[] minority;
    }

    function compute(Input calldata input) external pure returns (Output memory output);
}

interface IDAIORoundLedgerLike {
    function recordReviewScore(uint256 requestId, uint256 attempt, address reviewer, uint256 score) external;
    function closeReviewSnapshot(uint256 requestId, uint256 attempt, uint256 revealQuorum, bool lowConfidence, bool aborted) external;
    function recordConsensusScore(uint256 requestId, uint256 attempt, address reviewer, uint256 score, uint256 weight, uint256 auditScore)
        external;
    function closeConsensusSnapshot(
        uint256 requestId,
        uint256 attempt,
        uint256 finalScore,
        uint256 totalWeight,
        uint256 confidence,
        uint256 coverage,
        bool lowConfidence,
        bool aborted
    ) external;
    function closeReputationFinal(
        uint256 requestId,
        uint256 attempt,
        address reputationLedger,
        uint256 confidence,
        uint256 coverage,
        bool lowConfidence,
        bool aborted
    ) external returns (uint256 finalScore, uint256 totalWeight, bool finalLowConfidence);
    function reviewerRoundWeight(uint256 requestId, uint256 attempt, uint8 round, address reviewer) external view returns (uint256);

    function recordSlash(uint256 requestId, uint256 attempt, uint8 round, address reviewer, uint256 amount, bytes32 reasonHash, bool protocolFault)
        external;
    function markSemanticFault(uint256 requestId, uint256 attempt, uint8 round, address reviewer, bytes32 reasonHash) external;
    function recordReward(uint256 requestId, uint256 attempt, uint8 round, address reviewer, uint256 amount) external;
}

interface IAssignmentManagerLike {
    function verifiedCanonicalAuditTargets(
        address vrfCoordinator,
        uint256[2] calldata publicKey,
        address core,
        uint256 requestId,
        address auditor,
        address[] calldata revealedReviewers,
        uint256[4][] calldata targetProofs,
        uint256 epoch,
        uint256 phaseStartBlock,
        uint256 finalityFactor,
        uint256 difficulty,
        uint256 limit
    ) external view returns (bool ok, address[] memory selectedTargets);
}

interface ISettlementLike {
    struct ReviewerInput {
        uint256 rewardPool;
        uint256 totalContribution;
        uint256 weight;
        uint256 proposalScore;
        uint256 finalScore;
        uint256 contribution;
        uint256 contributionThreshold;
        bool covered;
        bool protocolFault;
    }

    struct ReviewerOutput {
        uint256 scoreAgreement;
        uint256 reward;
        bool semanticFault;
    }

    function reviewerSettlement(ReviewerInput calldata input) external pure returns (ReviewerOutput memory output);
}

interface IReputationLedgerLike {
    function record(
        address reviewer,
        uint256 agentId,
        uint256 reportQuality,
        uint256 auditReliability,
        uint256 finalContribution,
        uint256 finalReliability,
        bool protocolFault,
        uint256 scoreAgreement,
        bool minorityOpinion,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

interface IReviewerRegistryLike {
    function isEligible(address reviewer, uint256 domainMask) external view returns (bool);
    function vrfPublicKey(address reviewer) external view returns (uint256[2] memory);
    function agentId(address reviewer) external view returns (uint256);
    function markCompleted(address reviewer) external;
    function lockStake(address reviewer, uint256 requestId) external returns (uint256 amount);
    function unlockStake(address reviewer, uint256 requestId) external returns (uint256 amount);
    function recordSemanticFault(address reviewer, uint256 threshold, uint256 cooldownBlocks) external returns (bool suspended);
    function slashStakeBps(address reviewer, uint256 bps, string calldata reason, bool protocolFault) external returns (uint256 amount);
    function getReviewer(address reviewer)
        external
        view
        returns (
            bool registered,
            bool active,
            bool suspended,
            uint256 agentId,
            uint256 stake,
            uint256 domainMask,
            uint256 completedRequests,
            uint256 semanticStrikes,
            uint256 protocolFaults,
            uint256 cooldownUntilBlock
        );
}

contract DAIOCore {
    uint256 internal constant SCALE = 10_000;
    uint256 internal constant BPS = 10_000;
    uint8 internal constant ROUND_REVIEW = 0;
    uint8 internal constant ROUND_AUDIT_CONSENSUS = 1;
    uint8 internal constant ROUND_REPUTATION_FINAL = 2;

    bytes32 internal constant REVIEW_SORTITION = keccak256("DAIO_REVIEW_SORTITION");
    bytes32 internal constant AUDIT_SORTITION = keccak256("DAIO_AUDIT_SORTITION");

    ICommitReveal internal immutable commitReveal;
    IPriorityQueue internal immutable priorityQueue;
    IDAIOVRFCoordinator internal immutable vrfCoordinator;
    address internal owner;
    address internal treasury;
    address internal paymentRouter;
    IStakeVaultLike public stakeVault;
    IReviewerRegistryLike internal reviewerRegistry;
    IAssignmentManagerLike internal assignmentManager;
    IConsensusScoringLike internal consensusScoring;
    ISettlementLike internal settlement;
    IReputationLedgerLike internal reputationLedger;
    IDAIORoundLedgerLike internal roundLedger;

    uint256 public baseRequestFee = 100 ether;
    uint256 public immutable maxActiveRequests;
    uint256 internal activeRequestCount;
    uint256 internal constant protocolFeeBps = 1_000;
    uint256 internal requestCount;

    uint256 private _locked = 1;

    enum RequestStatus {
        None,
        Queued,
        ReviewCommit,
        ReviewReveal,
        AuditCommit,
        AuditReveal,
        Finalized,
        Cancelled,
        Failed,
        Unresolved
    }

    enum ServiceTier {
        Fast,
        Standard,
        Critical
    }

    struct RequestConfig {
        uint16 reviewElectionDifficulty;
        uint16 auditElectionDifficulty;
        uint16 reviewCommitQuorum;
        uint16 reviewRevealQuorum;
        uint16 auditCommitQuorum;
        uint16 auditRevealQuorum;
        uint16 auditTargetLimit;
        uint16 minIncomingAudit;
        uint16 auditCoverageQuorum;
        uint16 contributionThreshold;
        uint16 reviewEpochSize;
        uint16 auditEpochSize;
        uint16 finalityFactor;
        uint16 maxRetries;
        uint16 minorityThreshold;
        uint16 semanticStrikeThreshold;
        uint16 protocolFaultSlashBps;
        uint16 missedRevealSlashBps;
        uint16 semanticSlashBps;
        uint32 cooldownBlocks;
        uint32 reviewCommitTimeout;
        uint32 reviewRevealTimeout;
        uint32 auditCommitTimeout;
        uint32 auditRevealTimeout;
    }

    struct Request {
        address requester;
        string proposalURI;
        bytes32 proposalHash;
        bytes32 rubricHash;
        uint256 domainMask;
        ServiceTier tier;
        RequestStatus status;
        uint256 feePaid;
        uint256 priorityFee;
        uint256 rewardPool;
        uint256 protocolFee;
        uint256 createdAt;
        uint256 phaseStartedAt;
        uint256 phaseStartedBlock;
        uint256 activePriority;
        uint256 retryCount;
        uint256 committeeEpoch;
        uint256 auditEpoch;
        uint256 reviewCommitCount;
        uint256 reviewRevealCount;
        uint256 auditCommitCount;
        uint256 auditRevealCount;
        uint256 finalProposalScore;
        uint256 confidence;
        uint256 auditCoverage;
        uint256 scoreDispersion;
        uint256 finalReliability;
        bool lowConfidence;
        RequestConfig config;
    }

    struct ReviewSubmission {
        bytes32 commitHash;
        bytes32 sortitionRandomness;
        bool committed;
        bool revealed;
        bool protocolFault;
        uint16 proposalScore;
        bytes32 reportHash;
        string reportURI;
    }

    struct AuditSubmission {
        bytes32 commitHash;
        bool committed;
        bool revealed;
        bool protocolFault;
    }

    struct ReviewerResult {
        uint256 reportQualityMedian;
        uint256 normalizedReportQuality;
        uint256 auditReliabilityRaw;
        uint256 normalizedAuditReliability;
        uint256 finalContribution;
        uint256 scoreAgreement;
        uint256 reward;
        bool minorityOpinion;
        bool covered;
        bool protocolFault;
    }

    struct ScoringData {
        address[] reviewers;
        uint256[] proposalScores;
        IConsensusScoringLike.Output output;
    }

    mapping(uint256 requestId => Request data) internal requests;
    mapping(uint256 tier => RequestConfig config) internal tierConfigs;
    mapping(uint256 requestId => mapping(address reviewer => ReviewSubmission submission)) internal reviewSubmissions;
    mapping(uint256 requestId => mapping(address auditor => AuditSubmission submission)) internal auditSubmissions;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => uint16 score))) internal auditScores;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => bool exists))) internal hasAuditScore;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => bool canonical))) internal canonicalAuditTargets;
    mapping(uint256 requestId => mapping(address reviewer => ReviewerResult result)) internal reviewerResults;
    mapping(uint256 requestId => uint256 faults) internal requestFaultCount;

    mapping(uint256 requestId => address[] reviewers) private _reviewCommitters;
    mapping(uint256 requestId => address[] reviewers) private _revealedReviewers;
    mapping(uint256 requestId => mapping(address target => address[] auditors)) private _incomingAuditors;
    mapping(uint256 requestId => mapping(address auditor => address[] targets)) private _auditTargetsByAuditor;
    mapping(uint256 requestId => mapping(address auditor => address[] targets)) private _canonicalTargetsByAuditor;

    event RequestFinalized(uint256 indexed requestId, uint256 finalProposalScore, uint256 confidence, bool lowConfidence);
    event ReviewRevealed(uint256 requestId, address reviewer, uint16 proposalScore, bytes32 reportHash, string reportURI);
    event StatusChanged(uint256 indexed requestId, RequestStatus status);

    error AlreadySubmitted();
    error BadCommitment();
    error BadConfig();
    error BadStatus(RequestStatus expected, RequestStatus actual);
    error IneligibleReviewer();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidAuditTarget();
    error NotOwner();
    error QueueEmpty();
    error ReentrantCall();
    error TooEarly();
    error UnknownRequest();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_locked != 1) revert ReentrantCall();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        address treasury_,
        address commitReveal_,
        address priorityQueue_,
        address vrfCoordinator_,
        uint256 maxActiveRequests_
    ) {
        if (
            treasury_ == address(0) || commitReveal_ == address(0) || priorityQueue_ == address(0) || vrfCoordinator_ == address(0)
                || maxActiveRequests_ == 0
        ) {
            revert InvalidAddress();
        }

        commitReveal = ICommitReveal(commitReveal_);
        priorityQueue = IPriorityQueue(priorityQueue_);
        vrfCoordinator = IDAIOVRFCoordinator(vrfCoordinator_);
        owner = msg.sender;
        treasury = treasury_;
        maxActiveRequests = maxActiveRequests_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        owner = newOwner;
    }

    function setPaymentRouter(address newPaymentRouter) external onlyOwner {
        if (newPaymentRouter == address(0)) revert InvalidAddress();
        paymentRouter = newPaymentRouter;
    }

    function setRoundLedger(address newRoundLedger) external onlyOwner {
        if (newRoundLedger == address(0)) revert InvalidAddress();
        roundLedger = IDAIORoundLedgerLike(newRoundLedger);
    }

    function setModules(
        address stakeVault_,
        address reviewerRegistry_,
        address assignmentManager_,
        address consensusScoring_,
        address settlement_,
        address reputationLedger_
    ) external onlyOwner {
        if (
            stakeVault_ == address(0) || reviewerRegistry_ == address(0) || assignmentManager_ == address(0)
                || consensusScoring_ == address(0) || settlement_ == address(0) || reputationLedger_ == address(0)
        ) {
            revert InvalidAddress();
        }
        stakeVault = IStakeVaultLike(stakeVault_);
        reviewerRegistry = IReviewerRegistryLike(reviewerRegistry_);
        assignmentManager = IAssignmentManagerLike(assignmentManager_);
        consensusScoring = IConsensusScoringLike(consensusScoring_);
        settlement = ISettlementLike(settlement_);
        reputationLedger = IReputationLedgerLike(reputationLedger_);
    }

    function setTierConfig(ServiceTier tier, RequestConfig calldata config) external onlyOwner {
        if (config.reviewEpochSize == 0 || config.auditEpochSize == 0) revert BadConfig();
        tierConfigs[uint256(tier)] = config;
    }

    function createRequestFor(
        address requester,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        uint8 tier,
        uint256 priorityFee
    ) external nonReentrant returns (uint256 requestId) {
        if (msg.sender != paymentRouter || requester == address(0) || tier > uint8(ServiceTier.Critical)) revert InvalidAddress();
        requestId = _createRequest(requester, proposalURI, proposalHash, rubricHash, domainMask, ServiceTier(tier), priorityFee);
    }

    function _createRequest(
        address requester,
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        ServiceTier tier,
        uint256 priorityFee
    ) internal returns (uint256 requestId) {
        if (bytes(proposalURI).length == 0 || proposalHash == bytes32(0) || rubricHash == bytes32(0) || domainMask == 0) {
            revert InvalidAmount();
        }

        RequestConfig memory config = tierConfigs[uint256(tier)];
        if (config.reviewEpochSize == 0 || config.auditEpochSize == 0) revert BadConfig();

        uint256 feePaid = baseRequestFee + priorityFee;
        uint256 protocolFee = (feePaid * protocolFeeBps) / BPS;
        uint256 rewardPool = feePaid - protocolFee;
        if (address(stakeVault) == address(0)) revert InvalidAddress();

        requestId = ++requestCount;
        Request storage request_ = requests[requestId];
        request_.requester = requester;
        request_.proposalURI = proposalURI;
        request_.proposalHash = proposalHash;
        request_.rubricHash = rubricHash;
        request_.domainMask = domainMask;
        request_.tier = tier;
        request_.status = RequestStatus.Queued;
        request_.feePaid = feePaid;
        request_.priorityFee = priorityFee;
        request_.rewardPool = rewardPool;
        request_.protocolFee = protocolFee;
        request_.createdAt = block.timestamp;
        request_.phaseStartedAt = block.timestamp;
        request_.phaseStartedBlock = block.number;
        request_.activePriority = priorityFee;
        request_.committeeEpoch = block.number / config.reviewEpochSize;
        request_.auditEpoch = block.number / config.auditEpochSize;
        request_.config = config;

        stakeVault.fundRequest(requestId, msg.sender, rewardPool, protocolFee);
        priorityQueue.pushRequest(priorityFee, requestId);

        emit StatusChanged(requestId, RequestStatus.Queued);
    }

    function startNextRequest() external returns (uint256 requestId) {
        if (activeRequestCount >= maxActiveRequests) revert TooEarly();

        while (priorityQueue.currentSize() > 0) {
            (, uint256 candidateId) = priorityQueue.popRequest();
            if (requests[candidateId].status == RequestStatus.Queued) {
                requestId = candidateId;
                break;
            }
        }

        if (requestId == 0) revert QueueEmpty();

        activeRequestCount++;
        _advance(requestId, RequestStatus.ReviewCommit);
    }

    function submitReviewCommitFor(address reviewer, uint256 requestId, uint256[4] calldata vrfProof) external returns (bool accepted) {
        if (msg.sender != address(commitReveal)) revert InvalidAddress();
        return _submitReviewCommit(reviewer, requestId, vrfProof);
    }

    function syncRequest(uint256 requestId) external nonReentrant returns (uint8 status) {
        return uint8(_syncRequest(requestId));
    }

    function _submitReviewCommit(address reviewer, uint256 requestId, uint256[4] calldata vrfProof) internal returns (bool accepted) {
        Request storage request_ = _requireStatus(requestId, RequestStatus.ReviewCommit);
        if (!_eligibleForRequest(reviewer, request_.domainMask)) revert IneligibleReviewer();

        bytes32 commitHash = commitReveal.saved_commits(_reviewCommitRound(requestId), reviewer);
        if (commitHash == bytes32(0)) revert BadCommitment();

        if (request_.config.reviewElectionDifficulty < SCALE) {
            (bool vrfOk, bytes32 value) =
                _tryVrfRandomness(requestId, REVIEW_SORTITION, request_.committeeEpoch, reviewer, address(0), vrfProof);
            if (!vrfOk) {
                _markProtocolFault(requestId, reviewer, "rv", request_.config.protocolFaultSlashBps);
                return false;
            }
            uint256 sortitionScore = uint256(keccak256(abi.encode(REVIEW_SORTITION, requestId, reviewer, address(0), value))) % SCALE;
            if (sortitionScore >= request_.config.reviewElectionDifficulty) {
                _markProtocolFault(requestId, reviewer, "rs", request_.config.protocolFaultSlashBps);
                return false;
            }
        }

        ReviewSubmission storage submission = reviewSubmissions[requestId][reviewer];
        if (submission.committed) revert AlreadySubmitted();

        submission.commitHash = commitHash;
        submission.committed = true;
        reviewerRegistry.lockStake(reviewer, requestId);

        _reviewCommitters[requestId].push(reviewer);
        request_.reviewCommitCount++;

        if (request_.reviewCommitCount >= request_.config.reviewCommitQuorum) {
            _advance(requestId, RequestStatus.ReviewReveal);
        }
        return true;
    }

    function revealReviewFor(
        address reviewer,
        uint256 requestId,
        uint16 proposalScore,
        bytes32 reportHash,
        string calldata reportURI,
        uint256 seed
    ) external {
        if (msg.sender != address(commitReveal)) revert InvalidAddress();
        Request storage request_ = _requireStatus(requestId, RequestStatus.ReviewReveal);

        ReviewSubmission storage submission = reviewSubmissions[requestId][reviewer];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        if (proposalScore > SCALE || reportHash == bytes32(0) || bytes(reportURI).length == 0) {
            _markProtocolFault(requestId, reviewer, "rr", request_.config.protocolFaultSlashBps);
            return;
        }

        bytes32 resultHash = _hashReviewReveal(requestId, reviewer, proposalScore, reportHash, reportURI);
        try commitReveal.reveal_hashed(resultHash, reviewer, seed, _reviewCommitRound(requestId)) returns (bool ok) {
            if (!ok) {
                _markProtocolFault(requestId, reviewer, "rm", request_.config.protocolFaultSlashBps);
                return;
            }
        } catch {
            _markProtocolFault(requestId, reviewer, "rm", request_.config.protocolFaultSlashBps);
            return;
        }

        submission.revealed = true;
        submission.proposalScore = proposalScore;
        submission.reportHash = reportHash;
        submission.reportURI = reportURI;

        _revealedReviewers[requestId].push(reviewer);
        request_.reviewRevealCount++;

        emit ReviewRevealed(requestId, reviewer, proposalScore, reportHash, reportURI);

        if (request_.reviewRevealCount >= request_.config.reviewRevealQuorum) {
            _snapshotRound0(requestId, false);
            _advance(requestId, RequestStatus.AuditCommit);
        }
    }

    function submitAuditCommitFor(address auditor, uint256 requestId, uint256[4][] calldata targetProofs) external returns (bool accepted) {
        if (msg.sender != address(commitReveal)) revert InvalidAddress();
        return _submitAuditCommit(auditor, requestId, targetProofs);
    }

    function _submitAuditCommit(address auditor, uint256 requestId, uint256[4][] calldata targetProofs) internal returns (bool accepted) {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditCommit);
        if (!reviewSubmissions[requestId][auditor].revealed) revert IneligibleReviewer();

        bytes32 commitHash = commitReveal.saved_commits(_auditCommitRound(requestId), auditor);
        if (commitHash == bytes32(0)) revert BadCommitment();

        AuditSubmission storage submission = auditSubmissions[requestId][auditor];
        if (submission.committed) revert AlreadySubmitted();

        address[] storage revealedReviewers = _revealedReviewers[requestId];
        uint256 expectedProofs = revealedReviewers.length > 0 ? revealedReviewers.length - 1 : 0;
        if (request_.config.auditElectionDifficulty >= SCALE) {
            if (targetProofs.length != 0) revert InvalidAuditTarget();
        } else if (targetProofs.length != expectedProofs) {
            revert InvalidAuditTarget();
        }
        uint256[2] memory publicKey = reviewerRegistry.vrfPublicKey(auditor);
        (bool assignmentOk, address[] memory canonicalTargets) = assignmentManager.verifiedCanonicalAuditTargets(
            address(vrfCoordinator),
            publicKey,
            address(this),
            requestId,
            auditor,
            revealedReviewers,
            targetProofs,
            request_.auditEpoch,
            request_.phaseStartedBlock,
            request_.config.finalityFactor,
            request_.config.auditElectionDifficulty,
            request_.config.auditTargetLimit
        );
        if (!assignmentOk) {
            _markProtocolFault(requestId, auditor, "av", request_.config.protocolFaultSlashBps);
            return false;
        }
        uint256 requiredTargets = _min(request_.config.auditTargetLimit, expectedProofs);
        if (canonicalTargets.length < requiredTargets) {
            _handleInsufficientAuditCandidates(requestId);
            return false;
        }

        _storeCanonicalAuditTargets(requestId, auditor, canonicalTargets);

        submission.commitHash = commitHash;
        submission.committed = true;
        reviewerRegistry.lockStake(auditor, requestId);
        request_.auditCommitCount++;

        if (request_.auditCommitCount >= request_.config.auditCommitQuorum) {
            _advance(requestId, RequestStatus.AuditReveal);
        }
        return true;
    }

    function revealAuditFor(
        address auditor,
        uint256 requestId,
        address[] calldata targets,
        uint16[] calldata scores,
        uint256 seed
    ) external {
        if (msg.sender != address(commitReveal)) revert InvalidAddress();
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditReveal);
        if (targets.length == 0 || targets.length != scores.length || targets.length > request_.config.auditTargetLimit) revert InvalidAuditTarget();

        AuditSubmission storage submission = auditSubmissions[requestId][auditor];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        bytes32 resultHash = _hashAuditReveal(requestId, auditor, targets, scores);
        try commitReveal.reveal_hashed(resultHash, auditor, seed, _auditCommitRound(requestId)) returns (bool ok) {
            if (!ok) {
                _markProtocolFault(requestId, auditor, "am", request_.config.protocolFaultSlashBps);
                return;
            }
        } catch {
            _markProtocolFault(requestId, auditor, "am", request_.config.protocolFaultSlashBps);
            return;
        }

        address[] storage canonicalTargets = _canonicalTargetsByAuditor[requestId][auditor];
        if (targets.length != canonicalTargets.length) {
            _markProtocolFault(requestId, auditor, "at", request_.config.protocolFaultSlashBps);
            return;
        }

        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            if (scores[i] > SCALE) {
                _markProtocolFault(requestId, auditor, "as", request_.config.protocolFaultSlashBps);
                return;
            }
            if (target == auditor || !reviewSubmissions[requestId][target].revealed || !_containsStorage(canonicalTargets, target)) {
                _markProtocolFault(requestId, auditor, "ai", request_.config.protocolFaultSlashBps);
                return;
            }

            for (uint256 j = 0; j < i; j++) {
                if (targets[j] == target) {
                    _markProtocolFault(requestId, auditor, "ad", request_.config.protocolFaultSlashBps);
                    return;
                }
            }

            auditScores[requestId][auditor][target] = scores[i];
            hasAuditScore[requestId][auditor][target] = true;
            _incomingAuditors[requestId][target].push(auditor);
            _auditTargetsByAuditor[requestId][auditor].push(target);
        }

        submission.revealed = true;
        request_.auditRevealCount++;

        if (request_.auditRevealCount >= request_.config.auditRevealQuorum) {
            _finalize(requestId);
        }
    }

    function handleTimeout(uint256 requestId) external nonReentrant {
        if (!_applyTimeoutIfNeeded(requestId)) revert TooEarly();
    }

    function _syncRequest(uint256 requestId) internal returns (RequestStatus status) {
        if (_applyTimeoutIfNeeded(requestId)) return requests[requestId].status;

        Request storage request_ = _requireRequest(requestId);
        if (request_.status == RequestStatus.AuditReveal && request_.auditRevealCount >= request_.config.auditRevealQuorum) {
            _finalize(requestId);
        }
        return requests[requestId].status;
    }

    function _applyTimeoutIfNeeded(uint256 requestId) internal returns (bool applied) {
        Request storage request_ = _requireRequest(requestId);
        if (!_isTimedOut(request_)) return false;

        if (request_.status == RequestStatus.ReviewCommit) {
            if (_canRetry(request_)) {
                _requeue(requestId);
            } else {
                _cancelAndRefund(requestId);
            }
            return true;
        }

        if (request_.status == RequestStatus.ReviewReveal) {
            _slashMissingReviewReveals(requestId);
            if (request_.reviewRevealCount < request_.config.reviewRevealQuorum && _canRetry(request_)) {
                _requeue(requestId);
            } else if (request_.reviewRevealCount == 0) {
                if (request_.tier == ServiceTier.Critical) _fail(requestId, RequestStatus.Unresolved);
                else _cancelAndRefund(requestId);
            } else {
                request_.lowConfidence = true;
                _snapshotRound0(requestId, false);
                _advance(requestId, RequestStatus.AuditCommit);
            }
            return true;
        }

        if (request_.status == RequestStatus.AuditCommit) {
            if (request_.tier == ServiceTier.Critical && request_.auditCommitCount < request_.config.auditCommitQuorum && _canRetry(request_)) {
                _requeue(requestId);
            } else if (request_.auditCommitCount == 0 && request_.tier == ServiceTier.Critical) {
                _fail(requestId, RequestStatus.Unresolved);
            } else {
                request_.lowConfidence = true;
                _advance(requestId, RequestStatus.AuditReveal);
            }
            return true;
        }

        if (request_.status == RequestStatus.AuditReveal) {
            _slashMissingAuditReveals(requestId);
            if (request_.tier == ServiceTier.Critical && request_.auditRevealCount < request_.config.auditRevealQuorum && _canRetry(request_)) {
                _requeue(requestId);
            } else {
                request_.lowConfidence = true;
                _finalize(requestId);
            }
            return true;
        }

        return false;
    }

    function _hashReviewReveal(
        uint256 requestId,
        address reviewer,
        uint16 proposalScore,
        bytes32 reportHash,
        string memory reportURI
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(requestId, reviewer, proposalScore, reportHash, keccak256(bytes(reportURI))));
    }

    function _hashAuditReveal(
        uint256 requestId,
        address auditor,
        address[] memory targets,
        uint16[] memory scores
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(requestId, auditor, targets, scores));
    }

    function _reviewCommitRound(uint256 requestId) internal view returns (uint256) {
        return (requestId * 1_000_000) + (requests[requestId].committeeEpoch * 2);
    }

    function _auditCommitRound(uint256 requestId) internal view returns (uint256) {
        return (requestId * 1_000_000) + (requests[requestId].auditEpoch * 2) + 1;
    }

    function getRequestLifecycle(uint256 requestId)
        external
        view
        returns (
            address requester,
            RequestStatus status,
            uint256 feePaid,
            uint256 priorityFee,
            uint256 retryCount,
            uint256 committeeEpoch,
            uint256 auditEpoch,
            uint256 activePriority,
            bool lowConfidence
        )
    {
        Request storage request_ = _requireRequest(requestId);
        return (
            request_.requester,
            request_.status,
            request_.feePaid,
            request_.priorityFee,
            request_.retryCount,
            request_.committeeEpoch,
            request_.auditEpoch,
            request_.activePriority,
            request_.lowConfidence
        );
    }

    function _finalize(uint256 requestId) internal {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditReveal);
        if (address(consensusScoring) == address(0) || address(settlement) == address(0) || address(reputationLedger) == address(0)) {
            revert InvalidAddress();
        }
        ScoringData memory data = _computeScoringData(requestId);
        uint256 reviewerCount = data.reviewers.length;
        if (reviewerCount == 0) revert IneligibleReviewer();

        if (request_.tier == ServiceTier.Critical && data.output.coverage < request_.config.auditCoverageQuorum) {
            request_.confidence = data.output.confidence;
            request_.auditCoverage = data.output.coverage;
            request_.scoreDispersion = data.output.scoreDispersion;
            request_.lowConfidence = true;
            _snapshotRound0(requestId, true);
            _recordFinalSnapshots(requestId, data, true);
            if (_canRetry(request_)) {
                _requeue(requestId);
            } else {
                _unlockRequestStakes(requestId);
                _fail(requestId, RequestStatus.Unresolved);
            }
            return;
        }

        _snapshotRound0(requestId, false);
        (uint256 finalScore, uint256 finalTotalWeight, bool finalLowConfidence) = _recordFinalSnapshots(requestId, data, false);

        request_.finalProposalScore = finalScore;
        request_.confidence = data.output.confidence;
        request_.auditCoverage = data.output.coverage;
        request_.scoreDispersion = data.output.scoreDispersion;
        request_.finalReliability = data.output.confidence;
        request_.lowConfidence = data.output.lowConfidence || finalLowConfidence;
        request_.status = RequestStatus.Finalized;
        _releaseActiveSlot();

        uint256 rewardPool = request_.rewardPool;
        IDAIORoundLedgerLike ledger = roundLedger;
        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = data.reviewers[i];
            bool protocolFault = reviewSubmissions[requestId][reviewer].protocolFault || auditSubmissions[requestId][reviewer].protocolFault;
            uint256 finalWeight = ledger.reviewerRoundWeight(requestId, request_.retryCount, ROUND_REPUTATION_FINAL, reviewer);
            ISettlementLike.ReviewerOutput memory settlementOutput = settlement.reviewerSettlement(
                ISettlementLike.ReviewerInput({
                    rewardPool: rewardPool,
                    totalContribution: finalTotalWeight,
                    weight: finalWeight,
                    proposalScore: data.proposalScores[i],
                    finalScore: finalScore,
                    contribution: data.output.contributions[i],
                    contributionThreshold: request_.config.contributionThreshold,
                    covered: data.output.covered[i],
                    protocolFault: protocolFault
                })
            );

            reviewerResults[requestId][reviewer] = ReviewerResult({
                reportQualityMedian: data.output.medians[i],
                normalizedReportQuality: data.output.normalizedQuality[i],
                auditReliabilityRaw: data.output.rawReliability[i],
                normalizedAuditReliability: data.output.normalizedReliability[i],
                finalContribution: data.output.contributions[i],
                scoreAgreement: settlementOutput.scoreAgreement,
                reward: settlementOutput.reward,
                minorityOpinion: data.output.minority[i],
                covered: data.output.covered[i],
                protocolFault: protocolFault
            });

            if (settlementOutput.semanticFault) {
                _markSemanticFaultAccounting(requestId, reviewer, "ss");
                bool suspended =
                    reviewerRegistry.recordSemanticFault(reviewer, request_.config.semanticStrikeThreshold, request_.config.cooldownBlocks);
                if (suspended) {
                    _slashStakeBps(requestId, reviewer, request_.config.semanticSlashBps, "ss", false);
                }
            }

            reviewerRegistry.markCompleted(reviewer);

            reputationLedger.record(
                reviewer,
                reviewerRegistry.agentId(reviewer),
                data.output.normalizedQuality[i],
                data.output.normalizedReliability[i],
                data.output.contributions[i],
                data.output.confidence,
                protocolFault,
                settlementOutput.scoreAgreement,
                data.output.minority[i],
                reviewSubmissions[requestId][reviewer].reportURI,
                reviewSubmissions[requestId][reviewer].reportHash
            );

            if (settlementOutput.reward > 0) {
                stakeVault.payReward(requestId, reviewer, settlementOutput.reward);
                _recordRewardAccounting(requestId, reviewer, settlementOutput.reward);
            }
        }

        _unlockRequestStakes(requestId);
        stakeVault.closeRequestToTreasury(requestId);
        request_.rewardPool = 0;
        request_.protocolFee = 0;

        emit RequestFinalized(requestId, finalScore, data.output.confidence, request_.lowConfidence);
        emit StatusChanged(requestId, RequestStatus.Finalized);
    }

    function _computeScoringData(uint256 requestId) internal view returns (ScoringData memory data) {
        Request storage request_ = _requireRequest(requestId);
        address[] storage reviewers_ = _revealedReviewers[requestId];
        uint256 reviewerCount = reviewers_.length;
        if (reviewerCount == 0) revert IneligibleReviewer();

        data.reviewers = new address[](reviewerCount);
        data.proposalScores = new uint256[](reviewerCount);
        uint256[][] memory incomingScoresByTarget = new uint256[][](reviewerCount);
        uint256[][] memory auditorTargetIndexes = new uint256[][](reviewerCount);
        uint256[][] memory auditorScores = new uint256[][](reviewerCount);

        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewers_[i];
            data.reviewers[i] = reviewer;
            data.proposalScores[i] = reviewSubmissions[requestId][reviewer].proposalScore;
        }

        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = data.reviewers[i];
            address[] storage incomingAuditors = _incomingAuditors[requestId][reviewer];
            incomingScoresByTarget[i] = new uint256[](incomingAuditors.length);
            for (uint256 j = 0; j < incomingAuditors.length; j++) {
                incomingScoresByTarget[i][j] = auditScores[requestId][incomingAuditors[j]][reviewer];
            }

            address[] storage targets = _auditTargetsByAuditor[requestId][reviewer];
            auditorTargetIndexes[i] = new uint256[](targets.length);
            auditorScores[i] = new uint256[](targets.length);
            for (uint256 j = 0; j < targets.length; j++) {
                auditorTargetIndexes[i][j] = _reviewerIndex(data.reviewers, targets[j]);
                auditorScores[i][j] = auditScores[requestId][reviewer][targets[j]];
            }
        }

        data.output = consensusScoring.compute(
            IConsensusScoringLike.Input({
                reviewRevealCount: request_.reviewRevealCount,
                auditRevealCount: request_.auditRevealCount,
                reviewCommitQuorum: request_.config.reviewCommitQuorum,
                auditCommitQuorum: request_.config.auditCommitQuorum,
                minIncomingAudit: request_.config.minIncomingAudit,
                auditCoverageQuorum: request_.config.auditCoverageQuorum,
                contributionThreshold: request_.config.contributionThreshold,
                minorityThreshold: request_.config.minorityThreshold,
                lowConfidence: request_.lowConfidence,
                proposalScores: data.proposalScores,
                incomingScoresByTarget: incomingScoresByTarget,
                auditorTargetIndexes: auditorTargetIndexes,
                auditorScores: auditorScores
            })
        );
    }

    function _snapshotRound0(uint256 requestId, bool aborted) internal {
        Request storage request_ = _requireRequest(requestId);
        uint256 attempt = request_.retryCount;

        address[] storage reviewers_ = _revealedReviewers[requestId];
        uint256 reviewerCount = reviewers_.length;
        if (reviewerCount == 0) return;

        IDAIORoundLedgerLike ledger = _roundLedger();
        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewers_[i];
            ledger.recordReviewScore(requestId, attempt, reviewer, reviewSubmissions[requestId][reviewer].proposalScore);
        }
        ledger.closeReviewSnapshot(requestId, attempt, request_.config.reviewRevealQuorum, request_.lowConfidence, aborted);
    }

    function _recordFinalSnapshots(uint256 requestId, ScoringData memory data, bool aborted)
        internal
        returns (uint256 finalScore, uint256 totalWeight, bool lowConfidence)
    {
        Request storage request_ = _requireRequest(requestId);
        IDAIORoundLedgerLike ledger = _roundLedger();
        uint256 attempt = request_.retryCount;
        for (uint256 i = 0; i < data.reviewers.length; i++) {
            ledger.recordConsensusScore(requestId, attempt, data.reviewers[i], data.proposalScores[i], data.output.weights[i], data.output.medians[i]);
        }
        ledger.closeConsensusSnapshot(
            requestId,
            attempt,
            data.output.finalScore,
            data.output.totalContribution,
            data.output.confidence,
            data.output.coverage,
            data.output.lowConfidence,
            aborted
        );
        return ledger.closeReputationFinal(
            requestId, attempt, address(reputationLedger), data.output.confidence, data.output.coverage, data.output.lowConfidence, aborted
        );
    }

    function _snapshotAttemptProgress(uint256 requestId, bool aborted) internal {
        Request storage request_ = _requireRequest(requestId);
        if (request_.reviewRevealCount > 0) _snapshotRound0(requestId, aborted);
        if (
            request_.auditRevealCount > 0 && address(consensusScoring) != address(0) && address(reputationLedger) != address(0)
                && _revealedReviewers[requestId].length > 0
        ) {
            ScoringData memory data = _computeScoringData(requestId);
            _recordFinalSnapshots(requestId, data, aborted);
        }
    }

    function _cancelAndRefund(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);
        _snapshotAttemptProgress(requestId, true);
        _unlockRequestStakes(requestId);
        request_.rewardPool = 0;
        request_.protocolFee = 0;
        request_.status = RequestStatus.Cancelled;
        _releaseActiveSlot();
        stakeVault.refundRequest(requestId, request_.requester);

        emit StatusChanged(requestId, RequestStatus.Cancelled);
    }

    function _fail(uint256 requestId, RequestStatus status) internal {
        if (status != RequestStatus.Failed && status != RequestStatus.Unresolved) revert BadConfig();

        Request storage request_ = _requireRequest(requestId);
        _snapshotAttemptProgress(requestId, true);
        _unlockRequestStakes(requestId);
        request_.rewardPool = 0;
        request_.protocolFee = 0;
        request_.status = status;
        _releaseActiveSlot();
        stakeVault.refundRequest(requestId, request_.requester);

        emit StatusChanged(requestId, status);
    }

    function _canRetry(Request storage request_) internal view returns (bool) {
        return request_.retryCount < request_.config.maxRetries;
    }

    function _requeue(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);

        _clearRequestProgress(requestId);

        request_.retryCount++;
        request_.committeeEpoch = (block.number / request_.config.reviewEpochSize) + request_.retryCount;
        request_.auditEpoch = (block.number / request_.config.auditEpochSize) + request_.retryCount;
        request_.lowConfidence = false;
        uint256 pmax = request_.activePriority;
        if (priorityQueue.currentSize() > 0) {
            (uint256 topPriority,) = priorityQueue.top();
            if (topPriority > pmax) pmax = topPriority;
        }
        request_.activePriority = pmax > 0 ? pmax - 1 : 0;
        request_.status = RequestStatus.Queued;
        _releaseActiveSlot();
        request_.phaseStartedAt = block.timestamp;
        request_.phaseStartedBlock = block.number;

        priorityQueue.pushRequest(request_.activePriority, requestId);

        emit StatusChanged(requestId, RequestStatus.Queued);
    }

    function _clearRequestProgress(uint256 requestId) internal {
        _snapshotAttemptProgress(requestId, true);
        _unlockRequestStakes(requestId);

        address[] storage committers = _reviewCommitters[requestId];
        for (uint256 i = 0; i < committers.length; i++) {
            delete reviewSubmissions[requestId][committers[i]];
        }

        address[] storage revealed = _revealedReviewers[requestId];
        for (uint256 i = 0; i < revealed.length; i++) {
            address reviewer = revealed[i];
            delete reviewSubmissions[requestId][reviewer];
            delete auditSubmissions[requestId][reviewer];

            address[] storage targets = _auditTargetsByAuditor[requestId][reviewer];
            for (uint256 j = 0; j < targets.length; j++) {
                address target = targets[j];
                delete auditScores[requestId][reviewer][target];
                delete hasAuditScore[requestId][reviewer][target];
                delete _incomingAuditors[requestId][target];
            }
            delete _auditTargetsByAuditor[requestId][reviewer];

            address[] storage canonicalTargets = _canonicalTargetsByAuditor[requestId][reviewer];
            for (uint256 j = 0; j < canonicalTargets.length; j++) {
                delete canonicalAuditTargets[requestId][reviewer][canonicalTargets[j]];
            }
            delete _canonicalTargetsByAuditor[requestId][reviewer];
        }

        delete _reviewCommitters[requestId];
        delete _revealedReviewers[requestId];

        Request storage request_ = requests[requestId];
        request_.reviewCommitCount = 0;
        request_.reviewRevealCount = 0;
        request_.auditCommitCount = 0;
        request_.auditRevealCount = 0;
    }

    function _unlockRequestStakes(uint256 requestId) internal {
        address[] storage committers = _reviewCommitters[requestId];
        for (uint256 i = 0; i < committers.length; i++) {
            reviewerRegistry.unlockStake(committers[i], requestId);
        }
    }

    function _slashMissingReviewReveals(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);
        address[] storage committers = _reviewCommitters[requestId];
        for (uint256 i = 0; i < committers.length; i++) {
            address reviewer = committers[i];
            ReviewSubmission storage submission = reviewSubmissions[requestId][reviewer];
            if (submission.committed && !submission.revealed) {
                _markProtocolFault(requestId, reviewer, "mr", request_.config.missedRevealSlashBps);
            }
        }
    }

    function _slashMissingAuditReveals(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);
        address[] storage reviewers_ = _revealedReviewers[requestId];
        for (uint256 i = 0; i < reviewers_.length; i++) {
            address auditor = reviewers_[i];
            AuditSubmission storage submission = auditSubmissions[requestId][auditor];
            if (submission.committed && !submission.revealed) {
                _markProtocolFault(requestId, auditor, "ma", request_.config.missedRevealSlashBps);
            }
        }
    }

    function _handleInsufficientAuditCandidates(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);
        if (_canRetry(request_)) {
            _requeue(requestId);
        } else if (request_.tier == ServiceTier.Critical) {
            _fail(requestId, RequestStatus.Unresolved);
        } else {
            request_.lowConfidence = true;
        }
    }

    function _storeCanonicalAuditTargets(uint256 requestId, address auditor, address[] memory targets) internal {
        delete _canonicalTargetsByAuditor[requestId][auditor];
        for (uint256 i = 0; i < targets.length; i++) {
            canonicalAuditTargets[requestId][auditor][targets[i]] = true;
            _canonicalTargetsByAuditor[requestId][auditor].push(targets[i]);
        }
    }

    function _markProtocolFault(uint256 requestId, address reviewerAddress, string memory reason, uint256 slashBps) internal {
        bool alreadyFaulted = reviewSubmissions[requestId][reviewerAddress].protocolFault
            || auditSubmissions[requestId][reviewerAddress].protocolFault;

        reviewSubmissions[requestId][reviewerAddress].protocolFault = true;
        auditSubmissions[requestId][reviewerAddress].protocolFault = true;

        if (!alreadyFaulted) {
            _slashStakeBps(requestId, reviewerAddress, slashBps, reason, true);
            requestFaultCount[requestId]++;
        }
    }

    function _slashStakeBps(uint256 requestId, address reviewerAddress, uint256 slashBps, string memory reason, bool protocolFault)
        internal
        returns (uint256 amount)
    {
        amount = reviewerRegistry.slashStakeBps(reviewerAddress, slashBps, reason, protocolFault);
        _recordSlashAccounting(requestId, reviewerAddress, amount, reason, protocolFault);
    }

    function _recordSlashAccounting(uint256 requestId, address reviewer, uint256 amount, string memory reason, bool protocolFault) internal {
        Request storage request_ = _requireRequest(requestId);
        uint8 round = _accountingRoundFor(request_.status, protocolFault);
        _roundLedger().recordSlash(requestId, request_.retryCount, round, reviewer, amount, keccak256(bytes(reason)), protocolFault);
    }

    function _markSemanticFaultAccounting(uint256 requestId, address reviewer, string memory reason) internal {
        Request storage request_ = _requireRequest(requestId);
        _roundLedger().markSemanticFault(requestId, request_.retryCount, ROUND_REPUTATION_FINAL, reviewer, keccak256(bytes(reason)));
    }

    function _recordRewardAccounting(uint256 requestId, address reviewer, uint256 amount) internal {
        if (amount == 0) return;
        Request storage request_ = _requireRequest(requestId);
        _roundLedger().recordReward(requestId, request_.retryCount, ROUND_REPUTATION_FINAL, reviewer, amount);
    }

    function _accountingRoundFor(RequestStatus status, bool protocolFault) internal pure returns (uint8) {
        if (!protocolFault) return ROUND_REPUTATION_FINAL;
        if (status == RequestStatus.AuditCommit || status == RequestStatus.AuditReveal) return ROUND_AUDIT_CONSENSUS;
        if (status == RequestStatus.Finalized || status == RequestStatus.Unresolved) return ROUND_REPUTATION_FINAL;
        return ROUND_REVIEW;
    }

    function _advance(uint256 requestId, RequestStatus status) internal {
        Request storage request_ = _requireRequest(requestId);
        request_.status = status;
        request_.phaseStartedAt = block.timestamp;
        request_.phaseStartedBlock = block.number;
        emit StatusChanged(requestId, status);
    }

    function _releaseActiveSlot() internal {
        if (activeRequestCount == 0) return;
        activeRequestCount--;
    }

    function _requireRequest(uint256 requestId) internal view returns (Request storage request_) {
        request_ = requests[requestId];
        if (request_.status == RequestStatus.None) revert UnknownRequest();
    }

    function _requireStatus(uint256 requestId, RequestStatus status) internal view returns (Request storage request_) {
        request_ = _requireRequest(requestId);
        if (request_.status != status) revert BadStatus(status, request_.status);
    }

    function _roundLedger() internal view returns (IDAIORoundLedgerLike ledger) {
        ledger = roundLedger;
        if (address(ledger) == address(0)) revert InvalidAddress();
    }

    function _eligibleForRequest(address reviewerAddress, uint256 domainMask) internal view returns (bool) {
        return address(reviewerRegistry) != address(0) && reviewerRegistry.isEligible(reviewerAddress, domainMask);
    }

    function _isTimedOut(Request storage request_) internal view returns (bool) {
        uint256 timeout = _timeoutFor(request_);
        return timeout > 0 && block.timestamp > request_.phaseStartedAt + timeout;
    }

    function _timeoutFor(Request storage request_) internal view returns (uint256) {
        if (request_.status == RequestStatus.ReviewCommit) return request_.config.reviewCommitTimeout;
        if (request_.status == RequestStatus.ReviewReveal) return request_.config.reviewRevealTimeout;
        if (request_.status == RequestStatus.AuditCommit) return request_.config.auditCommitTimeout;
        if (request_.status == RequestStatus.AuditReveal) return request_.config.auditRevealTimeout;
        return 0;
    }

    function _tryVrfRandomness(
        uint256 requestId,
        bytes32 phase,
        uint256 epoch,
        address reviewerAddress,
        address target,
        uint256[4] calldata vrfProof
    ) internal view returns (bool ok, bytes32 randomness) {
        uint256[2] memory publicKey = reviewerRegistry.vrfPublicKey(reviewerAddress);
        if (publicKey[0] == 0 || publicKey[1] == 0) return (false, bytes32(0));
        Request storage request_ = _requireRequest(requestId);
        try vrfCoordinator.randomness(
            publicKey,
            vrfProof,
            address(this),
            requestId,
            phase,
            epoch,
            reviewerAddress,
            target,
            request_.phaseStartedBlock,
            request_.config.finalityFactor
        ) returns (bytes32 value) {
            return (true, value);
        } catch {
            return (false, bytes32(0));
        }
    }

    function _containsStorage(address[] storage values, address target) internal view returns (bool) {
        for (uint256 i = 0; i < values.length; i++) {
            if (values[i] == target) return true;
        }
        return false;
    }

    function _reviewerIndex(address[] memory reviewers_, address target) internal pure returns (uint256) {
        for (uint256 i = 0; i < reviewers_.length; i++) {
            if (reviewers_[i] == target) return i;
        }
        revert InvalidAuditTarget();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

}
