// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ArcDrop
/// @notice Escrow-based claim-link drops for USDC and EURC.
///         A creator deposits tokens, configures a distribution mode, and
///         receives a shareable link. Anyone with the link calls claim() to
///         pull their share directly to their own connected wallet.
///
///         Two modes:
///         • EQUAL_SPLIT  — every claimant receives (totalAmount / maxClaimants).
///                          Requires totalAmount to divide evenly.
///         • CLAIM_ALL    — the first claimant receives the entire deposit.
///                          maxClaimants is normalised to 1 at creation time.
///
///         Funds live in this contract only between createDrop() and the
///         final claim/cancel/reclaim. The contract is never the intended
///         destination — it is purely an escrow until recipients pull.
contract ArcDrop is ReentrancyGuard {
    // ─── Types ────────────────────────────────────────────────────────────

    enum DropMode {
        EQUAL_SPLIT,
        CLAIM_ALL
    }

    struct Drop {
        address creator;
        address asset;           // USDC or EURC — single asset per drop
        uint256 totalAmount;
        uint256 remainingAmount;
        DropMode mode;
        uint256 maxClaimants;    // always 1 for CLAIM_ALL regardless of input
        uint256 claimantsCount;
        uint256 perClaimAmount;  // totalAmount / maxClaimants for EQUAL_SPLIT;
                                 // 0 for CLAIM_ALL (takes remainingAmount live)
        bool active;
        uint256 createdAt;
        uint256 expiresAt;       // 0 means no expiry
    }

    // ─── Storage ──────────────────────────────────────────────────────────

    mapping(uint256 => Drop) public drops;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    uint256 public nextDropId = 1;

    // ─── Events ───────────────────────────────────────────────────────────

    event DropCreated(
        uint256 indexed dropId,
        address indexed creator,
        address asset,
        uint256 totalAmount,
        DropMode mode,
        uint256 maxClaimants,
        uint256 expiresAt
    );

    event DropClaimed(
        uint256 indexed dropId,
        address indexed claimant,
        uint256 amount,
        uint256 claimantsCount
    );

    /// @param reason one of: "fully claimed" | "cancelled" | "expired"
    event DropClosed(uint256 indexed dropId, string reason);

    event DropReclaimed(
        uint256 indexed dropId,
        address indexed creator,
        uint256 amountReturned
    );

    // ─── Mutative functions ───────────────────────────────────────────────

    /// @notice Create a new drop.
    /// @param asset           ERC-20 token address (USDC or EURC)
    /// @param totalAmount     Total tokens to lock in the drop (6 decimals)
    /// @param mode            EQUAL_SPLIT or CLAIM_ALL
    /// @param maxClaimants    Number of claimant slots (ignored / forced to 1
    ///                        for CLAIM_ALL)
    /// @param expiresInSeconds 0 = never expires; otherwise seconds from now
    /// @return dropId         The new drop ID (use this to generate the link)
    function createDrop(
        address asset,
        uint256 totalAmount,
        DropMode mode,
        uint256 maxClaimants,
        uint256 expiresInSeconds
    ) external nonReentrant returns (uint256 dropId) {
        require(totalAmount > 0, "ArcDrop: amount must be positive");

        // CLAIM_ALL is always effectively one claimant regardless of what
        // was passed — normalise immediately so the struct is self-consistent.
        uint256 effectiveMaxClaimants = mode == DropMode.CLAIM_ALL ? 1 : maxClaimants;
        require(effectiveMaxClaimants > 0, "ArcDrop: need at least one claimant slot");

        if (mode == DropMode.EQUAL_SPLIT) {
            // Rejecting uneven splits up-front avoids dust remainders and
            // confusing per-claim amounts. The frontend validates this too
            // so a well-behaved user never hits this revert unexpectedly.
            require(
                totalAmount % effectiveMaxClaimants == 0,
                "ArcDrop: amount must divide evenly across claimants"
            );
        }

        // Pull funds into escrow. This is a legitimate escrow moment —
        // claimants are unknown at creation time so funds must sit in the
        // contract, same reasoning already used for TipEscrow's handle-based
        // tips elsewhere in the ArcLend suite.
        IERC20(asset).transferFrom(msg.sender, address(this), totalAmount);

        dropId = nextDropId++;

        drops[dropId] = Drop({
            creator: msg.sender,
            asset: asset,
            totalAmount: totalAmount,
            remainingAmount: totalAmount,
            mode: mode,
            maxClaimants: effectiveMaxClaimants,
            claimantsCount: 0,
            perClaimAmount: mode == DropMode.EQUAL_SPLIT
                ? totalAmount / effectiveMaxClaimants
                : 0,
            active: true,
            createdAt: block.timestamp,
            expiresAt: expiresInSeconds > 0 ? block.timestamp + expiresInSeconds : 0
        });

        emit DropCreated(
            dropId,
            msg.sender,
            asset,
            totalAmount,
            mode,
            effectiveMaxClaimants,
            drops[dropId].expiresAt
        );
    }

    /// @notice Claim this wallet's share from an active drop.
    ///         The caller signs their own transaction and pulls funds directly
    ///         to themselves — fully non-custodial on the claiming side.
    function claim(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        require(drop.active, "ArcDrop: drop is not active");
        require(!hasClaimed[dropId][msg.sender], "ArcDrop: already claimed");
        require(
            drop.expiresAt == 0 || block.timestamp < drop.expiresAt,
            "ArcDrop: drop has expired"
        );
        require(drop.creator != msg.sender, "ArcDrop: creator cannot claim their own drop");

        uint256 amount;
        if (drop.mode == DropMode.CLAIM_ALL) {
            // First (and only) claimer takes everything remaining.
            amount = drop.remainingAmount;
            drop.active = false;
            emit DropClosed(dropId, "fully claimed");
        } else {
            // EQUAL_SPLIT: every slot is exactly perClaimAmount.
            amount = drop.perClaimAmount;
            drop.claimantsCount += 1;
            if (drop.claimantsCount >= drop.maxClaimants) {
                drop.active = false;
                emit DropClosed(dropId, "fully claimed");
            }
        }

        hasClaimed[dropId][msg.sender] = true;
        drop.remainingAmount -= amount;

        // ArcDrop only ever moves funds in direct response to the recipient's
        // own signed claim() call. No push-based transfers anywhere.
        IERC20(drop.asset).transfer(msg.sender, amount);

        emit DropClaimed(dropId, msg.sender, amount, drop.claimantsCount);
    }

    /// @notice Creator cancels an active drop and reclaims whatever hasn't
    ///         been claimed yet.
    function cancelDrop(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        require(drop.creator == msg.sender, "ArcDrop: not the creator");
        require(drop.active, "ArcDrop: drop already closed");

        uint256 refund = drop.remainingAmount;
        drop.active = false;
        drop.remainingAmount = 0;

        IERC20(drop.asset).transfer(msg.sender, refund);

        emit DropClosed(dropId, "cancelled");
        emit DropReclaimed(dropId, msg.sender, refund);
    }

    /// @notice Creator reclaims funds from an expired drop that still has
    ///         an unclaimed balance.
    function reclaimExpired(uint256 dropId) external nonReentrant {
        Drop storage drop = drops[dropId];
        require(drop.creator == msg.sender, "ArcDrop: not the creator");
        require(drop.active, "ArcDrop: drop already closed");
        require(
            drop.expiresAt != 0 && block.timestamp >= drop.expiresAt,
            "ArcDrop: not expired yet"
        );

        uint256 refund = drop.remainingAmount;
        drop.active = false;
        drop.remainingAmount = 0;

        IERC20(drop.asset).transfer(msg.sender, refund);

        emit DropClosed(dropId, "expired");
        emit DropReclaimed(dropId, msg.sender, refund);
    }

    // ─── View functions ───────────────────────────────────────────────────

    /// @notice Returns the full Drop struct for a given ID. Returns a
    ///         zeroed struct for IDs that have never been created.
    function getDropStatus(uint256 dropId) external view returns (Drop memory) {
        return drops[dropId];
    }
}
