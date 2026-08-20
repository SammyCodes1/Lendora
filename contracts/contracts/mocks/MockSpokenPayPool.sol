// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockSpokenPayPool {
    uint256 public healthFactor = type(uint256).max;

    function setHealthFactor(uint256 value) external {
        healthFactor = value;
    }

    function getUserAccountData(address)
        external
        view
        returns (uint256, uint256, uint256, uint256)
    {
        return (0, 0, 0, healthFactor);
    }
}
