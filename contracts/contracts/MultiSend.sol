// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcLend MultiSend
/// @notice Send USDC, EURC, or both to many wallet addresses in a single
///         transaction. Supports manual entry and CSV upload via the frontend.
///         Funds move directly sender-to-recipient — this contract never holds
///         a balance at any point.
contract MultiSend is ReentrancyGuard {
    /// @notice Hard cap per transaction to stay safely under Arc's block gas
    ///         limit. The frontend chunks larger CSVs into multiple sequential
    ///         transactions rather than ever exceeding this.
    uint256 public constant MAX_RECIPIENTS = 200;

    // ─── Events ──────────────────────────────────────────────────────────

    event MultiSendExecuted(
        address indexed sender,
        address indexed token,
        uint256 recipientCount,
        uint256 totalAmount
    );

    event DualMultiSendExecuted(
        address indexed sender,
        uint256 recipientCount,
        uint256 totalUsdc,
        uint256 totalEurc
    );

    // ─── Single-token batch ──────────────────────────────────────────────

    /// @notice Send a single ERC-20 token to multiple recipients.
    /// @dev The caller must have approved this contract for at least `sum(amounts)`
    ///      of `token` BEFORE calling. Each transferFrom moves funds directly from
    ///      the caller to the recipient — this contract never holds a balance.
    /// @param token      ERC-20 token address (USDC or EURC).
    /// @param recipients Array of recipient addresses.
    /// @param amounts    Array of token amounts (raw, 6-decimal units).
    function multiSend(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        require(
            recipients.length == amounts.length,
            "MultiSend: array length mismatch"
        );
        require(
            recipients.length > 0 && recipients.length <= MAX_RECIPIENTS,
            "MultiSend: invalid recipient count"
        );

        uint256 total;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(
                recipients[i] != address(0),
                "MultiSend: zero address recipient"
            );
            require(amounts[i] > 0, "MultiSend: zero amount");
            total += amounts[i];
            IERC20(token).transferFrom(msg.sender, recipients[i], amounts[i]);
        }

        emit MultiSendExecuted(msg.sender, token, recipients.length, total);
    }

    // ─── Dual-token batch ────────────────────────────────────────────────

    /// @notice Send USDC and/or EURC to multiple recipients in a single
    ///         transaction. Each recipient can receive USDC, EURC, or both.
    /// @dev The caller must have approved this contract for at least
    ///      `sum(usdcAmounts)` of USDC and `sum(eurcAmounts)` of EURC BEFORE
    ///      calling. A zero amount for one asset at a given index means that
    ///      recipient only receives the other asset.
    /// @param recipients   Array of recipient addresses.
    /// @param usdcAmounts  Array of USDC amounts (raw, 6-decimal units).
    /// @param eurcAmounts  Array of EURC amounts (raw, 6-decimal units).
    /// @param usdcAddress  USDC token address.
    /// @param eurcAddress  EURC token address.
    function multiSendDual(
        address[] calldata recipients,
        uint256[] calldata usdcAmounts,
        uint256[] calldata eurcAmounts,
        address usdcAddress,
        address eurcAddress
    ) external nonReentrant {
        require(
            recipients.length == usdcAmounts.length &&
                recipients.length == eurcAmounts.length,
            "MultiSend: array length mismatch"
        );
        require(
            recipients.length > 0 && recipients.length <= MAX_RECIPIENTS,
            "MultiSend: invalid recipient count"
        );

        uint256 totalUsdc;
        uint256 totalEurc;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(
                recipients[i] != address(0),
                "MultiSend: zero address recipient"
            );
            if (usdcAmounts[i] > 0) {
                IERC20(usdcAddress).transferFrom(
                    msg.sender,
                    recipients[i],
                    usdcAmounts[i]
                );
                totalUsdc += usdcAmounts[i];
            }
            if (eurcAmounts[i] > 0) {
                IERC20(eurcAddress).transferFrom(
                    msg.sender,
                    recipients[i],
                    eurcAmounts[i]
                );
                totalEurc += eurcAmounts[i];
            }
        }

        emit DualMultiSendExecuted(
            msg.sender,
            recipients.length,
            totalUsdc,
            totalEurc
        );
    }
}
