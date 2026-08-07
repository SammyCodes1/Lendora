// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ArcLend Protocol Treasury
/// @notice Collects protocol-owned fee revenue from FlashLoanPool, SwapPool,
///         and future revenue sources. Funds partner fee-shares, protocol
///         development, and any governance-directed allocations.
///
///         OWNERSHIP OF THIS CONTRACT SHOULD BE MIGRATED TO A GNOSIS SAFE
///         MULTI-SIG BEFORE ANY REAL FUNDS ACCUMULATE -- A SINGLE-EOA-OWNED
///         TREASURY IS A CENTRALIZATION RISK WORTH CLOSING BEFORE MAINNET.
///
///         This contract does NOT implement the multisig migration itself --
///         that is a follow-up operational step. The flag above exists so no
///         one can claim they weren't warned.
contract Treasury is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Addresses authorized to call withdraw() on behalf of the owner.
    ///         Used by LaaSRouter to pay partner fee-shares automatically
    ///         without holding full treasury ownership.
    mapping(address => bool) public authorizedSpenders;

    event Deposited(
        address indexed asset,
        address indexed from,
        uint256 amount,
        string source
    );
    event Withdrawn(
        address indexed asset,
        address indexed to,
        uint256 amount
    );
    event AuthorizedSpenderSet(address indexed spender, bool authorized);

    error NotAuthorizedSpender(address caller);

    modifier onlyAuthorized() {
        if (msg.sender != owner() && !authorizedSpenders[msg.sender]) {
            revert NotAuthorizedSpender(msg.sender);
        }
        _;
    }

    constructor(address owner_) Ownable(owner_) {
        require(owner_ != address(0), "Treasury: zero owner");
    }

    // ─── Deposit ───────────────────────────────────────────────────────

    /// @notice Deposit ERC-20 tokens into the treasury.
    /// @dev Caller must approve Treasury as spender before calling.
    /// @param asset  The ERC-20 token address.
    /// @param amount Amount of tokens to deposit.
    /// @param source Label identifying where the revenue came from
    ///               (e.g. "FlashLoanPool", "SwapPool") for on-chain
    ///               accounting -- makes public transparency dashboards
    ///               trivial to build on top of this contract.
    function deposit(
        address asset,
        uint256 amount,
        string calldata source
    ) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(asset, msg.sender, amount, source);
    }

    // ─── Withdraw ──────────────────────────────────────────────────────

    /// @notice Withdraw tokens to a target address.
    ///         Callable by the owner OR any authorized spender.
    function withdraw(
        address asset,
        address to,
        uint256 amount
    ) external onlyAuthorized {
        IERC20(asset).safeTransfer(to, amount);
        emit Withdrawn(asset, to, amount);
    }

    // ─── Balance ───────────────────────────────────────────────────────

    /// @notice Check the treasury's balance of a given asset.
    function getBalance(address asset) external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    // ─── Authorized Spenders ───────────────────────────────────────────

    /// @notice Grant or revoke authorized-spender status.
    ///         Only the owner can manage this list.
    function setAuthorizedSpender(
        address spender,
        bool authorized
    ) external onlyOwner {
        authorizedSpenders[spender] = authorized;
        emit AuthorizedSpenderSet(spender, authorized);
    }
}
