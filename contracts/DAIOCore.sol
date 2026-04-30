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
    function withdrawTreasury(address to, uint256 amount) external;
    function treasuryBalance() external view returns (uint256);
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

interface IAssignmentManagerLike {
    function canonicalAuditTargets(
        uint256 requestId,
        address auditor,
        address[] calldata revealedReviewers,
        bytes32 randomness,
        uint256 difficulty,
        uint256 limit
    ) external pure returns (address[] memory selectedTargets);
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
    function reputations(address reviewer)
        external
        view
        returns (
            uint256 samples,
            uint256 reportQuality,
            uint256 auditReliability,
            uint256 finalContribution,
            uint256 protocolCompliance
        );

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

    bytes32 internal constant REVIEW_SORTITION = keccak256("DAIO_REVIEW_SORTITION");
    bytes32 internal constant AUDIT_SORTITION = keccak256("DAIO_AUDIT_SORTITION");

    ICommitReveal public immutable commitReveal;
    IPriorityQueue public immutable priorityQueue;
    IDAIOVRFCoordinator public immutable vrfCoordinator;
    address public owner;
    address public treasury;
    address public paymentRouter;
    IStakeVaultLike public stakeVault;
    IReviewerRegistryLike public reviewerRegistry;
    IAssignmentManagerLike public assignmentManager;
    IConsensusScoringLike public consensusScoring;
    ISettlementLike public settlement;
    IReputationLedgerLike public reputationLedger;

    uint256 public baseRequestFee = 100 ether;
    uint256 public protocolFeeBps = 1_000;
    uint256 public requestCount;

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

    mapping(uint256 requestId => Request data) internal requests;
    mapping(uint256 tier => RequestConfig config) internal tierConfigs;
    mapping(uint256 requestId => mapping(address reviewer => ReviewSubmission submission)) internal reviewSubmissions;
    mapping(uint256 requestId => mapping(address auditor => AuditSubmission submission)) internal auditSubmissions;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => uint16 score))) internal auditScores;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => bool exists))) internal hasAuditScore;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => bool canonical))) public canonicalAuditTargets;
    mapping(uint256 requestId => mapping(address reviewer => ReviewerResult result)) internal reviewerResults;
    mapping(uint256 requestId => uint256 faults) public requestFaultCount;

    mapping(uint256 requestId => address[] reviewers) private _reviewCommitters;
    mapping(uint256 requestId => address[] reviewers) private _revealedReviewers;
    mapping(uint256 requestId => mapping(address target => address[] auditors)) private _incomingAuditors;
    mapping(uint256 requestId => mapping(address auditor => address[] targets)) private _auditTargetsByAuditor;
    mapping(uint256 requestId => mapping(address auditor => address[] targets)) private _canonicalTargetsByAuditor;

    event AuditCommitted(uint256 indexed requestId, address indexed auditor, bytes32 commitHash);
    event AuditRevealed(uint256 indexed requestId, address indexed auditor, uint256 targetCount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RequestCreated(uint256 indexed requestId, address indexed requester, ServiceTier tier, uint256 feePaid, uint256 priorityFee);
    event RequestFinalized(uint256 indexed requestId, uint256 finalProposalScore, uint256 confidence, bool lowConfidence);
    event RequestRequeued(uint256 indexed requestId, uint256 retryCount, uint256 priority);
    event RequestStarted(uint256 indexed requestId);
    event ModulesUpdated(
        address indexed stakeVault,
        address indexed reviewerRegistry,
        address assignmentManager,
        address consensusScoring,
        address settlement,
        address reputationLedger
    );
    event ReviewCommitted(uint256 indexed requestId, address indexed reviewer, bytes32 commitHash);
    event ReviewRevealed(uint256 indexed requestId, address indexed reviewer, uint16 proposalScore, bytes32 reportHash, string reportURI);
    event ProtocolFault(uint256 indexed requestId, address indexed reviewer, string reason);
    event ReviewerSlashed(address indexed reviewer, uint256 amount, string reason);
    event StatusChanged(uint256 indexed requestId, RequestStatus status);
    event TreasuryWithdrawn(address indexed to, uint256 amount);

    error AlreadySubmitted();
    error BadCommitment();
    error BadConfig();
    error BadStatus(RequestStatus expected, RequestStatus actual);
    error IneligibleReviewer();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidAuditTarget();
    error InvalidScore();
    error NotOwner();
    error NotSelected();
    error PhaseTimedOut();
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
        address vrfCoordinator_
    ) {
        if (
            treasury_ == address(0) || commitReveal_ == address(0) || priorityQueue_ == address(0) || vrfCoordinator_ == address(0)
        ) {
            revert InvalidAddress();
        }

        commitReveal = ICommitReveal(commitReveal_);
        priorityQueue = IPriorityQueue(priorityQueue_);
        vrfCoordinator = IDAIOVRFCoordinator(vrfCoordinator_);
        owner = msg.sender;
        treasury = treasury_;

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setPaymentRouter(address newPaymentRouter) external onlyOwner {
        if (newPaymentRouter == address(0)) revert InvalidAddress();
        paymentRouter = newPaymentRouter;
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
        emit ModulesUpdated(stakeVault_, reviewerRegistry_, assignmentManager_, consensusScoring_, settlement_, reputationLedger_);
    }

    function setEconomics(uint256 newBaseRequestFee, uint256 newMinStake, uint256 newProtocolFeeBps) external onlyOwner {
        newMinStake;
        if (newProtocolFeeBps > BPS) revert InvalidAmount();

        baseRequestFee = newBaseRequestFee;
        protocolFeeBps = newProtocolFeeBps;
    }

    function setTierConfig(ServiceTier tier, RequestConfig calldata config) external onlyOwner {
        _validateConfig(config);
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
        _validateConfig(config);

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

        emit RequestCreated(requestId, requester, tier, feePaid, priorityFee);
        emit StatusChanged(requestId, RequestStatus.Queued);
    }

    function startNextRequest() external returns (uint256 requestId) {
        while (priorityQueue.currentSize() > 0) {
            (, uint256 candidateId) = priorityQueue.popRequest();
            if (requests[candidateId].status == RequestStatus.Queued) {
                requestId = candidateId;
                break;
            }
        }

        if (requestId == 0) revert QueueEmpty();

        _advance(requestId, RequestStatus.ReviewCommit);
        emit RequestStarted(requestId);
    }

    function submitReviewCommitFor(address reviewer, uint256 requestId, uint256[4] calldata vrfProof) external {
        if (msg.sender != address(commitReveal)) revert InvalidAddress();
        _submitReviewCommit(reviewer, requestId, vrfProof);
    }

    function _submitReviewCommit(address reviewer, uint256 requestId, uint256[4] calldata vrfProof) internal {
        Request storage request_ = _requireStatus(requestId, RequestStatus.ReviewCommit);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (!_eligibleForRequest(reviewer, request_.domainMask)) revert IneligibleReviewer();

        bytes32 commitHash = commitReveal.saved_commits(reviewCommitRound(requestId), reviewer);
        if (commitHash == bytes32(0)) revert BadCommitment();

        (bool vrfOk, bytes32 randomness) = _tryVrfRandomness(requestId, REVIEW_SORTITION, request_.committeeEpoch, reviewer, address(0), vrfProof);
        if (!vrfOk) {
            _markProtocolFault(requestId, reviewer, "invalid-review-vrf-proof", request_.config.protocolFaultSlashBps);
            return;
        }
        if (!_passesSortition(REVIEW_SORTITION, requestId, reviewer, address(0), randomness, request_.config.reviewElectionDifficulty)) {
            _markProtocolFault(requestId, reviewer, "invalid-review-sortition", request_.config.protocolFaultSlashBps);
            return;
        }

        ReviewSubmission storage submission = reviewSubmissions[requestId][reviewer];
        if (submission.committed) revert AlreadySubmitted();

        submission.commitHash = commitHash;
        submission.sortitionRandomness = randomness;
        submission.committed = true;

        _reviewCommitters[requestId].push(reviewer);
        request_.reviewCommitCount++;

        emit ReviewCommitted(requestId, reviewer, commitHash);

        if (request_.reviewCommitCount >= request_.config.reviewCommitQuorum) {
            _advance(requestId, RequestStatus.ReviewReveal);
        }
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
        if (_isTimedOut(request_)) revert PhaseTimedOut();

        ReviewSubmission storage submission = reviewSubmissions[requestId][reviewer];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        if (proposalScore > SCALE || reportHash == bytes32(0) || bytes(reportURI).length == 0) {
            _markProtocolFault(requestId, reviewer, "invalid-review-reveal", request_.config.protocolFaultSlashBps);
            return;
        }

        bytes32 resultHash = _hashReviewReveal(requestId, reviewer, proposalScore, reportHash, reportURI);
        try commitReveal.reveal_hashed(resultHash, reviewer, seed, reviewCommitRound(requestId)) returns (bool ok) {
            if (!ok) {
                _markProtocolFault(requestId, reviewer, "review-reveal-mismatch", request_.config.protocolFaultSlashBps);
                return;
            }
        } catch {
            _markProtocolFault(requestId, reviewer, "review-reveal-mismatch", request_.config.protocolFaultSlashBps);
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
            _advance(requestId, RequestStatus.AuditCommit);
        }
    }

    function submitAuditCommitFor(address auditor, uint256 requestId, uint256[4] calldata vrfProof) external {
        if (msg.sender != address(commitReveal)) revert InvalidAddress();
        _submitAuditCommit(auditor, requestId, vrfProof);
    }

    function _submitAuditCommit(address auditor, uint256 requestId, uint256[4] calldata vrfProof) internal {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditCommit);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (!reviewSubmissions[requestId][auditor].revealed) revert IneligibleReviewer();

        bytes32 commitHash = commitReveal.saved_commits(auditCommitRound(requestId), auditor);
        if (commitHash == bytes32(0)) revert BadCommitment();

        AuditSubmission storage submission = auditSubmissions[requestId][auditor];
        if (submission.committed) revert AlreadySubmitted();

        (bool vrfOk, bytes32 randomness) = _tryVrfRandomness(requestId, AUDIT_SORTITION, request_.auditEpoch, auditor, address(0), vrfProof);
        if (!vrfOk) {
            _markProtocolFault(requestId, auditor, "invalid-audit-vrf-proof", request_.config.protocolFaultSlashBps);
            return;
        }

        if (address(assignmentManager) == address(0)) revert InvalidAddress();
        address[] memory canonicalTargets = assignmentManager.canonicalAuditTargets(
            requestId,
            auditor,
            _revealedReviewers[requestId],
            randomness,
            request_.config.auditElectionDifficulty,
            request_.config.auditTargetLimit
        );
        uint256 requiredTargets = _min(request_.config.auditTargetLimit, _revealedReviewers[requestId].length > 0 ? _revealedReviewers[requestId].length - 1 : 0);
        if (canonicalTargets.length < requiredTargets) {
            _handleInsufficientAuditCandidates(requestId);
            return;
        }

        _storeCanonicalAuditTargets(requestId, auditor, canonicalTargets);

        submission.commitHash = commitHash;
        submission.committed = true;
        request_.auditCommitCount++;

        emit AuditCommitted(requestId, auditor, commitHash);

        if (request_.auditCommitCount >= request_.config.auditCommitQuorum) {
            _advance(requestId, RequestStatus.AuditReveal);
        }
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
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (targets.length == 0 || targets.length != scores.length || targets.length > request_.config.auditTargetLimit) revert InvalidAuditTarget();

        AuditSubmission storage submission = auditSubmissions[requestId][auditor];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        bytes32 resultHash = _hashAuditReveal(requestId, auditor, targets, scores);
        try commitReveal.reveal_hashed(resultHash, auditor, seed, auditCommitRound(requestId)) returns (bool ok) {
            if (!ok) {
                _markProtocolFault(requestId, auditor, "audit-reveal-mismatch", request_.config.protocolFaultSlashBps);
                return;
            }
        } catch {
            _markProtocolFault(requestId, auditor, "audit-reveal-mismatch", request_.config.protocolFaultSlashBps);
            return;
        }

        address[] storage canonicalTargets = _canonicalTargetsByAuditor[requestId][auditor];
        if (targets.length != canonicalTargets.length) {
            _markProtocolFault(requestId, auditor, "non-canonical-audit-targets", request_.config.protocolFaultSlashBps);
            return;
        }

        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            if (scores[i] > SCALE) {
                _markProtocolFault(requestId, auditor, "audit-score-out-of-range", request_.config.protocolFaultSlashBps);
                return;
            }
            if (target == auditor || !reviewSubmissions[requestId][target].revealed || !_containsStorage(canonicalTargets, target)) {
                _markProtocolFault(requestId, auditor, "invalid-audit-target", request_.config.protocolFaultSlashBps);
                return;
            }

            for (uint256 j = 0; j < i; j++) {
                if (targets[j] == target) {
                    _markProtocolFault(requestId, auditor, "duplicate-audit-target", request_.config.protocolFaultSlashBps);
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

        emit AuditRevealed(requestId, auditor, targets.length);
    }

    function handleTimeout(uint256 requestId) external nonReentrant {
        Request storage request_ = _requireRequest(requestId);
        if (!_isTimedOut(request_)) revert TooEarly();

        if (request_.status == RequestStatus.ReviewCommit) {
            if (_canRetry(request_)) {
                _requeue(requestId);
            } else {
                _cancelAndRefund(requestId);
            }
            return;
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
                _advance(requestId, RequestStatus.AuditCommit);
            }
            return;
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
            return;
        }

        if (request_.status == RequestStatus.AuditReveal) {
            _slashMissingAuditReveals(requestId);
            if (request_.tier == ServiceTier.Critical && request_.auditRevealCount < request_.config.auditRevealQuorum && _canRetry(request_)) {
                _requeue(requestId);
            } else {
                request_.lowConfidence = true;
                _finalize(requestId);
            }
            return;
        }

        revert TooEarly();
    }

    function finalizeRequest(uint256 requestId) external nonReentrant {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditReveal);
        if (request_.auditRevealCount < request_.config.auditRevealQuorum && !_isTimedOut(request_)) revert TooEarly();
        if (request_.auditRevealCount < request_.config.auditRevealQuorum) request_.lowConfidence = true;

        _finalize(requestId);
    }

    function withdrawTreasury(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > treasuryBalance()) revert InvalidAmount();
        stakeVault.withdrawTreasury(treasury, amount);
        emit TreasuryWithdrawn(treasury, amount);
    }

    function treasuryBalance() public view returns (uint256) {
        return address(stakeVault) == address(0) ? 0 : stakeVault.treasuryBalance();
    }

    function reputations(address reviewer)
        external
        view
        returns (
            uint256 samples,
            uint256 reportQuality,
            uint256 auditReliability,
            uint256 finalContribution,
            uint256 protocolCompliance
        )
    {
        if (address(reputationLedger) == address(0)) return (0, 0, 0, 0, 0);
        return reputationLedger.reputations(reviewer);
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

    function reviewCommitRound(uint256 requestId) public view returns (uint256) {
        return (requestId * 1_000_000) + (requests[requestId].committeeEpoch * 2);
    }

    function auditCommitRound(uint256 requestId) public view returns (uint256) {
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

    function getReviewerResult(uint256 requestId, address reviewer)
        external
        view
        returns (
            uint256 reportQualityMedian,
            uint256 normalizedReportQuality,
            uint256 auditReliabilityRaw,
            uint256 normalizedAuditReliability,
            uint256 finalContribution,
            uint256 scoreAgreement,
            uint256 reward,
            bool minorityOpinion,
            bool covered,
            bool protocolFault
        )
    {
        ReviewerResult storage result = reviewerResults[requestId][reviewer];
        return (
            result.reportQualityMedian,
            result.normalizedReportQuality,
            result.auditReliabilityRaw,
            result.normalizedAuditReliability,
            result.finalContribution,
            result.scoreAgreement,
            result.reward,
            result.minorityOpinion,
            result.covered,
            result.protocolFault
        );
    }

    function getRequestFinalResult(uint256 requestId)
        external
        view
        returns (
            RequestStatus status,
            uint256 finalProposalScore,
            uint256 confidence,
            uint256 auditCoverage,
            uint256 scoreDispersion,
            uint256 finalReliability,
            bool lowConfidence,
            uint256 faultSignal
        )
    {
        Request storage request_ = _requireRequest(requestId);
        return (
            request_.status,
            request_.finalProposalScore,
            request_.confidence,
            request_.auditCoverage,
            request_.scoreDispersion,
            request_.finalReliability,
            request_.lowConfidence,
            requestFaultCount[requestId]
        );
    }

    function getReviewerRequestSignals(uint256 requestId, address reviewer)
        external
        view
        returns (
            uint256 reportQuality,
            uint256 auditReliability,
            uint256 finalContribution,
            uint256 scoreAgreement,
            uint256 reward,
            bool minorityOpinion,
            bool covered,
            bool protocolFault
        )
    {
        ReviewerResult storage result = reviewerResults[requestId][reviewer];
        return (
            result.normalizedReportQuality,
            result.normalizedAuditReliability,
            result.finalContribution,
            result.scoreAgreement,
            result.reward,
            result.minorityOpinion,
            result.covered,
            result.protocolFault
        );
    }

    function _finalize(uint256 requestId) internal {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditReveal);
        address[] storage reviewers_ = _revealedReviewers[requestId];
        uint256 reviewerCount = reviewers_.length;
        if (reviewerCount == 0) revert IneligibleReviewer();
        if (address(consensusScoring) == address(0) || address(settlement) == address(0) || address(reputationLedger) == address(0)) {
            revert InvalidAddress();
        }

        address[] memory reviewerList = new address[](reviewerCount);
        uint256[] memory proposalScores = new uint256[](reviewerCount);
        uint256[][] memory incomingScoresByTarget = new uint256[][](reviewerCount);
        uint256[][] memory auditorTargetIndexes = new uint256[][](reviewerCount);
        uint256[][] memory auditorScores = new uint256[][](reviewerCount);

        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewers_[i];
            reviewerList[i] = reviewer;
            proposalScores[i] = reviewSubmissions[requestId][reviewer].proposalScore;
        }

        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewerList[i];
            address[] storage incomingAuditors = _incomingAuditors[requestId][reviewer];
            incomingScoresByTarget[i] = new uint256[](incomingAuditors.length);
            for (uint256 j = 0; j < incomingAuditors.length; j++) {
                incomingScoresByTarget[i][j] = auditScores[requestId][incomingAuditors[j]][reviewer];
            }

            address[] storage targets = _auditTargetsByAuditor[requestId][reviewer];
            auditorTargetIndexes[i] = new uint256[](targets.length);
            auditorScores[i] = new uint256[](targets.length);
            for (uint256 j = 0; j < targets.length; j++) {
                auditorTargetIndexes[i][j] = _reviewerIndex(reviewerList, targets[j]);
                auditorScores[i][j] = auditScores[requestId][reviewer][targets[j]];
            }
        }

        IConsensusScoringLike.Output memory output = consensusScoring.compute(
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
                proposalScores: proposalScores,
                incomingScoresByTarget: incomingScoresByTarget,
                auditorTargetIndexes: auditorTargetIndexes,
                auditorScores: auditorScores
            })
        );

        request_.finalProposalScore = output.finalScore;
        request_.confidence = output.confidence;
        request_.auditCoverage = output.coverage;
        request_.scoreDispersion = output.scoreDispersion;
        request_.finalReliability = output.confidence;
        request_.lowConfidence = output.lowConfidence;
        request_.status = RequestStatus.Finalized;

        uint256 rewardPool = request_.rewardPool;
        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewerList[i];
            bool protocolFault = reviewSubmissions[requestId][reviewer].protocolFault || auditSubmissions[requestId][reviewer].protocolFault;
            ISettlementLike.ReviewerOutput memory settlementOutput = settlement.reviewerSettlement(
                ISettlementLike.ReviewerInput({
                    rewardPool: rewardPool,
                    totalContribution: output.totalContribution,
                    weight: output.weights[i],
                    proposalScore: proposalScores[i],
                    finalScore: output.finalScore,
                    contribution: output.contributions[i],
                    contributionThreshold: request_.config.contributionThreshold,
                    covered: output.covered[i],
                    protocolFault: protocolFault
                })
            );

            reviewerResults[requestId][reviewer] = ReviewerResult({
                reportQualityMedian: output.medians[i],
                normalizedReportQuality: output.normalizedQuality[i],
                auditReliabilityRaw: output.rawReliability[i],
                normalizedAuditReliability: output.normalizedReliability[i],
                finalContribution: output.contributions[i],
                scoreAgreement: settlementOutput.scoreAgreement,
                reward: settlementOutput.reward,
                minorityOpinion: output.minority[i],
                covered: output.covered[i],
                protocolFault: protocolFault
            });

            if (settlementOutput.semanticFault) {
                bool suspended =
                    reviewerRegistry.recordSemanticFault(reviewer, request_.config.semanticStrikeThreshold, request_.config.cooldownBlocks);
                if (suspended) {
                    _slashStakeBps(reviewer, request_.config.semanticSlashBps, "semantic-strike-threshold", false);
                }
            }

            reviewerRegistry.markCompleted(reviewer);

            reputationLedger.record(
                reviewer,
                reviewerRegistry.agentId(reviewer),
                output.normalizedQuality[i],
                output.normalizedReliability[i],
                output.contributions[i],
                output.confidence,
                protocolFault,
                settlementOutput.scoreAgreement,
                output.minority[i],
                reviewSubmissions[requestId][reviewer].reportURI,
                reviewSubmissions[requestId][reviewer].reportHash
            );

            if (settlementOutput.reward > 0) {
                stakeVault.payReward(requestId, reviewer, settlementOutput.reward);
            }
        }

        stakeVault.closeRequestToTreasury(requestId);
        request_.rewardPool = 0;
        request_.protocolFee = 0;

        emit RequestFinalized(requestId, output.finalScore, output.confidence, request_.lowConfidence);
        emit StatusChanged(requestId, RequestStatus.Finalized);
    }

    function _cancelAndRefund(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);
        request_.rewardPool = 0;
        request_.protocolFee = 0;
        request_.status = RequestStatus.Cancelled;
        stakeVault.refundRequest(requestId, request_.requester);

        emit StatusChanged(requestId, RequestStatus.Cancelled);
    }

    function _fail(uint256 requestId, RequestStatus status) internal {
        if (status != RequestStatus.Failed && status != RequestStatus.Unresolved) revert BadConfig();

        Request storage request_ = _requireRequest(requestId);
        request_.rewardPool = 0;
        request_.protocolFee = 0;
        request_.status = status;
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
        request_.phaseStartedAt = block.timestamp;
        request_.phaseStartedBlock = block.number;

        priorityQueue.pushRequest(request_.activePriority, requestId);

        emit RequestRequeued(requestId, request_.retryCount, request_.activePriority);
        emit StatusChanged(requestId, RequestStatus.Queued);
    }

    function _clearRequestProgress(uint256 requestId) internal {
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

    function _slashMissingReviewReveals(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);
        address[] storage committers = _reviewCommitters[requestId];
        for (uint256 i = 0; i < committers.length; i++) {
            address reviewer = committers[i];
            ReviewSubmission storage submission = reviewSubmissions[requestId][reviewer];
            if (submission.committed && !submission.revealed) {
                _markProtocolFault(requestId, reviewer, "missed-review-reveal", request_.config.missedRevealSlashBps);
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
                _markProtocolFault(requestId, auditor, "missed-audit-reveal", request_.config.missedRevealSlashBps);
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
            _slashStakeBps(reviewerAddress, slashBps, reason, true);
            requestFaultCount[requestId]++;
            emit ProtocolFault(requestId, reviewerAddress, reason);
        }
    }

    function _slashStakeBps(address reviewerAddress, uint256 slashBps, string memory reason, bool protocolFault) internal {
        uint256 amount = reviewerRegistry.slashStakeBps(reviewerAddress, slashBps, reason, protocolFault);
        if (amount == 0) return;
        emit ReviewerSlashed(reviewerAddress, amount, reason);
    }

    function _advance(uint256 requestId, RequestStatus status) internal {
        Request storage request_ = _requireRequest(requestId);
        request_.status = status;
        request_.phaseStartedAt = block.timestamp;
        request_.phaseStartedBlock = block.number;
        emit StatusChanged(requestId, status);
    }

    function _requireRequest(uint256 requestId) internal view returns (Request storage request_) {
        request_ = requests[requestId];
        if (request_.status == RequestStatus.None) revert UnknownRequest();
    }

    function _requireStatus(uint256 requestId, RequestStatus status) internal view returns (Request storage request_) {
        request_ = _requireRequest(requestId);
        if (request_.status != status) revert BadStatus(status, request_.status);
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

    function _validateConfig(RequestConfig memory config) internal pure {
        if (
            config.reviewElectionDifficulty > SCALE
                || config.auditElectionDifficulty > SCALE
                || config.reviewElectionDifficulty == 0
                || config.auditElectionDifficulty == 0
                || config.reviewCommitQuorum == 0
                || config.reviewRevealQuorum == 0
                || config.auditCommitQuorum == 0
                || config.auditRevealQuorum == 0
                || config.auditTargetLimit == 0
                || config.minIncomingAudit == 0
                || config.auditCoverageQuorum > SCALE
                || config.contributionThreshold > SCALE
                || config.reviewEpochSize == 0
                || config.auditEpochSize == 0
                || config.minorityThreshold > SCALE
                || config.semanticStrikeThreshold == 0
                || config.protocolFaultSlashBps > BPS
                || config.missedRevealSlashBps > BPS
                || config.semanticSlashBps > BPS
        ) {
            revert BadConfig();
        }
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

    function _sortitionScore(
        bytes32 phase,
        uint256 requestId,
        address participant,
        address subject,
        bytes32 randomness
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(phase, requestId, participant, subject, randomness))) % SCALE;
    }

    function _passesSortition(
        bytes32 phase,
        uint256 requestId,
        address participant,
        address subject,
        bytes32 randomness,
        uint256 difficulty
    ) internal pure returns (bool) {
        return _sortitionScore(phase, requestId, participant, subject, randomness) < difficulty;
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
