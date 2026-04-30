// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

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

interface IENSVerifierLike {
    function verify(bytes32 node, address reviewerWallet, address agentWallet) external view returns (bool);
}

interface IERC8004AdapterLike {
    function isAuthorized(uint256 agentId, address reviewer) external view returns (bool);
    function agentWallet(uint256 agentId) external view returns (address);
    function recordDAIOSignals(
        uint256 agentId,
        uint256 reportQuality,
        uint256 auditReliability,
        uint256 finalContribution,
        uint256 finalReliability,
        uint256 protocolCompliance,
        uint256 scoreAgreement,
        bool minorityOpinion,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

contract DAIOCore {
    uint256 public constant SCALE = 10_000;
    uint256 public constant HALF_SCALE = 5_000;
    uint256 public constant BPS = 10_000;

    bytes32 public constant REVIEW_SORTITION = keccak256("DAIO_REVIEW_SORTITION");
    bytes32 public constant AUDIT_SORTITION = keccak256("DAIO_AUDIT_SORTITION");

    IERC20Like public immutable usdaio;
    ICommitReveal public immutable commitReveal;
    IPriorityQueue public immutable priorityQueue;
    IDAIOVRFCoordinator public immutable vrfCoordinator;
    address public owner;
    address public treasury;
    address public paymentRouter;
    IENSVerifierLike public ensVerifier;
    IERC8004AdapterLike public erc8004Adapter;

    uint256 public baseRequestFee = 100 ether;
    uint256 public minStake = 1_000 ether;
    uint256 public protocolFeeBps = 1_000;
    uint256 public treasuryBalance;
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

    struct Reviewer {
        bool registered;
        bool active;
        bool suspended;
        bytes32 ensNode;
        string ensName;
        uint256 agentId;
        uint256 stake;
        uint256 domainMask;
        uint256[2] vrfPublicKey;
        uint256 completedRequests;
        uint256 semanticStrikes;
        uint256 protocolFaults;
        uint256 cooldownUntilBlock;
    }

    struct Reputation {
        uint256 samples;
        uint256 reportQuality;
        uint256 auditReliability;
        uint256 finalContribution;
        uint256 protocolCompliance;
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
        uint256 reward;
        bool minorityOpinion;
        bool covered;
        bool protocolFault;
    }

    mapping(address reviewer => Reviewer data) public reviewers;
    mapping(address reviewer => Reputation data) public reputations;
    mapping(uint256 requestId => Request data) public requests;
    mapping(uint256 tier => RequestConfig config) public tierConfigs;
    mapping(uint256 requestId => mapping(address reviewer => ReviewSubmission submission)) public reviewSubmissions;
    mapping(uint256 requestId => mapping(address auditor => AuditSubmission submission)) public auditSubmissions;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => uint16 score))) public auditScores;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => bool exists))) public hasAuditScore;
    mapping(uint256 requestId => mapping(address auditor => mapping(address target => bool canonical))) public canonicalAuditTargets;
    mapping(uint256 requestId => mapping(address reviewer => ReviewerResult result)) public reviewerResults;

    mapping(uint256 requestId => address[] reviewers) private _reviewCommitters;
    mapping(uint256 requestId => address[] reviewers) private _revealedReviewers;
    mapping(uint256 requestId => mapping(address target => address[] auditors)) private _incomingAuditors;
    mapping(uint256 requestId => mapping(address auditor => address[] targets)) private _auditTargetsByAuditor;

    event AuditCommitted(uint256 indexed requestId, address indexed auditor, bytes32 commitHash);
    event AuditRevealed(uint256 indexed requestId, address indexed auditor, uint256 targetCount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RequestCreated(uint256 indexed requestId, address indexed requester, ServiceTier tier, uint256 feePaid, uint256 priorityFee);
    event RequestFinalized(uint256 indexed requestId, uint256 finalProposalScore, uint256 confidence, bool lowConfidence);
    event RequestRequeued(uint256 indexed requestId, uint256 retryCount, uint256 priority);
    event RequestStarted(uint256 indexed requestId);
    event ReputationUpdated(
        address indexed reviewer,
        uint256 indexed agentId,
        uint256 reportQuality,
        uint256 auditReliability,
        uint256 finalContribution,
        uint256 protocolCompliance
    );
    event ReviewCommitted(uint256 indexed requestId, address indexed reviewer, bytes32 commitHash);
    event ReviewRevealed(uint256 indexed requestId, address indexed reviewer, uint16 proposalScore, bytes32 reportHash, string reportURI);
    event ProtocolFault(uint256 indexed requestId, address indexed reviewer, string reason);
    event ReviewerRegistered(address indexed reviewer, uint256 indexed agentId, bytes32 indexed ensNode, uint256 stake, uint256 domainMask);
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
        address usdaioToken,
        address treasury_,
        address commitReveal_,
        address priorityQueue_,
        address vrfCoordinator_
    ) {
        if (
            usdaioToken == address(0) || treasury_ == address(0) || commitReveal_ == address(0)
                || priorityQueue_ == address(0) || vrfCoordinator_ == address(0)
        ) {
            revert InvalidAddress();
        }

        usdaio = IERC20Like(usdaioToken);
        commitReveal = ICommitReveal(commitReveal_);
        priorityQueue = IPriorityQueue(priorityQueue_);
        vrfCoordinator = IDAIOVRFCoordinator(vrfCoordinator_);
        owner = msg.sender;
        treasury = treasury_;

        tierConfigs[uint256(ServiceTier.Fast)] = RequestConfig({
            reviewElectionDifficulty: uint16(SCALE),
            auditElectionDifficulty: uint16(SCALE),
            reviewCommitQuorum: 3,
            reviewRevealQuorum: 3,
            auditCommitQuorum: 3,
            auditRevealQuorum: 3,
            auditTargetLimit: 2,
            minIncomingAudit: 1,
            auditCoverageQuorum: 7_000,
            contributionThreshold: 1_000,
            reviewEpochSize: 25,
            auditEpochSize: 25,
            finalityFactor: 2,
            maxRetries: 0,
            minorityThreshold: 1_500,
            semanticStrikeThreshold: 3,
            protocolFaultSlashBps: 500,
            missedRevealSlashBps: 100,
            semanticSlashBps: 200,
            cooldownBlocks: 100,
            reviewCommitTimeout: 30 minutes,
            reviewRevealTimeout: 30 minutes,
            auditCommitTimeout: 30 minutes,
            auditRevealTimeout: 30 minutes
        });

        tierConfigs[uint256(ServiceTier.Standard)] = RequestConfig({
            reviewElectionDifficulty: uint16(SCALE),
            auditElectionDifficulty: uint16(SCALE),
            reviewCommitQuorum: 5,
            reviewRevealQuorum: 4,
            auditCommitQuorum: 4,
            auditRevealQuorum: 4,
            auditTargetLimit: 3,
            minIncomingAudit: 2,
            auditCoverageQuorum: 8_000,
            contributionThreshold: 1_500,
            reviewEpochSize: 50,
            auditEpochSize: 50,
            finalityFactor: 3,
            maxRetries: 1,
            minorityThreshold: 1_500,
            semanticStrikeThreshold: 3,
            protocolFaultSlashBps: 500,
            missedRevealSlashBps: 100,
            semanticSlashBps: 200,
            cooldownBlocks: 300,
            reviewCommitTimeout: 2 hours,
            reviewRevealTimeout: 2 hours,
            auditCommitTimeout: 2 hours,
            auditRevealTimeout: 2 hours
        });

        tierConfigs[uint256(ServiceTier.Critical)] = RequestConfig({
            reviewElectionDifficulty: uint16(SCALE),
            auditElectionDifficulty: uint16(SCALE),
            reviewCommitQuorum: 7,
            reviewRevealQuorum: 6,
            auditCommitQuorum: 6,
            auditRevealQuorum: 6,
            auditTargetLimit: 4,
            minIncomingAudit: 3,
            auditCoverageQuorum: 9_000,
            contributionThreshold: 2_000,
            reviewEpochSize: 100,
            auditEpochSize: 100,
            finalityFactor: 5,
            maxRetries: 2,
            minorityThreshold: 1_500,
            semanticStrikeThreshold: 3,
            protocolFaultSlashBps: 700,
            missedRevealSlashBps: 200,
            semanticSlashBps: 300,
            cooldownBlocks: 900,
            reviewCommitTimeout: 6 hours,
            reviewRevealTimeout: 6 hours,
            auditCommitTimeout: 6 hours,
            auditRevealTimeout: 6 hours
        });

        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        treasury = newTreasury;
    }

    function setPaymentRouter(address newPaymentRouter) external onlyOwner {
        if (newPaymentRouter == address(0)) revert InvalidAddress();
        paymentRouter = newPaymentRouter;
    }

    function setIdentityModules(address ensVerifier_, address erc8004Adapter_) external onlyOwner {
        ensVerifier = IENSVerifierLike(ensVerifier_);
        erc8004Adapter = IERC8004AdapterLike(erc8004Adapter_);
    }

    function setEconomics(uint256 newBaseRequestFee, uint256 newMinStake, uint256 newProtocolFeeBps) external onlyOwner {
        if (newProtocolFeeBps > BPS) revert InvalidAmount();

        baseRequestFee = newBaseRequestFee;
        minStake = newMinStake;
        protocolFeeBps = newProtocolFeeBps;
    }

    function setTierConfig(ServiceTier tier, RequestConfig calldata config) external onlyOwner {
        _validateConfig(config);
        tierConfigs[uint256(tier)] = config;
    }

    function registerReviewer(
        string calldata ensName,
        bytes32 ensNode,
        uint256 agentId,
        uint256 domainMask,
        uint256[2] calldata vrfPublicKey,
        uint256 stakeAmount
    ) external nonReentrant {
        if (bytes(ensName).length == 0 || ensNode == bytes32(0) || agentId == 0 || domainMask == 0) revert InvalidAmount();
        if (vrfPublicKey[0] == 0 || vrfPublicKey[1] == 0) revert InvalidAmount();
        if (stakeAmount == 0) revert InvalidAmount();

        address agentWallet;
        if (address(erc8004Adapter) != address(0)) {
            if (!erc8004Adapter.isAuthorized(agentId, msg.sender)) revert IneligibleReviewer();
            agentWallet = erc8004Adapter.agentWallet(agentId);
        }
        if (address(ensVerifier) != address(0) && !ensVerifier.verify(ensNode, msg.sender, agentWallet)) {
            revert IneligibleReviewer();
        }

        Reviewer storage reviewer = reviewers[msg.sender];
        uint256 newStake = reviewer.stake + stakeAmount;
        if (newStake < minStake) revert InvalidAmount();

        _safeTransferFrom(msg.sender, address(this), stakeAmount);

        reviewer.registered = true;
        reviewer.active = true;
        reviewer.ensNode = ensNode;
        reviewer.ensName = ensName;
        reviewer.agentId = agentId;
        reviewer.domainMask = domainMask;
        reviewer.vrfPublicKey[0] = vrfPublicKey[0];
        reviewer.vrfPublicKey[1] = vrfPublicKey[1];
        reviewer.stake = newStake;

        emit ReviewerRegistered(msg.sender, agentId, ensNode, newStake, domainMask);
    }

    function setReviewerStatus(address reviewer, bool active, bool suspended) external onlyOwner {
        if (!reviewers[reviewer].registered) revert IneligibleReviewer();
        reviewers[reviewer].active = active;
        reviewers[reviewer].suspended = suspended;
    }

    function withdrawStake(uint256 amount) external nonReentrant {
        Reviewer storage reviewer = reviewers[msg.sender];
        if (!reviewer.registered || amount == 0 || reviewer.stake < amount) revert InvalidAmount();

        uint256 remaining = reviewer.stake - amount;
        if (reviewer.active && remaining < minStake) revert InvalidAmount();

        reviewer.stake = remaining;
        _safeTransfer(msg.sender, amount);
    }

    function slashReviewer(address reviewerAddress, uint256 amount, string calldata reason) external onlyOwner {
        _slash(reviewerAddress, amount, reason);
    }

    function createRequest(
        string calldata proposalURI,
        bytes32 proposalHash,
        bytes32 rubricHash,
        uint256 domainMask,
        ServiceTier tier,
        uint256 priorityFee
    ) external nonReentrant returns (uint256 requestId) {
        requestId = _createRequest(msg.sender, proposalURI, proposalHash, rubricHash, domainMask, tier, priorityFee);
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

        _safeTransferFrom(msg.sender, address(this), feePaid);

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

    function submitReviewCommit(uint256 requestId, uint256[4] calldata vrfProof) external {
        _submitReviewCommit(msg.sender, requestId, vrfProof);
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

        bytes32 randomness = _vrfRandomness(requestId, REVIEW_SORTITION, request_.committeeEpoch, reviewer, address(0), vrfProof);
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

    function revealReview(
        uint256 requestId,
        uint16 proposalScore,
        bytes32 reportHash,
        string calldata reportURI,
        uint256 seed
    ) external {
        Request storage request_ = _requireStatus(requestId, RequestStatus.ReviewReveal);
        if (_isTimedOut(request_)) revert PhaseTimedOut();

        ReviewSubmission storage submission = reviewSubmissions[requestId][msg.sender];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        if (proposalScore > SCALE || reportHash == bytes32(0) || bytes(reportURI).length == 0) {
            _markProtocolFault(requestId, msg.sender, "invalid-review-reveal", request_.config.protocolFaultSlashBps);
            return;
        }

        bytes32 resultHash = hashReviewReveal(requestId, msg.sender, proposalScore, reportHash, reportURI);
        try commitReveal.reveal_hashed(resultHash, msg.sender, seed, reviewCommitRound(requestId)) returns (bool ok) {
            if (!ok) {
                _markProtocolFault(requestId, msg.sender, "review-reveal-mismatch", request_.config.protocolFaultSlashBps);
                return;
            }
        } catch {
            _markProtocolFault(requestId, msg.sender, "review-reveal-mismatch", request_.config.protocolFaultSlashBps);
            return;
        }

        submission.revealed = true;
        submission.proposalScore = proposalScore;
        submission.reportHash = reportHash;
        submission.reportURI = reportURI;

        _revealedReviewers[requestId].push(msg.sender);
        request_.reviewRevealCount++;

        emit ReviewRevealed(requestId, msg.sender, proposalScore, reportHash, reportURI);

        if (request_.reviewRevealCount >= request_.config.reviewRevealQuorum) {
            _advance(requestId, RequestStatus.AuditCommit);
        }
    }

    function submitAuditCommit(uint256 requestId) external {
        _submitAuditCommit(msg.sender, requestId);
    }

    function submitAuditCommitFor(address auditor, uint256 requestId) external {
        if (msg.sender != address(commitReveal)) revert InvalidAddress();
        _submitAuditCommit(auditor, requestId);
    }

    function _submitAuditCommit(address auditor, uint256 requestId) internal {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditCommit);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (!reviewSubmissions[requestId][auditor].revealed) revert IneligibleReviewer();

        bytes32 commitHash = commitReveal.saved_commits(auditCommitRound(requestId), auditor);
        if (commitHash == bytes32(0)) revert BadCommitment();

        AuditSubmission storage submission = auditSubmissions[requestId][auditor];
        if (submission.committed) revert AlreadySubmitted();

        submission.commitHash = commitHash;
        submission.committed = true;
        request_.auditCommitCount++;

        emit AuditCommitted(requestId, auditor, commitHash);

        if (request_.auditCommitCount >= request_.config.auditCommitQuorum) {
            _advance(requestId, RequestStatus.AuditReveal);
        }
    }

    function revealAudit(
        uint256 requestId,
        address[] calldata targets,
        uint16[] calldata scores,
        uint256 seed,
        uint256[4] calldata vrfProof
    ) external {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditReveal);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (targets.length == 0 || targets.length != scores.length || targets.length > request_.config.auditTargetLimit) revert InvalidAuditTarget();

        AuditSubmission storage submission = auditSubmissions[requestId][msg.sender];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        bytes32 resultHash = hashAuditReveal(requestId, msg.sender, targets, scores);
        try commitReveal.reveal_hashed(resultHash, msg.sender, seed, auditCommitRound(requestId)) returns (bool ok) {
            if (!ok) {
                _markProtocolFault(requestId, msg.sender, "audit-reveal-mismatch", request_.config.protocolFaultSlashBps);
                return;
            }
        } catch {
            _markProtocolFault(requestId, msg.sender, "audit-reveal-mismatch", request_.config.protocolFaultSlashBps);
            return;
        }

        bytes32 randomness = _vrfRandomness(requestId, AUDIT_SORTITION, request_.auditEpoch, msg.sender, address(0), vrfProof);
        address[] memory canonicalTargets = _canonicalAuditTargets(requestId, msg.sender, randomness, request_.config.auditElectionDifficulty, request_.config.auditTargetLimit);
        if (targets.length != canonicalTargets.length) {
            _markProtocolFault(requestId, msg.sender, "non-canonical-audit-targets", request_.config.protocolFaultSlashBps);
            return;
        }

        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            if (scores[i] > SCALE) {
                _markProtocolFault(requestId, msg.sender, "audit-score-out-of-range", request_.config.protocolFaultSlashBps);
                return;
            }
            if (target == msg.sender || !reviewSubmissions[requestId][target].revealed || !_contains(canonicalTargets, target)) {
                _markProtocolFault(requestId, msg.sender, "invalid-audit-target", request_.config.protocolFaultSlashBps);
                return;
            }

            for (uint256 j = 0; j < i; j++) {
                if (targets[j] == target) {
                    _markProtocolFault(requestId, msg.sender, "duplicate-audit-target", request_.config.protocolFaultSlashBps);
                    return;
                }
            }

            canonicalAuditTargets[requestId][msg.sender][target] = true;
            auditScores[requestId][msg.sender][target] = scores[i];
            hasAuditScore[requestId][msg.sender][target] = true;
            _incomingAuditors[requestId][target].push(msg.sender);
            _auditTargetsByAuditor[requestId][msg.sender].push(target);
        }

        submission.revealed = true;
        request_.auditRevealCount++;

        emit AuditRevealed(requestId, msg.sender, targets.length);
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
        if (amount == 0 || amount > treasuryBalance) revert InvalidAmount();

        treasuryBalance -= amount;
        _safeTransfer(treasury, amount);
        emit TreasuryWithdrawn(treasury, amount);
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

    function reviewCommitRound(uint256 requestId) public view returns (uint256) {
        return (requestId * 1_000_000) + (requests[requestId].committeeEpoch * 2);
    }

    function auditCommitRound(uint256 requestId) public view returns (uint256) {
        return (requestId * 1_000_000) + (requests[requestId].auditEpoch * 2) + 1;
    }

    function isReviewSelected(uint256 requestId, address reviewer, uint256[4] calldata vrfProof) external view returns (bool) {
        Request storage request_ = _requireRequest(requestId);
        bytes32 randomness = _vrfRandomness(requestId, REVIEW_SORTITION, request_.committeeEpoch, reviewer, address(0), vrfProof);
        return _passesSortition(REVIEW_SORTITION, requestId, reviewer, address(0), randomness, request_.config.reviewElectionDifficulty);
    }

    function isAuditTargetSelected(
        uint256 requestId,
        address auditor,
        address target,
        uint256[4] calldata vrfProof
    ) external view returns (bool) {
        Request storage request_ = _requireRequest(requestId);
        bytes32 randomness = _vrfRandomness(requestId, AUDIT_SORTITION, request_.auditEpoch, auditor, address(0), vrfProof);
        address[] memory canonicalTargets =
            _canonicalAuditTargets(requestId, auditor, randomness, request_.config.auditElectionDifficulty, request_.config.auditTargetLimit);
        return _contains(canonicalTargets, target);
    }

    function reviewerEligible(address reviewer, uint256 domainMask) external view returns (bool) {
        return _eligibleForRequest(reviewer, domainMask);
    }

    function queueLength() external view returns (uint256) {
        return priorityQueue.currentSize();
    }

    function queuedRequestAt(uint256 index) external view returns (uint256) {
        if (index != 0 || priorityQueue.currentSize() == 0) revert InvalidAmount();
        (, bytes32 encodedRequestId) = priorityQueue.top();
        return uint256(encodedRequestId);
    }

    function getReviewCommitters(uint256 requestId) external view returns (address[] memory) {
        return _reviewCommitters[requestId];
    }

    function getRevealedReviewers(uint256 requestId) external view returns (address[] memory) {
        return _revealedReviewers[requestId];
    }

    function getIncomingAuditors(uint256 requestId, address target) external view returns (address[] memory) {
        return _incomingAuditors[requestId][target];
    }

    function getAuditTargets(uint256 requestId, address auditor) external view returns (address[] memory) {
        return _auditTargetsByAuditor[requestId][auditor];
    }

    function phaseDeadline(uint256 requestId) external view returns (uint256) {
        Request storage request_ = _requireRequest(requestId);
        return request_.phaseStartedAt + _timeoutFor(request_);
    }

    function _finalize(uint256 requestId) internal {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditReveal);
        address[] storage reviewers_ = _revealedReviewers[requestId];
        uint256 reviewerCount = reviewers_.length;
        if (reviewerCount == 0) revert IneligibleReviewer();

        address[] memory reviewerList = new address[](reviewerCount);
        uint256[] memory medians = new uint256[](reviewerCount);
        uint256[] memory incomingCounts = new uint256[](reviewerCount);
        uint256[] memory rawReliability = new uint256[](reviewerCount);
        uint256[] memory normalizedQuality = new uint256[](reviewerCount);
        uint256[] memory normalizedReliability = new uint256[](reviewerCount);
        uint256[] memory contributions = new uint256[](reviewerCount);
        uint256[] memory proposalScores = new uint256[](reviewerCount);
        uint256[] memory weights = new uint256[](reviewerCount);

        uint256 maxMedian;
        uint256 coveredReports;

        uint256 distributedRewards;
        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewers_[i];
            reviewerList[i] = reviewer;
            proposalScores[i] = reviewSubmissions[requestId][reviewer].proposalScore;

            (uint256 medianScore, uint256 incomingCount) = _medianAuditScore(requestId, reviewer);
            medians[i] = medianScore;
            incomingCounts[i] = incomingCount;
            if (medianScore > maxMedian) maxMedian = medianScore;
            if (incomingCount >= request_.config.minIncomingAudit) coveredReports++;
        }

        if (maxMedian == 0) request_.lowConfidence = true;

        uint256 maxReliability;
        for (uint256 i = 0; i < reviewerCount; i++) {
            address auditor = reviewerList[i];
            uint256 reliability = _rawAuditReliability(requestId, auditor, reviewerList, medians);
            rawReliability[i] = reliability;
            if (reliability > maxReliability) maxReliability = reliability;
        }

        if (maxReliability == 0) request_.lowConfidence = true;

        uint256 totalContribution;
        for (uint256 i = 0; i < reviewerCount; i++) {
            if (maxMedian > 0) normalizedQuality[i] = (medians[i] * SCALE) / maxMedian;
            if (maxReliability > 0) normalizedReliability[i] = (rawReliability[i] * SCALE) / maxReliability;

            contributions[i] = _min(normalizedQuality[i], normalizedReliability[i]);
            if (contributions[i] >= request_.config.contributionThreshold) {
                weights[i] = contributions[i];
                totalContribution += contributions[i];
            }
        }

        uint256 finalScore;
        if (totalContribution == 0) {
            finalScore = _median(proposalScores);
            request_.lowConfidence = true;
        } else {
            finalScore = _weightedMedian(_copy(proposalScores), _copy(weights));
        }

        uint256 coverage = (coveredReports * SCALE) / reviewerCount;
        uint256 scoreDispersion = _averageDeviation(proposalScores, finalScore);
        uint256 confidence = _confidence(request_, coverage, proposalScores, finalScore);
        if (coverage < request_.config.auditCoverageQuorum) request_.lowConfidence = true;
        if (request_.lowConfidence) confidence = (confidence * 8_000) / SCALE;

        request_.finalProposalScore = finalScore;
        request_.confidence = confidence;
        request_.auditCoverage = coverage;
        request_.scoreDispersion = scoreDispersion;
        request_.finalReliability = confidence;
        request_.status = RequestStatus.Finalized;

        uint256 rewardPool = request_.rewardPool;
        request_.rewardPool = 0;
        treasuryBalance += request_.protocolFee;
        request_.protocolFee = 0;

        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewerList[i];
            bool protocolFault = reviewSubmissions[requestId][reviewer].protocolFault || auditSubmissions[requestId][reviewer].protocolFault;
            bool covered = incomingCounts[i] >= request_.config.minIncomingAudit;
            bool minority = _absDiff(proposalScores[i], finalScore) >= request_.config.minorityThreshold
                && normalizedQuality[i] >= request_.config.contributionThreshold
                && contributions[i] >= request_.config.contributionThreshold;

            uint256 reward;
            if (!protocolFault && totalContribution > 0 && weights[i] > 0) {
                reward = (rewardPool * weights[i]) / totalContribution;
                distributedRewards += reward;
            }

            reviewerResults[requestId][reviewer] = ReviewerResult({
                reportQualityMedian: medians[i],
                normalizedReportQuality: normalizedQuality[i],
                auditReliabilityRaw: rawReliability[i],
                normalizedAuditReliability: normalizedReliability[i],
                finalContribution: contributions[i],
                reward: reward,
                minorityOpinion: minority,
                covered: covered,
                protocolFault: protocolFault
            });

            _updateReputation(reviewer, normalizedQuality[i], normalizedReliability[i], contributions[i], protocolFault);

            if (covered && contributions[i] < request_.config.contributionThreshold) {
                reviewers[reviewer].semanticStrikes++;
                if (reviewers[reviewer].semanticStrikes >= request_.config.semanticStrikeThreshold) {
                    reviewers[reviewer].cooldownUntilBlock = block.number + request_.config.cooldownBlocks;
                    _slashStakeBps(reviewer, request_.config.semanticSlashBps, "semantic-strike-threshold", false);
                }
            }

            reviewers[reviewer].completedRequests++;

            if (address(erc8004Adapter) != address(0) && reviewers[reviewer].agentId != 0) {
                uint256 scoreAgreement = SCALE - _min(_absDiff(proposalScores[i], finalScore), SCALE);
                try erc8004Adapter.recordDAIOSignals(
                    reviewers[reviewer].agentId,
                    normalizedQuality[i],
                    normalizedReliability[i],
                    contributions[i],
                    confidence,
                    protocolFault ? 0 : SCALE,
                    scoreAgreement,
                    minority,
                    "",
                    reviewSubmissions[requestId][reviewer].reportURI,
                    reviewSubmissions[requestId][reviewer].reportHash
                ) {} catch {}
            }

            if (reward > 0) {
                _safeTransfer(reviewer, reward);
            }
        }

        if (rewardPool > distributedRewards) {
            treasuryBalance += rewardPool - distributedRewards;
        }

        emit RequestFinalized(requestId, finalScore, confidence, request_.lowConfidence);
        emit StatusChanged(requestId, RequestStatus.Finalized);
    }

    function _medianAuditScore(uint256 requestId, address target) internal view returns (uint256 medianScore, uint256 incomingCount) {
        address[] storage auditors = _incomingAuditors[requestId][target];
        incomingCount = auditors.length;
        if (incomingCount == 0) return (0, 0);

        uint256[] memory scores = new uint256[](incomingCount);
        for (uint256 i = 0; i < incomingCount; i++) {
            scores[i] = auditScores[requestId][auditors[i]][target];
        }

        medianScore = _median(scores);
    }

    function _rawAuditReliability(
        uint256 requestId,
        address auditor,
        address[] memory reviewerList,
        uint256[] memory medians
    ) internal view returns (uint256 reliability) {
        address[] storage targets = _auditTargetsByAuditor[requestId][auditor];
        if (targets.length == 0) return 0;

        reliability = SCALE;
        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            uint256 targetIndex = _reviewerIndex(reviewerList, target);
            uint256 score = auditScores[requestId][auditor][target];
            uint256 deviation = _absDiff(score, medians[targetIndex]);
            uint256 transformed = _transformDeviation(deviation);
            if (transformed < reliability) reliability = transformed;
        }
    }

    function _confidence(
        Request storage request_,
        uint256 coverage,
        uint256[] memory proposalScores,
        uint256 finalScore
    ) internal view returns (uint256) {
        uint256 reviewConfidence = _capScale((request_.reviewRevealCount * SCALE) / request_.config.reviewCommitQuorum);
        uint256 auditConfidence = _capScale((request_.auditRevealCount * SCALE) / request_.config.auditCommitQuorum);

        uint256 totalDeviation;
        for (uint256 i = 0; i < proposalScores.length; i++) {
            totalDeviation += _absDiff(proposalScores[i], finalScore);
        }
        uint256 averageDeviation = totalDeviation / proposalScores.length;
        uint256 dispersionConfidence = averageDeviation >= SCALE ? 0 : SCALE - averageDeviation;

        return _min(_min(reviewConfidence, auditConfidence), _min(coverage, dispersionConfidence));
    }

    function _averageDeviation(uint256[] memory values, uint256 referenceValue) internal pure returns (uint256) {
        uint256 totalDeviation;
        for (uint256 i = 0; i < values.length; i++) {
            totalDeviation += _absDiff(values[i], referenceValue);
        }
        return values.length == 0 ? 0 : totalDeviation / values.length;
    }

    function _updateReputation(
        address reviewer,
        uint256 reportQuality,
        uint256 auditReliability,
        uint256 finalContribution,
        bool protocolFault
    ) internal {
        Reputation storage reputation = reputations[reviewer];
        uint256 compliance = protocolFault ? 0 : SCALE;

        if (reputation.samples == 0) {
            reputation.reportQuality = reportQuality;
            reputation.auditReliability = auditReliability;
            reputation.finalContribution = finalContribution;
            reputation.protocolCompliance = compliance;
        } else {
            reputation.reportQuality = _ema(reputation.reportQuality, reportQuality);
            reputation.auditReliability = _ema(reputation.auditReliability, auditReliability);
            reputation.finalContribution = _ema(reputation.finalContribution, finalContribution);
            reputation.protocolCompliance = _ema(reputation.protocolCompliance, compliance);
        }

        reputation.samples++;

        emit ReputationUpdated(reviewer, reviewers[reviewer].agentId, reportQuality, auditReliability, finalContribution, compliance);
    }

    function _cancelAndRefund(uint256 requestId) internal {
        Request storage request_ = _requireRequest(requestId);
        uint256 refund = request_.rewardPool + request_.protocolFee;
        request_.rewardPool = 0;
        request_.protocolFee = 0;
        request_.status = RequestStatus.Cancelled;

        if (refund > 0) _safeTransfer(request_.requester, refund);

        emit StatusChanged(requestId, RequestStatus.Cancelled);
    }

    function _fail(uint256 requestId, RequestStatus status) internal {
        if (status != RequestStatus.Failed && status != RequestStatus.Unresolved) revert BadConfig();

        Request storage request_ = _requireRequest(requestId);
        uint256 refund = request_.rewardPool + request_.protocolFee;
        request_.rewardPool = 0;
        request_.protocolFee = 0;
        request_.status = status;

        if (refund > 0) _safeTransfer(request_.requester, refund);

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
        request_.activePriority = request_.activePriority > 0 ? request_.activePriority - 1 : 0;
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
                delete canonicalAuditTargets[requestId][reviewer][target];
                delete _incomingAuditors[requestId][target];
            }
            delete _auditTargetsByAuditor[requestId][reviewer];
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

    function _markProtocolFault(uint256 requestId, address reviewerAddress, string memory reason, uint256 slashBps) internal {
        bool alreadyFaulted = reviewSubmissions[requestId][reviewerAddress].protocolFault
            || auditSubmissions[requestId][reviewerAddress].protocolFault;

        reviewSubmissions[requestId][reviewerAddress].protocolFault = true;
        auditSubmissions[requestId][reviewerAddress].protocolFault = true;

        if (!alreadyFaulted) {
            _slashStakeBps(reviewerAddress, slashBps, reason, true);
            emit ProtocolFault(requestId, reviewerAddress, reason);
        }
    }

    function _slashStakeBps(address reviewerAddress, uint256 slashBps, string memory reason, bool protocolFault) internal {
        Reviewer storage reviewer = reviewers[reviewerAddress];
        if (!reviewer.registered || slashBps == 0 || reviewer.stake == 0) return;

        uint256 amount = (reviewer.stake * slashBps) / BPS;
        if (amount == 0) return;
        if (amount > reviewer.stake) amount = reviewer.stake;

        reviewer.stake -= amount;
        if (protocolFault) reviewer.protocolFaults++;
        treasuryBalance += amount;

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
        Reviewer storage reviewer = reviewers[reviewerAddress];
        return reviewer.registered
            && reviewer.active
            && !reviewer.suspended
            && reviewer.stake >= minStake
            && reviewer.cooldownUntilBlock <= block.number
            && (reviewer.domainMask & domainMask) != 0;
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

    function _vrfRandomness(
        uint256 requestId,
        bytes32 phase,
        uint256 epoch,
        address reviewerAddress,
        address target,
        uint256[4] calldata vrfProof
    ) internal view returns (bytes32) {
        Reviewer storage reviewer = reviewers[reviewerAddress];
        if (reviewer.vrfPublicKey[0] == 0 || reviewer.vrfPublicKey[1] == 0) revert IneligibleReviewer();
        Request storage request_ = _requireRequest(requestId);
        return vrfCoordinator.randomness(
            reviewer.vrfPublicKey,
            vrfProof,
            address(this),
            requestId,
            phase,
            epoch,
            reviewerAddress,
            target,
            request_.phaseStartedBlock,
            request_.config.finalityFactor
        );
    }

    function _canonicalAuditTargets(
        uint256 requestId,
        address auditor,
        bytes32 randomness,
        uint256 difficulty,
        uint256 limit
    ) internal view returns (address[] memory selectedTargets) {
        address[] storage reviewers_ = _revealedReviewers[requestId];
        address[] memory candidates = new address[](reviewers_.length);
        uint256[] memory scores = new uint256[](reviewers_.length);
        uint256 candidateCount;

        for (uint256 i = 0; i < reviewers_.length; i++) {
            address target = reviewers_[i];
            if (target == auditor) continue;

            uint256 targetScore = _sortitionScore(AUDIT_SORTITION, requestId, auditor, target, randomness);
            if (targetScore < difficulty) {
                candidates[candidateCount] = target;
                scores[candidateCount] = targetScore;
                candidateCount++;
            }
        }

        _sortAddressPairs(candidates, scores, candidateCount);

        uint256 selectedCount = _min(candidateCount, limit);
        selectedTargets = new address[](selectedCount);
        for (uint256 i = 0; i < selectedCount; i++) {
            selectedTargets[i] = candidates[i];
        }
    }

    function _contains(address[] memory values, address target) internal pure returns (bool) {
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

    function _slash(address reviewerAddress, uint256 amount, string memory reason) internal {
        Reviewer storage reviewer = reviewers[reviewerAddress];
        if (!reviewer.registered || amount == 0 || reviewer.stake < amount) revert InvalidAmount();

        reviewer.stake -= amount;
        reviewer.protocolFaults++;
        treasuryBalance += amount;

        emit ReviewerSlashed(reviewerAddress, amount, reason);
    }

    function _transformDeviation(uint256 deviation) internal pure returns (uint256) {
        if (deviation >= HALF_SCALE) return 0;
        return (SCALE * (HALF_SCALE - deviation)) / (HALF_SCALE + deviation);
    }

    function _reviewerIndex(address[] memory reviewers_, address target) internal pure returns (uint256) {
        for (uint256 i = 0; i < reviewers_.length; i++) {
            if (reviewers_[i] == target) return i;
        }
        revert InvalidAuditTarget();
    }

    function _weightedMedian(uint256[] memory values, uint256[] memory weights) internal pure returns (uint256) {
        uint256 totalWeight;
        for (uint256 i = 0; i < values.length; i++) {
            totalWeight += weights[i];
        }
        if (totalWeight == 0) return _median(values);

        _sortPairs(values, weights);

        uint256 midpoint = (totalWeight + 1) / 2;
        uint256 cumulative;
        for (uint256 i = 0; i < values.length; i++) {
            cumulative += weights[i];
            if (cumulative >= midpoint) return values[i];
        }

        return values[values.length - 1];
    }

    function _median(uint256[] memory values) internal pure returns (uint256) {
        _sort(values);
        uint256 length = values.length;
        uint256 middle = length / 2;

        if (length % 2 == 1) return values[middle];
        return (values[middle - 1] + values[middle]) / 2;
    }

    function _sort(uint256[] memory values) internal pure {
        for (uint256 i = 1; i < values.length; i++) {
            uint256 key = values[i];
            uint256 j = i;
            while (j > 0 && values[j - 1] > key) {
                values[j] = values[j - 1];
                unchecked {
                    j--;
                }
            }
            values[j] = key;
        }
    }

    function _sortPairs(uint256[] memory values, uint256[] memory weights) internal pure {
        for (uint256 i = 1; i < values.length; i++) {
            uint256 keyValue = values[i];
            uint256 keyWeight = weights[i];
            uint256 j = i;
            while (j > 0 && values[j - 1] > keyValue) {
                values[j] = values[j - 1];
                weights[j] = weights[j - 1];
                unchecked {
                    j--;
                }
            }
            values[j] = keyValue;
            weights[j] = keyWeight;
        }
    }

    function _sortAddressPairs(address[] memory addresses_, uint256[] memory values, uint256 length) internal pure {
        for (uint256 i = 1; i < length; i++) {
            address keyAddress = addresses_[i];
            uint256 keyValue = values[i];
            uint256 j = i;
            while (j > 0 && values[j - 1] > keyValue) {
                addresses_[j] = addresses_[j - 1];
                values[j] = values[j - 1];
                unchecked {
                    j--;
                }
            }
            addresses_[j] = keyAddress;
            values[j] = keyValue;
        }
    }

    function _copy(uint256[] memory values) internal pure returns (uint256[] memory copied) {
        copied = new uint256[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            copied[i] = values[i];
        }
    }

    function _ema(uint256 previousValue, uint256 newValue) internal pure returns (uint256) {
        return ((previousValue * 9) + newValue) / 10;
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _capScale(uint256 value) internal pure returns (uint256) {
        return value > SCALE ? SCALE : value;
    }

    function _safeTransfer(address to, uint256 value) internal {
        bool ok = usdaio.transfer(to, value);
        if (!ok) revert InvalidAmount();
    }

    function _safeTransferFrom(address from, address to, uint256 value) internal {
        bool ok = usdaio.transferFrom(from, to, value);
        if (!ok) revert InvalidAmount();
    }
}
