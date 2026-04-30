// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFRAINVRFVerifierLike {
    function randomnessFromProof(
        uint256[2] calldata publicKey,
        uint256[4] calldata proof,
        bytes calldata message
    ) external view returns (bytes32);
}

contract DAIOVRFCoordinator {
    IFRAINVRFVerifierLike public immutable verifier;

    constructor(address verifier_) {
        require(verifier_ != address(0), "DAIOVRFCoordinator: bad verifier");
        verifier = IFRAINVRFVerifierLike(verifier_);
    }

    function messageFor(
        address core,
        uint256 requestId,
        bytes32 phase,
        uint256 epoch,
        address reviewer,
        address target,
        uint256 phaseStartBlock,
        uint256 finalityFactor
    ) public view returns (bytes memory) {
        uint256 stableBlock = phaseStartBlock > finalityFactor ? phaseStartBlock - finalityFactor : 0;
        bytes32 stableBlockHash = stableBlock == 0 || block.number - stableBlock > 256 ? bytes32(0) : blockhash(stableBlock);
        return abi.encode(block.chainid, core, requestId, phase, epoch, reviewer, target, stableBlock, stableBlockHash);
    }

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
        return verifier.randomnessFromProof(
            publicKey,
            proof,
            messageFor(core, requestId, phase, epoch, reviewer, target, phaseStartBlock, finalityFactor)
        );
    }
}
