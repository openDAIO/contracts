// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockVRFCoordinator {
    function randomness(
        uint256[2] calldata publicKey,
        uint256[4] calldata proof,
        address core,
        uint256 requestId,
        bytes32 phase,
        uint256 epoch,
        address reviewer,
        address target,
        uint256 phaseStartBlock,
        uint256 finalityFactor
    ) external view returns (bytes32) {
        require(proof[0] != 0 && proof[1] != 0, "MockVRFCoordinator: invalid proof");
        return keccak256(
            abi.encode(
                block.chainid,
                publicKey,
                proof,
                core,
                requestId,
                phase,
                epoch,
                reviewer,
                target,
                phaseStartBlock,
                finalityFactor
            )
        );
    }
}
