// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockERC8004Registry {
    struct FeedbackRecord {
        uint256 agentId;
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    mapping(uint256 agentId => address wallet) public agentWallets;
    mapping(uint256 agentId => mapping(address spender => bool authorized)) public authorized;
    FeedbackRecord[] private _feedbacks;

    event FeedbackGiven(
        uint256 indexed agentId,
        int128 value,
        uint8 valueDecimals,
        string tag1,
        string tag2,
        string endpoint,
        string feedbackURI,
        bytes32 feedbackHash
    );

    function setAgentWallet(uint256 agentId, address wallet) external {
        agentWallets[agentId] = wallet;
    }

    function setAuthorized(uint256 agentId, address spender, bool allowed) external {
        authorized[agentId][spender] = allowed;
    }

    function isAuthorizedOrOwner(address spender, uint256 agentId) external view returns (bool) {
        return authorized[agentId][spender] || agentWallets[agentId] == spender;
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return agentWallets[agentId];
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        _feedbacks.push(FeedbackRecord(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash));
        emit FeedbackGiven(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash);
    }

    function feedbackCount() external view returns (uint256) {
        return _feedbacks.length;
    }

    function feedbackAt(uint256 index) external view returns (FeedbackRecord memory) {
        return _feedbacks[index];
    }
}
