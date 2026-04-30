// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract USDAIOToken {
    string public constant name = "USDAIO";
    string public constant symbol = "USDAIO";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address account => mapping(address spender => uint256 amount)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Transfer(address indexed from, address indexed to, uint256 value);

    error InsufficientAllowance();
    error InsufficientBalance();
    error InvalidAddress();
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }

        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external onlyOwner {
        if (to == address(0)) revert InvalidAddress();

        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function burn(address from, uint256 value) external onlyOwner {
        if (from == address(0)) revert InvalidAddress();
        if (balanceOf[from] < value) revert InsufficientBalance();

        unchecked {
            balanceOf[from] -= value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();

        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (to == address(0)) revert InvalidAddress();
        if (balanceOf[from] < value) revert InsufficientBalance();

        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
