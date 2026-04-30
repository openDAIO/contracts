// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Settlement {
    uint256 public constant SCALE = 10_000;

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

    function reviewerSettlement(ReviewerInput calldata input) external pure returns (ReviewerOutput memory output) {
        output.scoreAgreement = SCALE - _min(_absDiff(input.proposalScore, input.finalScore), SCALE);
        if (!input.protocolFault && input.totalContribution > 0 && input.weight > 0) {
            output.reward = (input.rewardPool * input.weight) / input.totalContribution;
        }
        output.semanticFault = input.covered && input.contribution < input.contributionThreshold;
    }

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a >= b ? a - b : b - a;
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
