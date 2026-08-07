// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IFlashLoanPool {
    function flashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external;
}

interface ILaaSRouter {
    function flashLoanViaPartner(
        address asset,
        uint256 amount,
        bytes32 partnerId,
        bytes calldata userParams
    ) external;
}

/// @notice A well-behaved flash loan receiver for testing.
///         Repays the borrowed amount + fee to the initiator (FlashLoanPool).
///         Also supports initiating a flash loan through LaaSRouter for
///         partner payout testing.
contract MockFlashLoanReceiver {
    address public immutable asset;

    constructor(address _asset) {
        asset = _asset;
    }

    function executeOperation(
        address, /* asset */
        uint256 amount,
        uint256 fee,
        address, /* initiator */
        bytes calldata /* params */
    ) external returns (bool) {
        // Repay to msg.sender. Works for both:
        //  - Direct flash loan (msg.sender = FlashLoanPool)
        //  - Via LaaSRouter (msg.sender = LaaSRouter)
        uint256 repayAmount = amount + fee;
        IERC20(asset).approve(msg.sender, repayAmount);
        IERC20(asset).transfer(msg.sender, repayAmount);
        return true;
    }

    /// @notice Initiate a direct flash loan. This contract is both the
    ///         caller AND the callback target (msg.sender == this).
    function initiateFlashLoan(address pool, uint256 amount) external {
        IFlashLoanPool(pool).flashLoan(asset, amount, "");
    }

    /// @notice Initiate a flash loan through LaaSRouter.
    ///         This contract is both the caller AND the callback target,
    ///         which is the expected usage pattern.
    function initiateViaRouter(
        address router,
        uint256 amount,
        bytes32 partnerId
    ) external {
        ILaaSRouter(router).flashLoanViaPartner(asset, amount, partnerId, "");
    }

    // Allow receiving the borrowed funds
    receive() external payable {}
}
