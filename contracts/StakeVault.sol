// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IStakeVaultToken {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract StakeVault {
    IStakeVaultToken public immutable usdaio;
    address public owner;
    address public core;
    mapping(address account => bool authorized) public authorized;
    uint256 public treasuryBalance;

    mapping(address reviewer => uint256 stake) public stakes;
    mapping(uint256 requestId => uint256 rewardPool) public requestRewardPool;
    mapping(uint256 requestId => uint256 protocolFee) public requestProtocolFee;

    event CoreUpdated(address indexed core);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RequestFunded(uint256 indexed requestId, address indexed payer, uint256 rewardPool, uint256 protocolFee);
    event RequestRefunded(uint256 indexed requestId, address indexed requester, uint256 amount);
    event RewardPaid(uint256 indexed requestId, address indexed reviewer, uint256 amount);
    event ReviewerSlashed(address indexed reviewer, uint256 amount, string reason);
    event StakeDeposited(address indexed reviewer, uint256 amount);
    event StakeWithdrawn(address indexed reviewer, uint256 amount);
    event TreasuryAccrued(uint256 indexed requestId, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);

    error InvalidAddress();
    error InvalidAmount();
    error NotAuthorized();
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyCore() {
        if (msg.sender != core && !authorized[msg.sender]) revert NotAuthorized();
        _;
    }

    constructor(address usdaio_) {
        if (usdaio_ == address(0)) revert InvalidAddress();
        usdaio = IStakeVaultToken(usdaio_);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setCoreOrSettlement(address newCore) external onlyOwner {
        if (newCore == address(0)) revert InvalidAddress();
        core = newCore;
        authorized[newCore] = true;
        emit CoreUpdated(newCore);
    }

    function setAuthorized(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        authorized[account] = allowed;
    }

    function stakeFor(address reviewer, uint256 amount) external onlyCore {
        if (reviewer == address(0) || amount == 0) revert InvalidAmount();
        stakes[reviewer] += amount;
        _safeTransferFrom(reviewer, address(this), amount);
        emit StakeDeposited(reviewer, amount);
    }

    function withdrawStake(address reviewer, address recipient, uint256 amount) external onlyCore {
        if (reviewer == address(0) || recipient == address(0) || amount == 0 || stakes[reviewer] < amount) {
            revert InvalidAmount();
        }

        stakes[reviewer] -= amount;
        _safeTransfer(recipient, amount);
        emit StakeWithdrawn(reviewer, amount);
    }

    function slashStake(address reviewer, uint256 amount, string calldata reason) external onlyCore returns (uint256 slashed) {
        if (reviewer == address(0) || amount == 0) return 0;
        slashed = amount > stakes[reviewer] ? stakes[reviewer] : amount;
        if (slashed == 0) return 0;

        stakes[reviewer] -= slashed;
        treasuryBalance += slashed;
        emit ReviewerSlashed(reviewer, slashed, reason);
    }

    function fundRequest(uint256 requestId, address payer, uint256 rewardPool, uint256 protocolFee) external onlyCore {
        if (requestId == 0 || payer == address(0) || requestRewardPool[requestId] != 0 || requestProtocolFee[requestId] != 0) {
            revert InvalidAmount();
        }

        requestRewardPool[requestId] = rewardPool;
        requestProtocolFee[requestId] = protocolFee;
        _safeTransferFrom(payer, address(this), rewardPool + protocolFee);
        emit RequestFunded(requestId, payer, rewardPool, protocolFee);
    }

    function refundRequest(uint256 requestId, address requester) external onlyCore returns (uint256 refund) {
        if (requester == address(0)) revert InvalidAddress();
        refund = requestRewardPool[requestId] + requestProtocolFee[requestId];
        requestRewardPool[requestId] = 0;
        requestProtocolFee[requestId] = 0;
        if (refund > 0) _safeTransfer(requester, refund);
        emit RequestRefunded(requestId, requester, refund);
    }

    function payReward(uint256 requestId, address reviewer, uint256 amount) external onlyCore {
        if (amount == 0) return;
        if (reviewer == address(0) || requestRewardPool[requestId] < amount) revert InvalidAmount();
        requestRewardPool[requestId] -= amount;
        _safeTransfer(reviewer, amount);
        emit RewardPaid(requestId, reviewer, amount);
    }

    function closeRequestToTreasury(uint256 requestId) external onlyCore returns (uint256 accrued) {
        accrued = requestRewardPool[requestId] + requestProtocolFee[requestId];
        requestRewardPool[requestId] = 0;
        requestProtocolFee[requestId] = 0;
        treasuryBalance += accrued;
        emit TreasuryAccrued(requestId, accrued);
    }

    function withdrawTreasury(address to, uint256 amount) external onlyCore {
        if (to == address(0) || amount == 0 || amount > treasuryBalance) revert InvalidAmount();
        treasuryBalance -= amount;
        _safeTransfer(to, amount);
        emit TreasuryWithdrawn(to, amount);
    }

    function _safeTransfer(address to, uint256 value) internal {
        bool ok = usdaio.transfer(to, value);
        if (!ok) revert InvalidAmount();
    }

    function _safeTransferFrom(address from, address to, uint256 value) internal {
        bool ok = usdaio.transferFrom(from, to, value);
        if (!ok) revert InvalidAmount();
    }
}
