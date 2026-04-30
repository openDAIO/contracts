// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAssignmentVRFCoordinator {
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

contract AssignmentManager {
    uint256 public constant SCALE = 10_000;
    bytes32 public constant AUDIT_SORTITION = keccak256("DAIO_AUDIT_SORTITION");

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
    ) external view returns (bool ok, address[] memory selectedTargets) {
        address[] memory candidates = new address[](revealedReviewers.length);
        uint256[] memory scores = new uint256[](revealedReviewers.length);
        uint256 candidateCount;
        uint256 proofIndex;

        for (uint256 i = 0; i < revealedReviewers.length; i++) {
            address target = revealedReviewers[i];
            if (target == auditor) continue;
            if (proofIndex >= targetProofs.length) return (false, selectedTargets);

            bytes32 randomness;
            try IAssignmentVRFCoordinator(vrfCoordinator).randomness(
                publicKey,
                targetProofs[proofIndex],
                core,
                requestId,
                AUDIT_SORTITION,
                epoch,
                auditor,
                target,
                phaseStartBlock,
                finalityFactor
            ) returns (bytes32 value) {
                randomness = value;
            } catch {
                return (false, selectedTargets);
            }

            uint256 targetScore = uint256(keccak256(abi.encode(AUDIT_SORTITION, requestId, auditor, target, randomness))) % SCALE;
            proofIndex++;
            if (targetScore < difficulty) {
                candidates[candidateCount] = target;
                scores[candidateCount] = targetScore;
                candidateCount++;
            }
        }
        if (proofIndex != targetProofs.length) return (false, selectedTargets);

        _sortAddressPairs(candidates, scores, candidateCount);

        uint256 selectedCount = candidateCount < limit ? candidateCount : limit;
        selectedTargets = new address[](selectedCount);
        for (uint256 i = 0; i < selectedCount; i++) {
            selectedTargets[i] = candidates[i];
        }
        ok = true;
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
