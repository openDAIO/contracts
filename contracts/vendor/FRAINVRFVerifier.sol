// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "../../lib/vrf-solidity/contracts/VRF.sol";

contract FRAINVRFVerifier {
    function decodeProof(bytes memory proof) public pure returns (uint256[4] memory) {
        return VRF.decodeProof(proof);
    }

    function decodePoint(bytes memory point) public pure returns (uint256[2] memory) {
        return VRF.decodePoint(point);
    }

    function verify(
        uint256[2] memory publicKey,
        uint256[4] memory proof,
        bytes memory message
    ) public pure returns (bool) {
        return VRF.verify(publicKey, proof, message);
    }

    function gammaToHash(uint256 gammaX, uint256 gammaY) public pure returns (bytes32) {
        return VRF.gammaToHash(gammaX, gammaY);
    }

    function randomnessFromProof(
        uint256[2] memory publicKey,
        uint256[4] memory proof,
        bytes memory message
    ) public pure returns (bytes32) {
        require(VRF.verify(publicKey, proof, message), "FRAINVRFVerifier: invalid proof");
        return VRF.gammaToHash(proof[0], proof[1]);
    }
}
