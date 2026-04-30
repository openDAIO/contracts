// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockENSRegistry {
    mapping(bytes32 node => address resolver_) public resolvers;

    function setResolver(bytes32 node, address resolver_) external {
        resolvers[node] = resolver_;
    }

    function resolver(bytes32 node) external view returns (address) {
        return resolvers[node];
    }
}

contract MockENSResolver {
    mapping(bytes32 node => address resolvedAddress) public addresses;

    function setAddr(bytes32 node, address resolvedAddress) external {
        addresses[node] = resolvedAddress;
    }

    function addr(bytes32 node) external view returns (address) {
        return addresses[node];
    }
}
