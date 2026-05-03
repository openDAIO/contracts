// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DAIOCore} from "../DAIOCore.sol";

contract DAIOCoreV2Mock is DAIOCore {
    function coreVersion() external pure returns (uint256) {
        return 2;
    }
}
