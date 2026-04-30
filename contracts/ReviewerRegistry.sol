// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReviewerStakeVault {
    function stakeFor(address reviewer, uint256 amount) external;
    function withdrawStake(address reviewer, address recipient, uint256 amount) external;
    function slashStake(address reviewer, uint256 amount, string calldata reason) external returns (uint256);
}

interface IReviewerENSVerifier {
    function verify(bytes32 node, address reviewerWallet, address agentWallet) external view returns (bool);
}

interface IReviewerERC8004Adapter {
    function isAuthorized(uint256 agentId, address reviewer) external view returns (bool);
    function agentWallet(uint256 agentId) external view returns (address);
}

contract ReviewerRegistry {
    struct Reviewer {
        bool registered;
        bool active;
        bool suspended;
        bytes32 ensNode;
        string ensName;
        uint256 agentId;
        uint256 stake;
        uint256 domainMask;
        uint256[2] vrfPublicKey;
        uint256 completedRequests;
        uint256 semanticStrikes;
        uint256 protocolFaults;
        uint256 cooldownUntilBlock;
    }

    address public owner;
    address public core;
    IReviewerStakeVault public stakeVault;
    IReviewerENSVerifier public ensVerifier;
    IReviewerERC8004Adapter public erc8004Adapter;
    uint256 public minStake = 1_000 ether;

    mapping(address reviewer => Reviewer data) internal reviewers;

    event IdentityModulesUpdated(address indexed ensVerifier, address indexed erc8004Adapter);
    event CoreUpdated(address indexed core);
    event MinStakeUpdated(uint256 minStake);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ReviewerRegistered(address indexed reviewer, uint256 indexed agentId, bytes32 indexed ensNode, uint256 stake, uint256 domainMask);
    event ReviewerSlashed(address indexed reviewer, uint256 amount, string reason);

    error IneligibleReviewer();
    error InvalidAddress();
    error InvalidAmount();
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

    constructor(address stakeVault_) {
        if (stakeVault_ == address(0)) revert InvalidAddress();
        owner = msg.sender;
        stakeVault = IReviewerStakeVault(stakeVault_);
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

    function setMinStake(uint256 newMinStake) external onlyOwner {
        minStake = newMinStake;
        emit MinStakeUpdated(newMinStake);
    }

    function setIdentityModules(address ensVerifier_, address erc8004Adapter_) external onlyOwner {
        ensVerifier = IReviewerENSVerifier(ensVerifier_);
        erc8004Adapter = IReviewerERC8004Adapter(erc8004Adapter_);
        emit IdentityModulesUpdated(ensVerifier_, erc8004Adapter_);
    }

    function registerReviewer(
        string calldata ensName,
        bytes32 ensNode,
        uint256 agentId_,
        uint256 domainMask,
        uint256[2] calldata vrfPublicKey_,
        uint256 stakeAmount
    ) external {
        if (bytes(ensName).length == 0 || ensNode == bytes32(0) || agentId_ == 0 || domainMask == 0) revert InvalidAmount();
        if (vrfPublicKey_[0] == 0 || vrfPublicKey_[1] == 0 || stakeAmount == 0) revert InvalidAmount();

        address agentWallet;
        if (address(erc8004Adapter) != address(0)) {
            if (!erc8004Adapter.isAuthorized(agentId_, msg.sender)) revert IneligibleReviewer();
            agentWallet = erc8004Adapter.agentWallet(agentId_);
        }
        if (address(ensVerifier) != address(0) && !ensVerifier.verify(ensNode, msg.sender, agentWallet)) {
            revert IneligibleReviewer();
        }

        Reviewer storage reviewer = reviewers[msg.sender];
        uint256 newStake = reviewer.stake + stakeAmount;
        if (newStake < minStake) revert InvalidAmount();
        stakeVault.stakeFor(msg.sender, stakeAmount);

        reviewer.registered = true;
        reviewer.active = true;
        reviewer.ensNode = ensNode;
        reviewer.ensName = ensName;
        reviewer.agentId = agentId_;
        reviewer.domainMask = domainMask;
        reviewer.vrfPublicKey[0] = vrfPublicKey_[0];
        reviewer.vrfPublicKey[1] = vrfPublicKey_[1];
        reviewer.stake = newStake;

        emit ReviewerRegistered(msg.sender, agentId_, ensNode, newStake, domainMask);
    }

    function setReviewerStatus(address reviewer, bool active, bool suspended) external onlyOwner {
        if (!reviewers[reviewer].registered) revert IneligibleReviewer();
        reviewers[reviewer].active = active;
        reviewers[reviewer].suspended = suspended;
    }

    function withdrawStake(uint256 amount) external {
        Reviewer storage reviewer = reviewers[msg.sender];
        if (!reviewer.registered || amount == 0 || reviewer.stake < amount) revert InvalidAmount();
        uint256 remaining = reviewer.stake - amount;
        if (reviewer.active && remaining < minStake) revert InvalidAmount();
        reviewer.stake = remaining;
        stakeVault.withdrawStake(msg.sender, msg.sender, amount);
    }

    function isEligible(address reviewerAddress, uint256 domainMask) external view returns (bool) {
        Reviewer storage reviewer = reviewers[reviewerAddress];
        return reviewer.registered && reviewer.active && !reviewer.suspended && reviewer.stake >= minStake
            && reviewer.cooldownUntilBlock <= block.number && (reviewer.domainMask & domainMask) != 0;
    }

    function vrfPublicKey(address reviewerAddress) external view returns (uint256[2] memory) {
        return reviewers[reviewerAddress].vrfPublicKey;
    }

    function agentId(address reviewerAddress) external view returns (uint256) {
        return reviewers[reviewerAddress].agentId;
    }

    function markCompleted(address reviewerAddress) external onlyCore {
        reviewers[reviewerAddress].completedRequests++;
    }

    function recordSemanticFault(address reviewerAddress, uint256 threshold, uint256 cooldownBlocks) external onlyCore returns (bool suspended) {
        Reviewer storage reviewer = reviewers[reviewerAddress];
        reviewer.semanticStrikes++;
        if (reviewer.semanticStrikes >= threshold) {
            reviewer.cooldownUntilBlock = block.number + cooldownBlocks;
            reviewer.suspended = true;
            return true;
        }
    }

    function slashStakeBps(address reviewerAddress, uint256 bps, string calldata reason, bool protocolFault)
        external
        onlyCore
        returns (uint256 amount)
    {
        Reviewer storage reviewer = reviewers[reviewerAddress];
        if (!reviewer.registered || bps == 0 || reviewer.stake == 0) return 0;
        amount = (reviewer.stake * bps) / 10_000;
        if (amount == 0) return 0;
        if (amount > reviewer.stake) amount = reviewer.stake;
        reviewer.stake -= amount;
        if (protocolFault) reviewer.protocolFaults++;
        stakeVault.slashStake(reviewerAddress, amount, reason);
        emit ReviewerSlashed(reviewerAddress, amount, reason);
    }

    function getReviewer(address reviewerAddress)
        external
        view
        returns (
            bool registered,
            bool active,
            bool suspended,
            uint256 agentId_,
            uint256 stake,
            uint256 domainMask,
            uint256 completedRequests,
            uint256 semanticStrikes,
            uint256 protocolFaults,
            uint256 cooldownUntilBlock
        )
    {
        Reviewer storage reviewer = reviewers[reviewerAddress];
        return (
            reviewer.registered,
            reviewer.active,
            reviewer.suspended,
            reviewer.agentId,
            reviewer.stake,
            reviewer.domainMask,
            reviewer.completedRequests,
            reviewer.semanticStrikes,
            reviewer.protocolFaults,
            reviewer.cooldownUntilBlock
        );
    }
}
