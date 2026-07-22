// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ILendingPoolAddressSource {
    function priceOracle() external view returns (address);
    function interestRateModel() external view returns (address);
}

/// @title ArcLend Addresses Provider
/// @notice Owner-managed registry for the core ArcLend protocol contracts.
contract LendingPoolAddressesProvider is Ownable {
    address private lendingPool;

    event LendingPoolUpdated(address indexed newLendingPool);
    event PriceOracleUpdated(address indexed newPriceOracle);
    event InterestRateModelUpdated(address indexed newInterestRateModel);

    /// @notice Creates an empty registry owned by the deployer.
    constructor() Ownable(msg.sender) {}

    /// @notice Updates the LendingPool registry entry.
    /// @param newLendingPool New LendingPool address.
    function setLendingPool(address newLendingPool) external onlyOwner {
        require(newLendingPool != address(0), "AddressesProvider: zero lending pool");
        lendingPool = newLendingPool;
        emit LendingPoolUpdated(newLendingPool);
    }

    /// @notice Updates the price oracle registry entry.
    /// @param newPriceOracle New price oracle address.
    function setPriceOracle(address newPriceOracle) external onlyOwner {
        require(newPriceOracle != address(0), "AddressesProvider: zero price oracle");
        require(lendingPool != address(0), "AddressesProvider: lending pool not set");
        require(
            ILendingPoolAddressSource(lendingPool).priceOracle() == newPriceOracle,
            "AddressesProvider: oracle mismatch"
        );
        emit PriceOracleUpdated(newPriceOracle);
    }

    /// @notice Updates the interest rate model registry entry.
    /// @param newInterestRateModel New interest rate model address.
    function setInterestRateModel(address newInterestRateModel) external onlyOwner {
        require(newInterestRateModel != address(0), "AddressesProvider: zero rate model");
        require(lendingPool != address(0), "AddressesProvider: lending pool not set");
        require(
            ILendingPoolAddressSource(lendingPool).interestRateModel() == newInterestRateModel,
            "AddressesProvider: rate model mismatch"
        );
        emit InterestRateModelUpdated(newInterestRateModel);
    }

    /// @notice Returns the registered LendingPool.
    /// @return Registered LendingPool address.
    function getLendingPool() external view returns (address) {
        return lendingPool;
    }

    /// @notice Returns the registered price oracle.
    /// @return Registered price oracle address.
    function getPriceOracle() external view returns (address) {
        if (lendingPool == address(0)) {
            return address(0);
        }
        return ILendingPoolAddressSource(lendingPool).priceOracle();
    }

    /// @notice Returns the registered interest rate model.
    /// @return Registered interest rate model address.
    function getInterestRateModel() external view returns (address) {
        if (lendingPool == address(0)) {
            return address(0);
        }
        return ILendingPoolAddressSource(lendingPool).interestRateModel();
    }
}
