// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockSpokenPayDomain {
    mapping(string => address) public names;

    function set(string memory domainName, address owner) external {
        names[domainName] = owner;
    }

    function resolveDomain(string memory domainName) external view returns (address) {
        return names[domainName];
    }
}
