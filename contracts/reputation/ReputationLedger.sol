// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDAIOERC8004Adapter {
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

contract ReputationLedger {
    uint256 public constant SCALE = 10_000;

    struct Reputation {
        uint256 samples;
        uint256 reportQuality;
        uint256 auditReliability;
        uint256 finalContribution;
        uint256 protocolCompliance;
    }

    address public owner;
    address public core;
    IDAIOERC8004Adapter public erc8004Adapter;

    mapping(address reviewer => Reputation data) public reputations;

    event CoreUpdated(address indexed core);
    event ERC8004AdapterUpdated(address indexed adapter);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ReputationUpdated(
        address indexed reviewer,
        uint256 indexed agentId,
        uint256 reportQuality,
        uint256 auditReliability,
        uint256 finalContribution,
        uint256 protocolCompliance
    );

    error InvalidAddress();
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

    function setERC8004Adapter(address adapter) external onlyOwner {
        erc8004Adapter = IDAIOERC8004Adapter(adapter);
        emit ERC8004AdapterUpdated(adapter);
    }

    function record(
        address reviewer,
        uint256 agentId,
        uint256 reportQuality,
        uint256 auditReliability,
        uint256 finalContribution,
        uint256 finalReliability,
        bool protocolFault,
        uint256 scoreAgreement,
        bool minorityOpinion,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external onlyCore {
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
        emit ReputationUpdated(reviewer, agentId, reportQuality, auditReliability, finalContribution, compliance);

        if (address(erc8004Adapter) != address(0) && agentId != 0) {
            try erc8004Adapter.recordDAIOSignals(
                agentId,
                reportQuality,
                auditReliability,
                finalContribution,
                finalReliability,
                compliance,
                scoreAgreement,
                minorityOpinion,
                "",
                feedbackURI,
                feedbackHash
            ) {} catch {}
        }
    }

    function _ema(uint256 previousValue, uint256 newValue) internal pure returns (uint256) {
        return ((previousValue * 9) + newValue) / 10;
    }
}
