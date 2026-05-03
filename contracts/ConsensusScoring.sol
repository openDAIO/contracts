// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ConsensusScoring {
    uint256 public constant SCALE = 10_000;
    uint256 public constant HALF_SCALE = 5_000;

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

    error InvalidInput();

    function compute(Input calldata input) external pure returns (Output memory output) {
        uint256 reviewerCount = input.proposalScores.length;
        if (
            reviewerCount == 0 || input.incomingScoresByTarget.length != reviewerCount
                || input.auditorTargetIndexes.length != reviewerCount || input.auditorScores.length != reviewerCount
        ) {
            revert InvalidInput();
        }

        output.medians = new uint256[](reviewerCount);
        output.incomingCounts = new uint256[](reviewerCount);
        output.rawReliability = new uint256[](reviewerCount);
        output.normalizedQuality = new uint256[](reviewerCount);
        output.normalizedReliability = new uint256[](reviewerCount);
        output.contributions = new uint256[](reviewerCount);
        output.weights = new uint256[](reviewerCount);
        output.covered = new bool[](reviewerCount);
        output.minority = new bool[](reviewerCount);
        output.lowConfidence = input.lowConfidence;

        uint256 maxMedian;
        uint256 coveredReports;
        for (uint256 i = 0; i < reviewerCount; i++) {
            uint256 incomingCount = input.incomingScoresByTarget[i].length;
            output.incomingCounts[i] = incomingCount;
            if (incomingCount > 0) output.medians[i] = _median(_copyCalldata(input.incomingScoresByTarget[i]));
            if (output.medians[i] > maxMedian) maxMedian = output.medians[i];
            if (incomingCount >= input.minIncomingAudit) {
                output.covered[i] = true;
                coveredReports++;
            }
        }

        if (maxMedian == 0) output.lowConfidence = true;

        uint256 maxReliability;
        for (uint256 i = 0; i < reviewerCount; i++) {
            uint256 reliability = _rawAuditReliability(input.auditorTargetIndexes[i], input.auditorScores[i], output.medians);
            output.rawReliability[i] = reliability;
            if (reliability > maxReliability) maxReliability = reliability;
        }

        if (maxReliability == 0) output.lowConfidence = true;

        for (uint256 i = 0; i < reviewerCount; i++) {
            if (maxMedian > 0) output.normalizedQuality[i] = (output.medians[i] * SCALE) / maxMedian;
            if (maxReliability > 0) output.normalizedReliability[i] = (output.rawReliability[i] * SCALE) / maxReliability;

            // No incoming audit (auditors timed out): credit own audit reliability so effort is rewarded.
            if (output.incomingCounts[i] == 0) {
                output.contributions[i] = output.normalizedReliability[i];
            } else {
                output.contributions[i] = _min(output.normalizedQuality[i], output.normalizedReliability[i]);
            }
            if (output.contributions[i] >= input.contributionThreshold) {
                output.weights[i] = output.contributions[i];
                output.totalContribution += output.contributions[i];
            }
        }

        if (output.totalContribution == 0) {
            output.finalScore = _median(_copyCalldata(input.proposalScores));
            output.lowConfidence = true;
        } else {
            output.finalScore = _weightedMedian(_copyCalldata(input.proposalScores), _copyMemory(output.weights));
        }

        output.coverage = (coveredReports * SCALE) / reviewerCount;
        output.scoreDispersion = _averageDeviation(input.proposalScores, output.finalScore);
        output.confidence = _confidence(input, output.coverage, output.scoreDispersion);
        if (output.coverage < input.auditCoverageQuorum) output.lowConfidence = true;
        if (output.lowConfidence) output.confidence = (output.confidence * 8_000) / SCALE;

        for (uint256 i = 0; i < reviewerCount; i++) {
            output.minority[i] = _absDiff(input.proposalScores[i], output.finalScore) >= input.minorityThreshold
                && output.normalizedQuality[i] >= input.contributionThreshold
                && output.contributions[i] >= input.contributionThreshold;
        }
    }

    function _rawAuditReliability(
        uint256[] calldata targetIndexes,
        uint256[] calldata auditorScores,
        uint256[] memory medians
    ) internal pure returns (uint256 reliability) {
        if (targetIndexes.length == 0) return 0;
        if (targetIndexes.length != auditorScores.length) revert InvalidInput();

        reliability = SCALE;
        for (uint256 i = 0; i < targetIndexes.length; i++) {
            if (targetIndexes[i] >= medians.length) revert InvalidInput();
            uint256 deviation = _absDiff(auditorScores[i], medians[targetIndexes[i]]);
            uint256 transformed = _transformDeviation(deviation);
            if (transformed < reliability) reliability = transformed;
        }
    }

    function _confidence(Input calldata input, uint256 coverage, uint256 scoreDispersion) internal pure returns (uint256) {
        uint256 reviewConfidence = _capScale((input.reviewRevealCount * SCALE) / input.reviewCommitQuorum);
        uint256 auditConfidence = _capScale((input.auditRevealCount * SCALE) / input.auditCommitQuorum);
        uint256 dispersionConfidence = scoreDispersion >= SCALE ? 0 : SCALE - scoreDispersion;
        return _min(_min(reviewConfidence, auditConfidence), _min(coverage, dispersionConfidence));
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

    function _copyMemory(uint256[] memory values) internal pure returns (uint256[] memory copied) {
        copied = new uint256[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            copied[i] = values[i];
        }
    }

    function _averageDeviation(uint256[] calldata values, uint256 referenceValue) internal pure returns (uint256) {
        uint256 totalDeviation;
        for (uint256 i = 0; i < values.length; i++) {
            totalDeviation += _absDiff(values[i], referenceValue);
        }
        return values.length == 0 ? 0 : totalDeviation / values.length;
    }

    function _transformDeviation(uint256 deviation) internal pure returns (uint256) {
        if (deviation >= HALF_SCALE) return 0;
        return (SCALE * (HALF_SCALE - deviation)) / (HALF_SCALE + deviation);
    }

    function _ema(uint256 previousValue, uint256 newValue) external pure returns (uint256) {
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
}
