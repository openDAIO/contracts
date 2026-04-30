// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockERC20Like {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IMockAutoConvertHook {
    function validateAutoConvert(bytes32 intentHash, bytes32 poolKey) external;
}

contract MockUniversalRouter {
    receive() external payable {}

    function swap(
        address inputToken,
        address outputToken,
        address recipient,
        uint256 inputUsed,
        uint256 outputAmount
    ) external {
        require(IMockERC20Like(inputToken).transferFrom(msg.sender, address(this), inputUsed), "MockUniversalRouter: input failed");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
    }

    function swapETH(address outputToken, address recipient, uint256 ethUsed, uint256 outputAmount) external payable {
        require(msg.value >= ethUsed, "MockUniversalRouter: insufficient ETH");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
        if (msg.value > ethUsed) {
            (bool ok,) = msg.sender.call{value: msg.value - ethUsed}("");
            require(ok, "MockUniversalRouter: refund failed");
        }
    }

    function swapWithValidation(
        address inputToken,
        address outputToken,
        address recipient,
        uint256 inputUsed,
        uint256 outputAmount,
        address hook,
        bytes32 intentHash,
        bytes32 poolKey
    ) external {
        require(IMockERC20Like(inputToken).transferFrom(msg.sender, address(this), inputUsed), "MockUniversalRouter: input failed");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
        IMockAutoConvertHook(hook).validateAutoConvert(intentHash, poolKey);
    }

    function swapETHWithValidation(
        address outputToken,
        address recipient,
        uint256 ethUsed,
        uint256 outputAmount,
        address hook,
        bytes32 intentHash,
        bytes32 poolKey
    ) external payable {
        require(msg.value >= ethUsed, "MockUniversalRouter: insufficient ETH");
        require(IMockERC20Like(outputToken).transfer(recipient, outputAmount), "MockUniversalRouter: output failed");
        IMockAutoConvertHook(hook).validateAutoConvert(intentHash, poolKey);
        if (msg.value > ethUsed) {
            (bool ok,) = msg.sender.call{value: msg.value - ethUsed}("");
            require(ok, "MockUniversalRouter: refund failed");
        }
    }
}
