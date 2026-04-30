// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IENSRegistry {
    function resolver(bytes32 node) external view returns (address);
}

interface IAddressResolver {
    function addr(bytes32 node) external view returns (address);
}

contract ENSVerifier {
    IENSRegistry public immutable registry;

    constructor(address registry_) {
        require(registry_ != address(0), "ENSVerifier: bad registry");
        registry = IENSRegistry(registry_);
    }

    function verify(bytes32 node, address reviewerWallet, address agentWallet) external view returns (bool) {
        address resolver = registry.resolver(node);
        if (resolver == address(0)) return false;

        address resolved = IAddressResolver(resolver).addr(node);
        return resolved != address(0) && (resolved == reviewerWallet || resolved == agentWallet);
    }
}
