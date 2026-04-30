// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AcceptedTokenRegistry {
    address public owner;
    mapping(address token => bool accepted) public acceptedTokens;
    mapping(address token => bool requiresSwap) public requiresSwap;

    event AcceptedTokenSet(address indexed token, bool accepted, bool requiresSwap);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "AcceptedTokenRegistry: not owner");
        _;
    }

    constructor(address usdaio) {
        require(usdaio != address(0), "AcceptedTokenRegistry: bad USDAIO");
        owner = msg.sender;
        acceptedTokens[usdaio] = true;
        requiresSwap[usdaio] = false;
        emit OwnershipTransferred(address(0), msg.sender);
        emit AcceptedTokenSet(usdaio, true, false);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AcceptedTokenRegistry: bad owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setAcceptedToken(address token, bool accepted, bool tokenRequiresSwap) external onlyOwner {
        acceptedTokens[token] = accepted;
        requiresSwap[token] = tokenRequiresSwap;
        emit AcceptedTokenSet(token, accepted, tokenRequiresSwap);
    }
}
