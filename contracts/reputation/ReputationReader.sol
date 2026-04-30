// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDAIOCoreReputationView {
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
        );
}

contract ReputationReader {
    IDAIOCoreReputationView public immutable core;

    constructor(address core_) {
        require(core_ != address(0), "ReputationReader: bad core");
        core = IDAIOCoreReputationView(core_);
    }

    function longTermSignals(address reviewer)
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
        return core.reputations(reviewer);
    }

    function requestSignals(uint256 requestId, address reviewer)
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
        (, reportQuality,, auditReliability, finalContribution, scoreAgreement, reward, minorityOpinion, covered, protocolFault) =
            core.getReviewerResult(requestId, reviewer);
    }
}
