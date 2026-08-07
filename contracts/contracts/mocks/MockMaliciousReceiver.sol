// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFlashLoanPool {
    function flashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external;
}

/// @notice A flash loan receiver that does NOT repay — for testing
///         the repayment invariant.
contract MockMaliciousReceiver {
    function executeOperation(
        address, /* asset */
        uint256, /* amount */
        uint256, /* fee */
        address, /* initiator */
        bytes calldata /* params */
    ) external pure returns (bool) {
        // Deliberately return false to simulate a failed repayment.
        return false;
    }

    /// @notice Initiate a direct flash loan as this contract so that
    ///         FlashLoanPool calls back to this contract's executeOperation.
    function initiateFlashLoan(address pool, address asset, uint256 amount) external {
        IFlashLoanPool(pool).flashLoan(asset, amount, "");
    }
}
