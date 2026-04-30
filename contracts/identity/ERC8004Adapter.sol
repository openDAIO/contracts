// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC8004IdentityRegistry {
    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool);
    function getAgentWallet(uint256 agentId) external view returns (address);
}

interface IERC8004ReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

contract ERC8004Adapter {
    IERC8004IdentityRegistry public immutable identityRegistry;
    IERC8004ReputationRegistry public immutable reputationRegistry;
    address public owner;
    address public writer;

    event DAIOFeedbackPublished(uint256 indexed agentId, string tag, int128 value, uint8 valueDecimals);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WriterUpdated(address indexed writer);

    modifier onlyOwner() {
        require(msg.sender == owner, "ERC8004Adapter: not owner");
        _;
    }

    modifier onlyWriter() {
        require(msg.sender == writer, "ERC8004Adapter: not writer");
        _;
    }

    constructor(address identityRegistry_, address reputationRegistry_) {
        require(identityRegistry_ != address(0), "ERC8004Adapter: bad identity");
        require(reputationRegistry_ != address(0), "ERC8004Adapter: bad reputation");
        identityRegistry = IERC8004IdentityRegistry(identityRegistry_);
        reputationRegistry = IERC8004ReputationRegistry(reputationRegistry_);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ERC8004Adapter: bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setWriter(address newWriter) external onlyOwner {
        require(newWriter != address(0), "ERC8004Adapter: bad writer");
        writer = newWriter;
        emit WriterUpdated(newWriter);
    }

    function isAuthorized(uint256 agentId, address reviewer) external view returns (bool) {
        return identityRegistry.isAuthorizedOrOwner(reviewer, agentId) || identityRegistry.getAgentWallet(agentId) == reviewer;
    }

    function agentWallet(uint256 agentId) external view returns (address) {
        return identityRegistry.getAgentWallet(agentId);
    }

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
    ) external onlyWriter {
        _give(agentId, reportQuality, 4, "daio.reportQuality", endpoint, feedbackURI, feedbackHash);
        _give(agentId, auditReliability, 4, "daio.auditReliability", endpoint, feedbackURI, feedbackHash);
        _give(agentId, finalContribution, 4, "daio.finalContribution", endpoint, feedbackURI, feedbackHash);
        _give(agentId, finalReliability, 4, "daio.finalReliability", endpoint, feedbackURI, feedbackHash);
        _give(agentId, protocolCompliance, 4, "daio.protocolCompliance", endpoint, feedbackURI, feedbackHash);
        _give(agentId, scoreAgreement, 4, "daio.scoreAgreement", endpoint, feedbackURI, feedbackHash);
        _give(agentId, minorityOpinion ? 1 : 0, 0, "daio.minorityOpinion", endpoint, feedbackURI, feedbackHash);
    }

    function _give(
        uint256 agentId,
        uint256 value,
        uint8 decimals_,
        string memory tag,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) internal {
        require(value <= uint256(uint128(type(int128).max)), "ERC8004Adapter: value too large");
        reputationRegistry.giveFeedback(agentId, int128(uint128(value)), decimals_, tag, "", endpoint, feedbackURI, feedbackHash);
        emit DAIOFeedbackPublished(agentId, tag, int128(uint128(value)), decimals_);
    }
}
