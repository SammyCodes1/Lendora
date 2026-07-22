// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcLend Kinked Interest Rate Model
/// @notice Calculates utilization-based borrow and supply rates in ray precision per second.
contract InterestRateModel {
    uint256 public constant RAY = 1e27;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    uint256 public constant BASE_RATE = 2e25;
    uint256 public constant SLOPE1 = 10e25;
    uint256 public constant SLOPE2 = 100e25;
    uint256 public constant OPTIMAL_UTILIZATION = 80e25;

    /// @notice Calculates the current variable borrow rate.
    /// @param totalBorrowed Total outstanding debt in the reserve's 6-decimal asset units.
    /// @param totalLiquidity Total reserve liquidity in the reserve's 6-decimal asset units.
    /// @return borrowRatePerSecond Borrow rate per second in ray precision.
    function calculateBorrowRate(
        uint256 totalBorrowed,
        uint256 totalLiquidity
    ) external pure returns (uint256 borrowRatePerSecond) {
        borrowRatePerSecond = _calculateBorrowRate(totalBorrowed, totalLiquidity);
    }

    /// @notice Calculates the current supply rate before reserve fees.
    /// @param totalBorrowed Total outstanding debt in the reserve's 6-decimal asset units.
    /// @param totalLiquidity Total reserve liquidity in the reserve's 6-decimal asset units.
    /// @return supplyRatePerSecond Supply rate per second in ray precision.
    function calculateSupplyRate(
        uint256 totalBorrowed,
        uint256 totalLiquidity
    ) external pure returns (uint256 supplyRatePerSecond) {
        if (totalLiquidity == 0 || totalBorrowed == 0) {
            return 0;
        }

        uint256 utilization = (totalBorrowed * RAY) / totalLiquidity;
        uint256 borrowRatePerSecond = _calculateBorrowRate(totalBorrowed, totalLiquidity);

        supplyRatePerSecond = (borrowRatePerSecond * utilization) / RAY;
    }

    /// @notice Implements the kinked annual rate curve and converts it to a per-second rate.
    /// @param totalBorrowed Total outstanding debt.
    /// @param totalLiquidity Total reserve liquidity.
    /// @return borrowRatePerSecond Borrow rate per second in ray precision.
    function _calculateBorrowRate(
        uint256 totalBorrowed,
        uint256 totalLiquidity
    ) internal pure returns (uint256 borrowRatePerSecond) {
        if (totalLiquidity == 0 || totalBorrowed == 0) {
            return BASE_RATE / SECONDS_PER_YEAR;
        }

        uint256 utilization = (totalBorrowed * RAY) / totalLiquidity;
        uint256 borrowRatePerYear;

        if (utilization <= OPTIMAL_UTILIZATION) {
            borrowRatePerYear = BASE_RATE + ((utilization * SLOPE1) / OPTIMAL_UTILIZATION);
        } else {
            uint256 excessUtilization = utilization - OPTIMAL_UTILIZATION;
            uint256 excessUtilizationRange = RAY - OPTIMAL_UTILIZATION;
            borrowRatePerYear = BASE_RATE + SLOPE1 + ((excessUtilization * SLOPE2) / excessUtilizationRange);
        }

        borrowRatePerSecond = borrowRatePerYear / SECONDS_PER_YEAR;
    }
}
