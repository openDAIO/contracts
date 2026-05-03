// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AssignmentManager {
    uint256 public constant SCALE = 10_000;

    function verifiedCanonicalAuditTargets(
        address,
        uint256[2] calldata,
        address,
        uint256,
        address auditor,
        address[] calldata revealedReviewers,
        uint256[4][] calldata targetProofs,
        uint256,
        uint256,
        uint256,
        uint256 difficulty,
        uint256 limit
    ) external pure returns (bool ok, address[] memory selectedTargets) {
        if (difficulty != SCALE || targetProofs.length != 0) return (false, selectedTargets);
        selectedTargets = _fullAuditTargets(revealedReviewers, auditor, limit);
        return (true, selectedTargets);
    }

    function _fullAuditTargets(address[] calldata revealedReviewers, address auditor, uint256 limit)
        internal
        pure
        returns (address[] memory selectedTargets)
    {
        uint256 selectedCount;
        for (uint256 i = 0; i < revealedReviewers.length && selectedCount < limit; i++) {
            if (revealedReviewers[i] != auditor) selectedCount++;
        }

        selectedTargets = new address[](selectedCount);
        uint256 out;
        for (uint256 i = 0; i < revealedReviewers.length && out < selectedCount; i++) {
            address target = revealedReviewers[i];
            if (target == auditor) continue;
            selectedTargets[out] = target;
            out++;
        }
    }
}
