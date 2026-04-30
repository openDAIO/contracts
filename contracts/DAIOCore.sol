// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Like {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract DAIOCore {
    uint256 public constant SCALE = 10_000;
    uint256 public constant HALF_SCALE = 5_000;
    uint256 public constant BPS = 10_000;

    bytes32 public constant REVIEW_SORTITION = keccak256("DAIO_REVIEW_SORTITION");
    bytes32 public constant AUDIT_SORTITION = keccak256("DAIO_AUDIT_SORTITION");

    IERC20Like public immutable usdaio;
    address public owner;
    address public treasury;

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
        Cancelled
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
        uint256 completedRequests;
        uint256 semanticStrikes;
        uint256 protocolFaults;
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
        uint256 reviewCommitCount;
        uint256 reviewRevealCount;
        uint256 auditCommitCount;
        uint256 auditRevealCount;
        uint256 finalProposalScore;
        uint256 confidence;
        uint256 auditCoverage;
        bool lowConfidence;
        RequestConfig config;
    }

    struct ReviewSubmission {
        bytes32 commitHash;
        bytes32 sortitionProof;
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
    mapping(uint256 requestId => mapping(address reviewer => ReviewerResult result)) public reviewerResults;

    uint256[] private _queue;
    mapping(uint256 requestId => address[] reviewers) private _reviewCommitters;
    mapping(uint256 requestId => address[] reviewers) private _revealedReviewers;
    mapping(uint256 requestId => mapping(address target => address[] auditors)) private _incomingAuditors;
    mapping(uint256 requestId => mapping(address auditor => address[] targets)) private _auditTargetsByAuditor;

    event AuditCommitted(uint256 indexed requestId, address indexed auditor, bytes32 commitHash);
    event AuditRevealed(uint256 indexed requestId, address indexed auditor, uint256 targetCount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RequestCreated(uint256 indexed requestId, address indexed requester, ServiceTier tier, uint256 feePaid, uint256 priorityFee);
    event RequestFinalized(uint256 indexed requestId, uint256 finalProposalScore, uint256 confidence, bool lowConfidence);
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

    constructor(address usdaioToken, address treasury_) {
        if (usdaioToken == address(0) || treasury_ == address(0)) revert InvalidAddress();

        usdaio = IERC20Like(usdaioToken);
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
        uint256 stakeAmount
    ) external nonReentrant {
        if (bytes(ensName).length == 0 || ensNode == bytes32(0) || agentId == 0 || domainMask == 0) revert InvalidAmount();
        if (stakeAmount == 0) revert InvalidAmount();

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
        request_.requester = msg.sender;
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
        request_.config = config;

        _queue.push(requestId);

        emit RequestCreated(requestId, msg.sender, tier, feePaid, priorityFee);
        emit StatusChanged(requestId, RequestStatus.Queued);
    }

    function startNextRequest() external returns (uint256 requestId) {
        if (_queue.length == 0) revert QueueEmpty();

        uint256 bestIndex;
        uint256 bestPriority;
        uint256 bestId = type(uint256).max;
        bool found;

        for (uint256 i = 0; i < _queue.length; i++) {
            uint256 candidateId = _queue[i];
            Request storage candidate = requests[candidateId];
            if (candidate.status != RequestStatus.Queued) continue;

            if (!found || candidate.priorityFee > bestPriority || (candidate.priorityFee == bestPriority && candidateId < bestId)) {
                found = true;
                bestIndex = i;
                bestPriority = candidate.priorityFee;
                bestId = candidateId;
            }
        }

        if (!found) revert QueueEmpty();

        requestId = bestId;
        _queue[bestIndex] = _queue[_queue.length - 1];
        _queue.pop();

        _advance(requestId, RequestStatus.ReviewCommit);
        emit RequestStarted(requestId);
    }

    function submitReviewCommit(uint256 requestId, bytes32 commitHash, bytes32 sortitionProof) external {
        Request storage request_ = _requireStatus(requestId, RequestStatus.ReviewCommit);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (commitHash == bytes32(0)) revert BadCommitment();
        if (!_eligibleForRequest(msg.sender, request_.domainMask)) revert IneligibleReviewer();
        if (!isReviewSelected(requestId, msg.sender, sortitionProof)) revert NotSelected();

        ReviewSubmission storage submission = reviewSubmissions[requestId][msg.sender];
        if (submission.committed) revert AlreadySubmitted();

        submission.commitHash = commitHash;
        submission.sortitionProof = sortitionProof;
        submission.committed = true;

        _reviewCommitters[requestId].push(msg.sender);
        request_.reviewCommitCount++;

        emit ReviewCommitted(requestId, msg.sender, commitHash);

        if (request_.reviewCommitCount >= request_.config.reviewCommitQuorum) {
            _advance(requestId, RequestStatus.ReviewReveal);
        }
    }

    function revealReview(
        uint256 requestId,
        uint16 proposalScore,
        bytes32 reportHash,
        string calldata reportURI,
        bytes32 salt
    ) external {
        Request storage request_ = _requireStatus(requestId, RequestStatus.ReviewReveal);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (proposalScore > SCALE || reportHash == bytes32(0) || bytes(reportURI).length == 0) revert InvalidScore();

        ReviewSubmission storage submission = reviewSubmissions[requestId][msg.sender];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        bytes32 expected = keccak256(abi.encode(requestId, msg.sender, proposalScore, reportHash, keccak256(bytes(reportURI)), salt));
        if (expected != submission.commitHash) revert BadCommitment();

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

    function submitAuditCommit(uint256 requestId, bytes32 commitHash) external {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditCommit);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (commitHash == bytes32(0)) revert BadCommitment();
        if (!reviewSubmissions[requestId][msg.sender].revealed) revert IneligibleReviewer();

        AuditSubmission storage submission = auditSubmissions[requestId][msg.sender];
        if (submission.committed) revert AlreadySubmitted();

        submission.commitHash = commitHash;
        submission.committed = true;
        request_.auditCommitCount++;

        emit AuditCommitted(requestId, msg.sender, commitHash);

        if (request_.auditCommitCount >= request_.config.auditCommitQuorum) {
            _advance(requestId, RequestStatus.AuditReveal);
        }
    }

    function revealAudit(
        uint256 requestId,
        address[] calldata targets,
        uint16[] calldata scores,
        bytes32 salt
    ) external {
        Request storage request_ = _requireStatus(requestId, RequestStatus.AuditReveal);
        if (_isTimedOut(request_)) revert PhaseTimedOut();
        if (targets.length == 0 || targets.length != scores.length || targets.length > request_.config.auditTargetLimit) {
            revert InvalidAuditTarget();
        }

        AuditSubmission storage submission = auditSubmissions[requestId][msg.sender];
        if (!submission.committed) revert IneligibleReviewer();
        if (submission.revealed) revert AlreadySubmitted();

        bytes32 expected = keccak256(abi.encode(requestId, msg.sender, targets, scores, salt));
        if (expected != submission.commitHash) revert BadCommitment();

        for (uint256 i = 0; i < targets.length; i++) {
            address target = targets[i];
            if (scores[i] > SCALE) revert InvalidScore();
            if (target == msg.sender || !reviewSubmissions[requestId][target].revealed) revert InvalidAuditTarget();
            if (!isAuditTargetSelected(requestId, msg.sender, target, salt)) revert NotSelected();

            for (uint256 j = 0; j < i; j++) {
                if (targets[j] == target) revert InvalidAuditTarget();
            }

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
            _cancelAndRefund(requestId);
            return;
        }

        if (request_.status == RequestStatus.ReviewReveal) {
            if (request_.reviewRevealCount == 0 || request_.tier == ServiceTier.Critical) {
                _cancelAndRefund(requestId);
            } else {
                request_.lowConfidence = true;
                _advance(requestId, RequestStatus.AuditCommit);
            }
            return;
        }

        if (request_.status == RequestStatus.AuditCommit) {
            if (request_.auditCommitCount == 0 && request_.tier == ServiceTier.Critical) {
                _cancelAndRefund(requestId);
            } else {
                request_.lowConfidence = true;
                _advance(requestId, RequestStatus.AuditReveal);
            }
            return;
        }

        if (request_.status == RequestStatus.AuditReveal) {
            request_.lowConfidence = true;
            _finalize(requestId);
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
        string memory reportURI,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(requestId, reviewer, proposalScore, reportHash, keccak256(bytes(reportURI)), salt));
    }

    function hashAuditReveal(
        uint256 requestId,
        address auditor,
        address[] memory targets,
        uint16[] memory scores,
        bytes32 salt
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(requestId, auditor, targets, scores, salt));
    }

    function isReviewSelected(uint256 requestId, address reviewer, bytes32 sortitionProof) public view returns (bool) {
        Request storage request_ = _requireRequest(requestId);
        uint256 score = _sortitionScore(REVIEW_SORTITION, requestId, reviewer, bytes32(0), sortitionProof);
        return score < request_.config.reviewElectionDifficulty;
    }

    function isAuditTargetSelected(uint256 requestId, address auditor, address target, bytes32 salt) public view returns (bool) {
        Request storage request_ = _requireRequest(requestId);
        uint256 score = _sortitionScore(AUDIT_SORTITION, requestId, auditor, bytes32(uint256(uint160(target))), salt);
        return score < request_.config.auditElectionDifficulty;
    }

    function reviewerEligible(address reviewer, uint256 domainMask) external view returns (bool) {
        return _eligibleForRequest(reviewer, domainMask);
    }

    function queueLength() external view returns (uint256) {
        return _queue.length;
    }

    function queuedRequestAt(uint256 index) external view returns (uint256) {
        return _queue[index];
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
        uint256 confidence = _confidence(request_, coverage, proposalScores, finalScore);
        if (coverage < request_.config.auditCoverageQuorum) request_.lowConfidence = true;
        if (request_.lowConfidence) confidence = (confidence * 8_000) / SCALE;

        request_.finalProposalScore = finalScore;
        request_.confidence = confidence;
        request_.auditCoverage = coverage;
        request_.status = RequestStatus.Finalized;

        uint256 rewardPool = request_.rewardPool;
        request_.rewardPool = 0;
        treasuryBalance += request_.protocolFee;
        request_.protocolFee = 0;

        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewerList[i];
            bool protocolFault = reviewSubmissions[requestId][reviewer].protocolFault || auditSubmissions[requestId][reviewer].protocolFault;
            bool covered = incomingCounts[i] >= request_.config.minIncomingAudit;
            bool minority = _absDiff(proposalScores[i], finalScore) >= 1_500
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
            }

            reviewers[reviewer].completedRequests++;

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

    function _advance(uint256 requestId, RequestStatus status) internal {
        Request storage request_ = _requireRequest(requestId);
        request_.status = status;
        request_.phaseStartedAt = block.timestamp;
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
        ) {
            revert BadConfig();
        }
    }

    function _sortitionScore(
        bytes32 phase,
        uint256 requestId,
        address participant,
        bytes32 subject,
        bytes32 proofOrSalt
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(phase, requestId, participant, subject, proofOrSalt))) % SCALE;
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
