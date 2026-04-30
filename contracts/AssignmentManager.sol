// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AssignmentManager {
    uint256 public constant SCALE = 10_000;
    bytes32 public constant AUDIT_SORTITION = keccak256("DAIO_AUDIT_SORTITION");

    function canonicalAuditTargets(
        uint256 requestId,
        address auditor,
        address[] calldata revealedReviewers,
        bytes32 randomness,
        uint256 difficulty,
        uint256 limit
    ) external pure returns (address[] memory selectedTargets) {
        address[] memory candidates = new address[](revealedReviewers.length);
        uint256[] memory scores = new uint256[](revealedReviewers.length);
        uint256 candidateCount;

        for (uint256 i = 0; i < revealedReviewers.length; i++) {
            address target = revealedReviewers[i];
            if (target == auditor) continue;

            uint256 targetScore = uint256(keccak256(abi.encode(AUDIT_SORTITION, requestId, auditor, target, randomness))) % SCALE;
            if (targetScore < difficulty) {
                candidates[candidateCount] = target;
                scores[candidateCount] = targetScore;
                candidateCount++;
            }
        }

        _sortAddressPairs(candidates, scores, candidateCount);

        uint256 selectedCount = candidateCount < limit ? candidateCount : limit;
        selectedTargets = new address[](selectedCount);
        for (uint256 i = 0; i < selectedCount; i++) {
            selectedTargets[i] = candidates[i];
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
}
