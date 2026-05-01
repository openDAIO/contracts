// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReputationLedgerView {
    function reputations(address reviewer)
        external
        view
        returns (uint256 samples, uint256 reportQuality, uint256 auditReliability, uint256 finalContribution, uint256 protocolCompliance);
}

contract DAIORoundLedger {
    uint8 private constant ROUND_AUDIT_CONSENSUS = 1;
    uint8 private constant ROUND_REPUTATION_FINAL = 2;
    uint256 private constant SCALE = 10_000;

    struct RoundAggregate {
        uint256 score;
        uint256 totalWeight;
        uint256 confidence;
        uint256 coverage;
        bool lowConfidence;
        bool closed;
        bool aborted;
    }

    struct RoundReviewerScore {
        uint256 score;
        uint256 weight;
        uint256 weightedScore;
        uint256 auditScore;
        uint256 reputationScore;
        bool available;
    }

    struct RoundReviewerAccounting {
        uint256 reward;
        uint256 slashed;
        uint256 slashCount;
        bytes32 lastSlashReasonHash;
        bool protocolFault;
        bool semanticFault;
    }

    struct ReviewSnapshotInput {
        uint256 requestId;
        uint256 attempt;
        address[] reviewers;
        uint256[] scores;
        uint256 revealQuorum;
        bool lowConfidence;
        bool aborted;
    }

    struct ScoredSnapshotInput {
        uint256 requestId;
        uint256 attempt;
        uint8 round;
        address[] reviewers;
        uint256[] proposalScores;
        uint256[] weights;
        uint256[] medians;
        uint256[] reputationScores;
        uint256 finalScore;
        uint256 totalWeight;
        uint256 confidence;
        uint256 coverage;
        bool lowConfidence;
        bool aborted;
    }

    struct ConsensusSnapshotInput {
        uint256 requestId;
        uint256 attempt;
        address[] reviewers;
        uint256[] proposalScores;
        uint256[] weights;
        uint256[] medians;
        uint256 finalScore;
        uint256 totalWeight;
        uint256 confidence;
        uint256 coverage;
        bool lowConfidence;
        bool aborted;
    }

    struct FinalSnapshotInput {
        uint256 requestId;
        uint256 attempt;
        address reputationLedger;
        address[] reviewers;
        uint256[] proposalScores;
        uint256[] medians;
        uint256[] round1Weights;
        uint256[] contributions;
        uint256 round1FinalScore;
        uint256 round1TotalWeight;
        uint256 confidence;
        uint256 coverage;
        bool lowConfidence;
        bool aborted;
    }

    address public owner;
    address public core;

    mapping(uint256 requestId => mapping(uint256 attempt => mapping(uint8 round => RoundAggregate aggregate))) internal roundAggregates;
    mapping(uint256 requestId => mapping(uint256 attempt => mapping(uint8 round => mapping(address reviewer => RoundReviewerScore score)))) internal
        roundReviewerScores;
    mapping(uint256 requestId => mapping(uint256 attempt => mapping(uint8 round => mapping(address reviewer => RoundReviewerAccounting accounting))))
        internal roundReviewerAccounting;
    mapping(uint256 requestId => mapping(uint256 attempt => address[] reviewers)) internal round0Reviewers;
    mapping(uint256 requestId => mapping(uint256 attempt => address[] reviewers)) internal round1Reviewers;

    event CoreUpdated(address indexed core);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error InvalidAddress();
    error InvalidInput();
    error NotAuthorized();
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert NotAuthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setCore(address newCore) external onlyOwner {
        if (newCore == address(0)) revert InvalidAddress();
        core = newCore;
        emit CoreUpdated(newCore);
    }

    function recordReviewSnapshot(ReviewSnapshotInput calldata input) external onlyCore {
        if (input.reviewers.length == 0 || input.reviewers.length != input.scores.length || input.revealQuorum == 0) return;
        RoundAggregate storage aggregate = roundAggregates[input.requestId][input.attempt][0];
        if (aggregate.closed) return;

        uint256 progress = _capScale((input.reviewers.length * 10_000) / input.revealQuorum);
        aggregate.score = _median(_copyCalldata(input.scores));
        aggregate.totalWeight = input.reviewers.length * 10_000;
        aggregate.confidence = progress;
        aggregate.coverage = progress;
        aggregate.lowConfidence = input.lowConfidence;
        aggregate.closed = true;
        aggregate.aborted = input.aborted;

        for (uint256 i = 0; i < input.reviewers.length; i++) {
            roundReviewerScores[input.requestId][input.attempt][0][input.reviewers[i]] = RoundReviewerScore({
                score: input.scores[i],
                weight: 10_000,
                weightedScore: input.scores[i],
                auditScore: 0,
                reputationScore: 0,
                available: true
            });
        }
    }

    function recordReviewScore(uint256 requestId, uint256 attempt, address reviewer, uint256 score) external onlyCore {
        if (roundAggregates[requestId][attempt][0].closed) return;
        RoundReviewerScore storage reviewerScore = roundReviewerScores[requestId][attempt][0][reviewer];
        if (!reviewerScore.available) round0Reviewers[requestId][attempt].push(reviewer);
        roundReviewerScores[requestId][attempt][0][reviewer] = RoundReviewerScore({
            score: score,
            weight: SCALE,
            weightedScore: score,
            auditScore: 0,
            reputationScore: 0,
            available: true
        });
    }

    function closeReviewSnapshot(uint256 requestId, uint256 attempt, uint256 revealQuorum, bool lowConfidence, bool aborted) external onlyCore {
        RoundAggregate storage aggregate = roundAggregates[requestId][attempt][0];
        if (aggregate.closed || revealQuorum == 0) return;
        address[] storage reviewers = round0Reviewers[requestId][attempt];
        uint256 reviewerCount = reviewers.length;
        if (reviewerCount == 0) return;

        uint256[] memory scores = new uint256[](reviewerCount);
        for (uint256 i = 0; i < reviewerCount; i++) {
            scores[i] = roundReviewerScores[requestId][attempt][0][reviewers[i]].score;
        }

        uint256 progress = _capScale((reviewerCount * SCALE) / revealQuorum);
        aggregate.score = _median(scores);
        aggregate.totalWeight = reviewerCount * SCALE;
        aggregate.confidence = progress;
        aggregate.coverage = progress;
        aggregate.lowConfidence = lowConfidence;
        aggregate.closed = true;
        aggregate.aborted = aborted;
    }

    function recordScoredSnapshot(ScoredSnapshotInput calldata input) external onlyCore {
        if (
            input.reviewers.length != input.proposalScores.length || input.reviewers.length != input.weights.length
                || input.reviewers.length != input.medians.length
                || (input.reputationScores.length != 0 && input.reviewers.length != input.reputationScores.length)
        ) {
            return;
        }
        _recordScoredSnapshot(
            input.requestId,
            input.attempt,
            input.round,
            _copyAddresses(input.reviewers),
            _copyCalldata(input.proposalScores),
            _copyCalldata(input.weights),
            _copyCalldata(input.medians),
            _copyCalldata(input.reputationScores),
            input.finalScore,
            input.totalWeight,
            input.confidence,
            input.coverage,
            input.lowConfidence,
            input.aborted
        );
    }

    function recordConsensusScore(uint256 requestId, uint256 attempt, address reviewer, uint256 score, uint256 weight, uint256 auditScore)
        external
        onlyCore
    {
        if (roundAggregates[requestId][attempt][ROUND_AUDIT_CONSENSUS].closed) return;
        RoundReviewerScore storage reviewerScore = roundReviewerScores[requestId][attempt][ROUND_AUDIT_CONSENSUS][reviewer];
        if (!reviewerScore.available) round1Reviewers[requestId][attempt].push(reviewer);
        roundReviewerScores[requestId][attempt][ROUND_AUDIT_CONSENSUS][reviewer] = RoundReviewerScore({
            score: score,
            weight: weight,
            weightedScore: (score * weight) / SCALE,
            auditScore: auditScore,
            reputationScore: 0,
            available: true
        });
    }

    function closeConsensusSnapshot(
        uint256 requestId,
        uint256 attempt,
        uint256 finalScore,
        uint256 totalWeight,
        uint256 confidence,
        uint256 coverage,
        bool lowConfidence,
        bool aborted
    ) external onlyCore {
        RoundAggregate storage aggregate = roundAggregates[requestId][attempt][ROUND_AUDIT_CONSENSUS];
        if (aggregate.closed || round1Reviewers[requestId][attempt].length == 0) return;
        aggregate.score = finalScore;
        aggregate.totalWeight = totalWeight;
        aggregate.confidence = confidence;
        aggregate.coverage = coverage;
        aggregate.lowConfidence = lowConfidence;
        aggregate.closed = true;
        aggregate.aborted = aborted;
    }

    function recordConsensusSnapshot(ConsensusSnapshotInput calldata input) external onlyCore {
        if (
            input.reviewers.length == 0 || input.reviewers.length != input.proposalScores.length
                || input.reviewers.length != input.weights.length || input.reviewers.length != input.medians.length
        ) {
            return;
        }
        _recordScoredSnapshot(
            input.requestId,
            input.attempt,
            ROUND_AUDIT_CONSENSUS,
            _copyAddresses(input.reviewers),
            _copyCalldata(input.proposalScores),
            _copyCalldata(input.weights),
            _copyCalldata(input.medians),
            new uint256[](0),
            input.finalScore,
            input.totalWeight,
            input.confidence,
            input.coverage,
            input.lowConfidence,
            input.aborted
        );
    }

    function recordReputationFinal(
        uint256 requestId,
        uint256 attempt,
        address reputationLedger,
        uint256 confidence,
        uint256 coverage,
        bool lowConfidence_,
        bool aborted
    ) external onlyCore returns (uint256 finalScore, uint256 totalWeight, uint256[] memory finalWeights, bool lowConfidence) {
        address[] memory reviewers = _copyStoredReviewers(requestId, attempt);
        uint256 reviewerCount = reviewers.length;
        if (reviewerCount == 0) revert InvalidInput();

        uint256[] memory proposalScores = new uint256[](reviewerCount);
        uint256[] memory medians = new uint256[](reviewerCount);
        uint256[] memory reputationScores = new uint256[](reviewerCount);
        finalWeights = new uint256[](reviewerCount);
        for (uint256 i = 0; i < reviewerCount; i++) {
            RoundReviewerScore storage round1Score = roundReviewerScores[requestId][attempt][ROUND_AUDIT_CONSENSUS][reviewers[i]];
            uint256 reputationScore = _reputationComposite(reputationLedger, reviewers[i]);
            uint256 finalWeight = (round1Score.weight * reputationScore) / SCALE;
            if (finalWeight > SCALE) finalWeight = SCALE;

            proposalScores[i] = round1Score.score;
            medians[i] = round1Score.auditScore;
            reputationScores[i] = reputationScore;
            finalWeights[i] = finalWeight;
            totalWeight += finalWeight;
        }

        if (totalWeight == 0) {
            finalScore = _median(_copyMemory(proposalScores));
            lowConfidence = true;
        } else {
            finalScore = _weightedMedian(_copyMemory(proposalScores), _copyMemory(finalWeights));
        }
        lowConfidence = lowConfidence_ || lowConfidence;

        _recordScoredSnapshot(
            requestId,
            attempt,
            ROUND_REPUTATION_FINAL,
            reviewers,
            proposalScores,
            finalWeights,
            medians,
            reputationScores,
            finalScore,
            totalWeight,
            confidence,
            coverage,
            lowConfidence,
            aborted
        );
    }

    function closeReputationFinal(
        uint256 requestId,
        uint256 attempt,
        address reputationLedger,
        uint256 confidence,
        uint256 coverage,
        bool lowConfidence_,
        bool aborted
    ) external onlyCore returns (uint256 finalScore, uint256 totalWeight, bool lowConfidence) {
        RoundAggregate storage aggregate = roundAggregates[requestId][attempt][ROUND_REPUTATION_FINAL];
        if (aggregate.closed) return (aggregate.score, aggregate.totalWeight, aggregate.lowConfidence);

        address[] storage reviewers = round1Reviewers[requestId][attempt];
        uint256 reviewerCount = reviewers.length;
        if (reviewerCount == 0) revert InvalidInput();

        uint256[] memory proposalScores = new uint256[](reviewerCount);
        uint256[] memory finalWeights = new uint256[](reviewerCount);
        for (uint256 i = 0; i < reviewerCount; i++) {
            address reviewer = reviewers[i];
            RoundReviewerScore storage round1Score = roundReviewerScores[requestId][attempt][ROUND_AUDIT_CONSENSUS][reviewer];
            uint256 reputationScore = _reputationComposite(reputationLedger, reviewer);
            uint256 finalWeight = (round1Score.weight * reputationScore) / SCALE;
            if (finalWeight > SCALE) finalWeight = SCALE;

            proposalScores[i] = round1Score.score;
            finalWeights[i] = finalWeight;
            totalWeight += finalWeight;

            roundReviewerScores[requestId][attempt][ROUND_REPUTATION_FINAL][reviewer] = RoundReviewerScore({
                score: round1Score.score,
                weight: finalWeight,
                weightedScore: (round1Score.score * finalWeight) / SCALE,
                auditScore: round1Score.auditScore,
                reputationScore: reputationScore,
                available: true
            });
        }

        if (totalWeight == 0) {
            finalScore = _median(proposalScores);
            lowConfidence = true;
        } else {
            finalScore = _weightedMedian(proposalScores, finalWeights);
        }
        lowConfidence = lowConfidence_ || lowConfidence;

        aggregate.score = finalScore;
        aggregate.totalWeight = totalWeight;
        aggregate.confidence = confidence;
        aggregate.coverage = coverage;
        aggregate.lowConfidence = lowConfidence;
        aggregate.closed = true;
        aggregate.aborted = aborted;
    }

    function reviewerRoundWeight(uint256 requestId, uint256 attempt, uint8 round, address reviewer) external view returns (uint256) {
        return roundReviewerScores[requestId][attempt][round][reviewer].weight;
    }

    function recordFinalSnapshots(FinalSnapshotInput calldata input)
        external
        onlyCore
        returns (uint256 finalScore, uint256 totalWeight, uint256[] memory finalWeights, bool lowConfidence)
    {
        _validateFinalSnapshot(input);

        uint256[] memory emptyReputationScores = new uint256[](0);
        _recordScoredSnapshot(
            input.requestId,
            input.attempt,
            ROUND_AUDIT_CONSENSUS,
            _copyAddresses(input.reviewers),
            _copyCalldata(input.proposalScores),
            _copyCalldata(input.round1Weights),
            _copyCalldata(input.medians),
            emptyReputationScores,
            input.round1FinalScore,
            input.round1TotalWeight,
            input.confidence,
            input.coverage,
            input.lowConfidence,
            input.aborted
        );

        uint256 reviewerCount = input.reviewers.length;
        uint256[] memory reputationScores = new uint256[](reviewerCount);
        finalWeights = new uint256[](reviewerCount);
        for (uint256 i = 0; i < reviewerCount; i++) {
            uint256 reputationScore = _reputationComposite(input.reputationLedger, input.reviewers[i]);
            uint256 finalWeight = (input.contributions[i] * reputationScore) / SCALE;
            if (finalWeight > SCALE) finalWeight = SCALE;
            reputationScores[i] = reputationScore;
            finalWeights[i] = finalWeight;
            totalWeight += finalWeight;
        }

        if (totalWeight == 0) {
            finalScore = _median(_copyCalldata(input.proposalScores));
            lowConfidence = true;
        } else {
            finalScore = _weightedMedian(_copyCalldata(input.proposalScores), _copyMemory(finalWeights));
        }
        lowConfidence = input.lowConfidence || lowConfidence;

        _recordScoredSnapshot(
            input.requestId,
            input.attempt,
            ROUND_REPUTATION_FINAL,
            _copyAddresses(input.reviewers),
            _copyCalldata(input.proposalScores),
            finalWeights,
            _copyCalldata(input.medians),
            reputationScores,
            finalScore,
            totalWeight,
            input.confidence,
            input.coverage,
            lowConfidence,
            input.aborted
        );
    }

    function recordSlash(uint256 requestId, uint256 attempt, uint8 round, address reviewer, uint256 amount, bytes32 reasonHash, bool protocolFault)
        external
        onlyCore
    {
        RoundReviewerAccounting storage accounting = roundReviewerAccounting[requestId][attempt][round][reviewer];
        if (amount > 0) {
            accounting.slashed += amount;
            accounting.slashCount++;
        }
        accounting.lastSlashReasonHash = reasonHash;
        if (protocolFault) accounting.protocolFault = true;
        else accounting.semanticFault = true;
    }

    function markSemanticFault(uint256 requestId, uint256 attempt, uint8 round, address reviewer, bytes32 reasonHash) external onlyCore {
        RoundReviewerAccounting storage accounting = roundReviewerAccounting[requestId][attempt][round][reviewer];
        accounting.semanticFault = true;
        accounting.lastSlashReasonHash = reasonHash;
    }

    function recordReward(uint256 requestId, uint256 attempt, uint8 round, address reviewer, uint256 amount) external onlyCore {
        if (amount == 0) return;
        roundReviewerAccounting[requestId][attempt][round][reviewer].reward += amount;
    }

    function getRoundAggregate(uint256 requestId, uint256 attempt, uint8 round)
        external
        view
        returns (
            uint256 score,
            uint256 totalWeight,
            uint256 confidence,
            uint256 coverage,
            bool lowConfidence,
            bool closed,
            bool aborted
        )
    {
        RoundAggregate storage aggregate = roundAggregates[requestId][attempt][round];
        return (
            aggregate.score,
            aggregate.totalWeight,
            aggregate.confidence,
            aggregate.coverage,
            aggregate.lowConfidence,
            aggregate.closed,
            aggregate.aborted
        );
    }

    function getReviewerRoundScore(uint256 requestId, uint256 attempt, uint8 round, address reviewer)
        external
        view
        returns (
            uint256 score,
            uint256 weight,
            uint256 weightedScore,
            uint256 auditScore,
            uint256 reputationScore,
            bool available
        )
    {
        RoundReviewerScore storage reviewerScore = roundReviewerScores[requestId][attempt][round][reviewer];
        return (
            reviewerScore.score,
            reviewerScore.weight,
            reviewerScore.weightedScore,
            reviewerScore.auditScore,
            reviewerScore.reputationScore,
            reviewerScore.available
        );
    }

    function getReviewerRoundAccounting(uint256 requestId, uint256 attempt, uint8 round, address reviewer)
        external
        view
        returns (
            uint256 reward,
            uint256 slashed,
            uint256 slashCount,
            bytes32 lastSlashReasonHash,
            bool protocolFault,
            bool semanticFault
        )
    {
        RoundReviewerAccounting storage accounting = roundReviewerAccounting[requestId][attempt][round][reviewer];
        return (
            accounting.reward,
            accounting.slashed,
            accounting.slashCount,
            accounting.lastSlashReasonHash,
            accounting.protocolFault,
            accounting.semanticFault
        );
    }

    function _validateFinalSnapshot(FinalSnapshotInput calldata input) internal pure {
        uint256 reviewerCount = input.reviewers.length;
        if (
            reviewerCount == 0 || reviewerCount != input.proposalScores.length || reviewerCount != input.medians.length
                || reviewerCount != input.round1Weights.length || reviewerCount != input.contributions.length
        ) {
            revert InvalidInput();
        }
    }

    function _recordScoredSnapshot(
        uint256 requestId,
        uint256 attempt,
        uint8 round,
        address[] memory reviewers,
        uint256[] memory proposalScores,
        uint256[] memory weights,
        uint256[] memory medians,
        uint256[] memory reputationScores,
        uint256 finalScore,
        uint256 totalWeight,
        uint256 confidence,
        uint256 coverage,
        bool lowConfidence,
        bool aborted
    ) internal {
        RoundAggregate storage aggregate = roundAggregates[requestId][attempt][round];
        if (aggregate.closed) return;
        aggregate.score = finalScore;
        aggregate.totalWeight = totalWeight;
        aggregate.confidence = confidence;
        aggregate.coverage = coverage;
        aggregate.lowConfidence = lowConfidence;
        aggregate.closed = true;
        aggregate.aborted = aborted;

        if (round == ROUND_AUDIT_CONSENSUS) {
            address[] storage storedReviewers = round1Reviewers[requestId][attempt];
            for (uint256 i = 0; i < reviewers.length; i++) {
                storedReviewers.push(reviewers[i]);
            }
        }

        for (uint256 i = 0; i < reviewers.length; i++) {
            roundReviewerScores[requestId][attempt][round][reviewers[i]] = RoundReviewerScore({
                score: proposalScores[i],
                weight: weights[i],
                weightedScore: (proposalScores[i] * weights[i]) / SCALE,
                auditScore: medians[i],
                reputationScore: reputationScores.length == 0 ? 0 : reputationScores[i],
                available: true
            });
        }
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

    function _copyCalldata(uint256[] calldata values) internal pure returns (uint256[] memory copied) {
        copied = new uint256[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            copied[i] = values[i];
        }
    }

    function _copyAddresses(address[] calldata values) internal pure returns (address[] memory copied) {
        copied = new address[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            copied[i] = values[i];
        }
    }

    function _copyStoredReviewers(uint256 requestId, uint256 attempt) internal view returns (address[] memory copied) {
        address[] storage values = round1Reviewers[requestId][attempt];
        copied = new address[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            copied[i] = values[i];
        }
    }

    function _copyMemory(uint256[] memory values) internal pure returns (uint256[] memory copied) {
        copied = new uint256[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            copied[i] = values[i];
        }
    }

    function _reputationComposite(address ledger, address reviewer) internal view returns (uint256) {
        if (ledger == address(0)) return SCALE;
        (uint256 samples, uint256 reportQuality, uint256 auditReliability, uint256 finalContribution, uint256 protocolCompliance) =
            IReputationLedgerView(ledger).reputations(reviewer);
        if (samples == 0) return SCALE;
        uint256 composite = (_capScale(reportQuality) + _capScale(auditReliability) + _capScale(finalContribution) + _capScale(protocolCompliance)) / 4;
        return _capScale(composite);
    }

    function _capScale(uint256 value) internal pure returns (uint256) {
        return value > SCALE ? SCALE : value;
    }
}
