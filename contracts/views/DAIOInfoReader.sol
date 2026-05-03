// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDAIOCoreInfoSource {
    function extsload(bytes32 slot) external view returns (bytes32 value);
    function maxActiveRequests() external view returns (uint256);
}

contract DAIOInfoReader {
    uint8 internal constant STATUS_QUEUED = 1;
    uint8 internal constant STATUS_AUDIT_REVEAL = 5;
    uint8 internal constant STATUS_FINALIZED = 6;

    uint256 internal constant SLOT_OWNER = 0;
    uint256 internal constant SLOT_TREASURY = 1;
    uint256 internal constant SLOT_PAYMENT_ROUTER = 2;
    uint256 internal constant SLOT_STAKE_VAULT = 3;
    uint256 internal constant SLOT_REVIEWER_REGISTRY = 4;
    uint256 internal constant SLOT_ASSIGNMENT_MANAGER = 5;
    uint256 internal constant SLOT_CONSENSUS_SCORING = 6;
    uint256 internal constant SLOT_SETTLEMENT = 7;
    uint256 internal constant SLOT_REPUTATION_LEDGER = 8;
    uint256 internal constant SLOT_ROUND_LEDGER = 9;
    uint256 internal constant SLOT_BASE_REQUEST_FEE = 10;
    uint256 internal constant SLOT_ACTIVE_REQUEST_COUNT = 11;
    uint256 internal constant SLOT_REQUEST_COUNT = 12;

    uint256 internal constant SLOT_REQUESTS = 14;
    uint256 internal constant SLOT_TIER_CONFIGS = 15;
    uint256 internal constant SLOT_REVIEW_SUBMISSIONS = 16;
    uint256 internal constant SLOT_AUDIT_SUBMISSIONS = 17;
    uint256 internal constant SLOT_AUDIT_SCORES = 18;
    uint256 internal constant SLOT_HAS_AUDIT_SCORE = 19;
    uint256 internal constant SLOT_CANONICAL_AUDIT_TARGETS = 20;
    uint256 internal constant SLOT_REVIEWER_RESULTS = 21;
    uint256 internal constant SLOT_REQUEST_FAULT_COUNT = 22;
    uint256 internal constant SLOT_REVIEW_COMMITTERS = 23;
    uint256 internal constant SLOT_REVEALED_REVIEWERS = 24;
    uint256 internal constant SLOT_INCOMING_AUDITORS = 25;
    uint256 internal constant SLOT_AUDIT_TARGETS_BY_AUDITOR = 26;
    uint256 internal constant SLOT_CANONICAL_TARGETS_BY_AUDITOR = 27;

    uint256 internal constant REQUEST_CONFIG_OFFSET = 27;

    IDAIOCoreInfoSource public immutable core;

    struct SystemOverview {
        address owner;
        address treasury;
        address paymentRouter;
        address stakeVault;
        address reviewerRegistry;
        address assignmentManager;
        address consensusScoring;
        address settlement;
        address reputationLedger;
        address roundLedger;
        uint256 baseRequestFee;
        uint256 maxActiveRequests;
        uint256 activeRequestCount;
        uint256 requestCount;
    }

    struct RequestConfigView {
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

    struct RequestInfo {
        address requester;
        bytes32 proposalHash;
        bytes32 rubricHash;
        uint256 domainMask;
        uint8 tier;
        uint8 status;
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
        uint256 faultCount;
    }

    struct RequestPhase {
        uint8 status;
        bool processing;
        bool completed;
        uint256 count;
        uint256 quorum;
        uint256 phaseStartedAt;
        uint256 timeout;
        uint256 deadline;
        bool timedOut;
        uint256 retryCount;
        uint256 maxRetries;
        bool lowConfidence;
    }

    struct ReviewSubmissionView {
        bytes32 commitHash;
        bytes32 sortitionRandomness;
        bool committed;
        bool revealed;
        bool protocolFault;
        uint16 proposalScore;
        bytes32 reportHash;
    }

    struct AuditSubmissionView {
        bytes32 commitHash;
        bool committed;
        bool revealed;
        bool protocolFault;
    }

    struct ReviewerResultView {
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

    constructor(address core_) {
        require(core_ != address(0), "DAIOInfoReader: bad core");
        core = IDAIOCoreInfoSource(core_);
    }

    function systemOverview() external view returns (SystemOverview memory overview) {
        overview.owner = _addressSlot(SLOT_OWNER);
        overview.treasury = _addressSlot(SLOT_TREASURY);
        overview.paymentRouter = _addressSlot(SLOT_PAYMENT_ROUTER);
        overview.stakeVault = _addressSlot(SLOT_STAKE_VAULT);
        overview.reviewerRegistry = _addressSlot(SLOT_REVIEWER_REGISTRY);
        overview.assignmentManager = _addressSlot(SLOT_ASSIGNMENT_MANAGER);
        overview.consensusScoring = _addressSlot(SLOT_CONSENSUS_SCORING);
        overview.settlement = _addressSlot(SLOT_SETTLEMENT);
        overview.reputationLedger = _addressSlot(SLOT_REPUTATION_LEDGER);
        overview.roundLedger = _addressSlot(SLOT_ROUND_LEDGER);
        overview.baseRequestFee = uint256(_load(SLOT_BASE_REQUEST_FEE));
        overview.maxActiveRequests = core.maxActiveRequests();
        overview.activeRequestCount = uint256(_load(SLOT_ACTIVE_REQUEST_COUNT));
        overview.requestCount = uint256(_load(SLOT_REQUEST_COUNT));
    }

    function tierConfig(uint8 tier) external view returns (RequestConfigView memory config) {
        return _decodeConfig(_mappingSlot(uint256(tier), SLOT_TIER_CONFIGS));
    }

    function requestConfig(uint256 requestId) external view returns (RequestConfigView memory config) {
        return _decodeConfig(_slot(_requestSlot(requestId), REQUEST_CONFIG_OFFSET));
    }

    function requestInfo(uint256 requestId) public view returns (RequestInfo memory info) {
        bytes32 base = _requestSlot(requestId);
        bytes32 tierAndStatus = _load(_slot(base, 5));
        info.requester = _address(_load(base));
        info.proposalHash = _load(_slot(base, 2));
        info.rubricHash = _load(_slot(base, 3));
        info.domainMask = uint256(_load(_slot(base, 4)));
        info.tier = _byte(tierAndStatus, 0);
        info.status = _byte(tierAndStatus, 1);
        info.feePaid = uint256(_load(_slot(base, 6)));
        info.priorityFee = uint256(_load(_slot(base, 7)));
        info.rewardPool = uint256(_load(_slot(base, 8)));
        info.protocolFee = uint256(_load(_slot(base, 9)));
        info.createdAt = uint256(_load(_slot(base, 10)));
        info.phaseStartedAt = uint256(_load(_slot(base, 11)));
        info.phaseStartedBlock = uint256(_load(_slot(base, 12)));
        info.activePriority = uint256(_load(_slot(base, 13)));
        info.retryCount = uint256(_load(_slot(base, 14)));
        info.committeeEpoch = uint256(_load(_slot(base, 15)));
        info.auditEpoch = uint256(_load(_slot(base, 16)));
        info.reviewCommitCount = uint256(_load(_slot(base, 17)));
        info.reviewRevealCount = uint256(_load(_slot(base, 18)));
        info.auditCommitCount = uint256(_load(_slot(base, 19)));
        info.auditRevealCount = uint256(_load(_slot(base, 20)));
        info.finalProposalScore = uint256(_load(_slot(base, 21)));
        info.confidence = uint256(_load(_slot(base, 22)));
        info.auditCoverage = uint256(_load(_slot(base, 23)));
        info.scoreDispersion = uint256(_load(_slot(base, 24)));
        info.finalReliability = uint256(_load(_slot(base, 25)));
        info.lowConfidence = _bool(_load(_slot(base, 26)), 0);
        info.faultCount = uint256(_load(_mappingSlot(requestId, SLOT_REQUEST_FAULT_COUNT)));
    }

    function requestPhase(uint256 requestId) external view returns (RequestPhase memory phase) {
        RequestInfo memory info = requestInfo(requestId);
        RequestConfigView memory config = _decodeConfig(_slot(_requestSlot(requestId), REQUEST_CONFIG_OFFSET));

        phase.status = info.status;
        phase.processing = info.status >= STATUS_QUEUED && info.status <= STATUS_AUDIT_REVEAL;
        phase.completed = info.status >= STATUS_FINALIZED;
        phase.phaseStartedAt = info.phaseStartedAt;
        phase.retryCount = info.retryCount;
        phase.maxRetries = config.maxRetries;
        phase.lowConfidence = info.lowConfidence;

        if (info.status == 2) {
            phase.count = info.reviewCommitCount;
            phase.quorum = config.reviewCommitQuorum;
            phase.timeout = config.reviewCommitTimeout;
        } else if (info.status == 3) {
            phase.count = info.reviewRevealCount;
            phase.quorum = config.reviewRevealQuorum;
            phase.timeout = config.reviewRevealTimeout;
        } else if (info.status == 4) {
            phase.count = info.auditCommitCount;
            phase.quorum = config.auditCommitQuorum;
            phase.timeout = config.auditCommitTimeout;
        } else if (info.status == 5) {
            phase.count = info.auditRevealCount;
            phase.quorum = config.auditRevealQuorum;
            phase.timeout = config.auditRevealTimeout;
        }

        if (phase.timeout > 0) {
            phase.deadline = phase.phaseStartedAt + phase.timeout;
            phase.timedOut = block.timestamp > phase.deadline;
        }
    }

    function requestParticipants(uint256 requestId)
        external
        view
        returns (address[] memory reviewCommitters, address[] memory revealedReviewers)
    {
        reviewCommitters = _addressArray(_mappingSlot(requestId, SLOT_REVIEW_COMMITTERS));
        revealedReviewers = _addressArray(_mappingSlot(requestId, SLOT_REVEALED_REVIEWERS));
    }

    function reviewSubmission(uint256 requestId, address reviewer) external view returns (ReviewSubmissionView memory submission) {
        bytes32 base = _nestedAddressSlot(requestId, reviewer, SLOT_REVIEW_SUBMISSIONS);
        bytes32 flags = _load(_slot(base, 2));
        submission.commitHash = _load(base);
        submission.sortitionRandomness = _load(_slot(base, 1));
        submission.committed = _bool(flags, 0);
        submission.revealed = _bool(flags, 1);
        submission.protocolFault = _bool(flags, 2);
        submission.proposalScore = uint16(uint256(flags >> 24));
        submission.reportHash = _load(_slot(base, 3));
    }

    function auditSubmission(uint256 requestId, address auditor) external view returns (AuditSubmissionView memory submission) {
        bytes32 base = _nestedAddressSlot(requestId, auditor, SLOT_AUDIT_SUBMISSIONS);
        bytes32 flags = _load(_slot(base, 1));
        submission.commitHash = _load(base);
        submission.committed = _bool(flags, 0);
        submission.revealed = _bool(flags, 1);
        submission.protocolFault = _bool(flags, 2);
    }

    function auditScore(uint256 requestId, address auditor, address target)
        external
        view
        returns (uint16 score, bool submitted, bool canonical)
    {
        score = uint16(uint256(_load(_tripleAddressSlot(requestId, auditor, target, SLOT_AUDIT_SCORES))));
        submitted = _bool(_load(_tripleAddressSlot(requestId, auditor, target, SLOT_HAS_AUDIT_SCORE)), 0);
        canonical = _bool(_load(_tripleAddressSlot(requestId, auditor, target, SLOT_CANONICAL_AUDIT_TARGETS)), 0);
    }

    function auditTargets(uint256 requestId, address auditor)
        external
        view
        returns (address[] memory submittedTargets, address[] memory canonicalTargets)
    {
        submittedTargets = _addressArray(_nestedAddressSlot(requestId, auditor, SLOT_AUDIT_TARGETS_BY_AUDITOR));
        canonicalTargets = _addressArray(_nestedAddressSlot(requestId, auditor, SLOT_CANONICAL_TARGETS_BY_AUDITOR));
    }

    function incomingAuditors(uint256 requestId, address target) external view returns (address[] memory auditors) {
        return _addressArray(_nestedAddressSlot(requestId, target, SLOT_INCOMING_AUDITORS));
    }

    function reviewerResult(uint256 requestId, address reviewer) external view returns (ReviewerResultView memory result) {
        return _reviewerResult(requestId, reviewer);
    }

    function getReviewerResult(uint256 requestId, address reviewer) external view returns (ReviewerResultView memory result) {
        return _reviewerResult(requestId, reviewer);
    }

    function _reviewerResult(uint256 requestId, address reviewer) internal view returns (ReviewerResultView memory result) {
        bytes32 base = _nestedAddressSlot(requestId, reviewer, SLOT_REVIEWER_RESULTS);
        bytes32 flags = _load(_slot(base, 7));
        result.reportQualityMedian = uint256(_load(base));
        result.normalizedReportQuality = uint256(_load(_slot(base, 1)));
        result.auditReliabilityRaw = uint256(_load(_slot(base, 2)));
        result.normalizedAuditReliability = uint256(_load(_slot(base, 3)));
        result.finalContribution = uint256(_load(_slot(base, 4)));
        result.scoreAgreement = uint256(_load(_slot(base, 5)));
        result.reward = uint256(_load(_slot(base, 6)));
        result.minorityOpinion = _bool(flags, 0);
        result.covered = _bool(flags, 1);
        result.protocolFault = _bool(flags, 2);
    }

    function _decodeConfig(bytes32 base) internal view returns (RequestConfigView memory config) {
        uint256 first = uint256(_load(base));
        uint256 second = uint256(_load(_slot(base, 1)));
        config.reviewElectionDifficulty = _uint16(first, 0);
        config.auditElectionDifficulty = _uint16(first, 1);
        config.reviewCommitQuorum = _uint16(first, 2);
        config.reviewRevealQuorum = _uint16(first, 3);
        config.auditCommitQuorum = _uint16(first, 4);
        config.auditRevealQuorum = _uint16(first, 5);
        config.auditTargetLimit = _uint16(first, 6);
        config.minIncomingAudit = _uint16(first, 7);
        config.auditCoverageQuorum = _uint16(first, 8);
        config.contributionThreshold = _uint16(first, 9);
        config.reviewEpochSize = _uint16(first, 10);
        config.auditEpochSize = _uint16(first, 11);
        config.finalityFactor = _uint16(first, 12);
        config.maxRetries = _uint16(first, 13);
        config.minorityThreshold = _uint16(first, 14);
        config.semanticStrikeThreshold = _uint16(first, 15);
        config.protocolFaultSlashBps = _uint16(second, 0);
        config.missedRevealSlashBps = _uint16(second, 1);
        config.semanticSlashBps = _uint16(second, 2);
        config.cooldownBlocks = _uint32(second, 6);
        config.reviewCommitTimeout = _uint32(second, 10);
        config.reviewRevealTimeout = _uint32(second, 14);
        config.auditCommitTimeout = _uint32(second, 18);
        config.auditRevealTimeout = _uint32(second, 22);
    }

    function _addressSlot(uint256 slot) internal view returns (address) {
        return _address(_load(slot));
    }

    function _address(bytes32 word) internal pure returns (address) {
        return address(uint160(uint256(word)));
    }

    function _bool(bytes32 word, uint256 offset) internal pure returns (bool) {
        return _byte(word, offset) != 0;
    }

    function _byte(bytes32 word, uint256 offset) internal pure returns (uint8) {
        return uint8(uint256(word >> (offset * 8)));
    }

    function _uint16(uint256 word, uint256 offset) internal pure returns (uint16) {
        return uint16(word >> (offset * 16));
    }

    function _uint32(uint256 word, uint256 byteOffset) internal pure returns (uint32) {
        return uint32(word >> (byteOffset * 8));
    }

    function _load(uint256 slot) internal view returns (bytes32) {
        return core.extsload(bytes32(slot));
    }

    function _load(bytes32 slot) internal view returns (bytes32) {
        return core.extsload(slot);
    }

    function _requestSlot(uint256 requestId) internal pure returns (bytes32) {
        return _mappingSlot(requestId, SLOT_REQUESTS);
    }

    function _mappingSlot(uint256 key, uint256 slot) internal pure returns (bytes32) {
        return keccak256(abi.encode(key, slot));
    }

    function _nestedAddressSlot(uint256 key, address account, uint256 slot) internal pure returns (bytes32) {
        return keccak256(abi.encode(account, _mappingSlot(key, slot)));
    }

    function _tripleAddressSlot(uint256 key, address account, address target, uint256 slot) internal pure returns (bytes32) {
        return keccak256(abi.encode(target, _nestedAddressSlot(key, account, slot)));
    }

    function _slot(bytes32 base, uint256 offset) internal pure returns (bytes32) {
        return bytes32(uint256(base) + offset);
    }

    function _addressArray(bytes32 lengthSlot) internal view returns (address[] memory values) {
        uint256 length = uint256(_load(lengthSlot));
        values = new address[](length);
        bytes32 dataSlot = keccak256(abi.encode(lengthSlot));
        for (uint256 i = 0; i < length; i++) {
            values[i] = _address(_load(_slot(dataSlot, i)));
        }
    }
}
