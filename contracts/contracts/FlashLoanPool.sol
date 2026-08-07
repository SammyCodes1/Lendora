// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanReceiver {
    /// @notice Called by FlashLoanPool during a flash loan.
    /// @dev Must return `true` on success. The receiver MUST approve
    ///      FlashLoanPool to pull `amount + fee` before returning, or
    ///      send the funds directly back to FlashLoanPool.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 fee,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface ITreasury {
    function deposit(
        address asset,
        uint256 amount,
        string calldata source
    ) external;
}

/// @title ArcLend FlashLoanPool
/// @notice Uncollateralized flash loans funded by LP deposits.
///         Fees are split between the protocol treasury and LPs.
///         Completely independent of LendingPool reserves -- redeploying
///         this contract does NOT affect lending market liquidity.
contract FlashLoanPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Maximum treasury share: 50% (protects LP yield).
    uint256 public constant MAX_TREASURY_SHARE_BPS = 5_000;

    /// @notice Default flash loan fee in basis points (0.09%).
    ///         Kept lower than SwapPool because flash loans are atomic
    ///         (no impermanent-loss risk for LPs).
    uint256 public feeBps = 9;

    // ─── Treasury ─────────────────────────────────────────────────────

    address public treasury;
    /// @notice Share of each flash loan fee routed to Treasury.
    ///         Default 2000 = 20% of the fee. The remaining 80% stays
    ///         in the pool, accruing value to LPs.
    uint256 public treasuryShareBps = 2000;

    // ─── Liquidity tracking ───────────────────────────────────────────

    /// @notice Per-asset LP positions: lpBalance[asset][provider].
    mapping(address => mapping(address => uint256)) public lpBalance;
    /// @notice Per-asset total LP tokens outstanding.
    mapping(address => uint256) public totalLpSupply;
    /// @notice Per-asset tracked LP value (increases when net fees accrue).
    mapping(address => uint256) public totalLiquidity;

    // ─── Supported assets (owner-maintained allowlist) ────────────────

    mapping(address => bool) public allowedAsset;

    // ─── Events ───────────────────────────────────────────────────────

    event LiquidityDeposited(
        address indexed asset,
        address indexed provider,
        uint256 amount,
        uint256 lpTokens
    );
    event LiquidityWithdrawn(
        address indexed asset,
        address indexed provider,
        uint256 amount,
        uint256 lpTokens
    );
    event FlashLoan(
        address indexed initiator,
        address indexed asset,
        uint256 amount,
        uint256 fee,
        uint256 treasuryCut
    );
    event FeeBpsUpdated(uint256 feeBps);
    event TreasuryShareUpdated(uint256 treasuryShareBps);
    event TreasuryUpdated(address treasury);
    event AssetAllowed(address indexed asset, bool allowed);

    constructor(address owner_) Ownable(owner_) {
        require(owner_ != address(0), "FlashLoanPool: zero owner");
    }

    // ─── Owner administration ─────────────────────────────────────────

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 100, "FlashLoanPool: fee too high"); // 1% max
        feeBps = newFeeBps;
        emit FeeBpsUpdated(newFeeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setTreasuryShareBps(uint256 newShareBps) external onlyOwner {
        require(
            newShareBps <= MAX_TREASURY_SHARE_BPS,
            "Cannot exceed 50%"
        );
        treasuryShareBps = newShareBps;
        emit TreasuryShareUpdated(newShareBps);
    }

    function setAllowedAsset(address asset, bool allowed) external onlyOwner {
        allowedAsset[asset] = allowed;
        emit AssetAllowed(asset, allowed);
    }

    // ─── LP deposit / withdraw ────────────────────────────────────────

    /// @notice Deposit liquidity into the flash loan pool.
    function depositLiquidity(
        address asset,
        uint256 amount
    ) external nonReentrant returns (uint256 lpTokens) {
        require(allowedAsset[asset], "FlashLoanPool: asset not allowed");
        require(amount > 0, "FlashLoanPool: zero deposit");

        uint256 supply = totalLpSupply[asset];
        uint256 liquidity = totalLiquidity[asset];

        if (supply == 0) {
            lpTokens = amount;
            totalLiquidity[asset] = amount;
        } else {
            lpTokens = (amount * supply) / liquidity;
            totalLiquidity[asset] = liquidity + amount;
        }

        lpBalance[asset][msg.sender] += lpTokens;
        totalLpSupply[asset] = supply + lpTokens;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        emit LiquidityDeposited(asset, msg.sender, amount, lpTokens);
    }

    /// @notice Withdraw liquidity from the flash loan pool.
    function withdrawLiquidity(
        address asset,
        uint256 lpTokens
    ) external nonReentrant returns (uint256 amount) {
        require(lpTokens > 0, "FlashLoanPool: zero LP");
        uint256 userBalance = lpBalance[asset][msg.sender];
        require(userBalance >= lpTokens, "FlashLoanPool: insufficient LP");

        uint256 supply = totalLpSupply[asset];
        uint256 liquidity = totalLiquidity[asset];

        amount = (lpTokens * liquidity) / supply;

        lpBalance[asset][msg.sender] = userBalance - lpTokens;
        totalLpSupply[asset] = supply - lpTokens;
        totalLiquidity[asset] = liquidity - amount;

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(asset, msg.sender, amount, lpTokens);
    }

    // ─── Flash loan ───────────────────────────────────────────────────

    /// @notice Execute an uncollateralized flash loan.
    /// @param asset   The ERC-20 to borrow.
    /// @param amount  Amount to borrow.
    /// @param params  Passed through to receiver's executeOperation.
    function flashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external nonReentrant {
        require(allowedAsset[asset], "FlashLoanPool: asset not allowed");
        require(amount > 0, "FlashLoanPool: zero amount");

        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        // Ensure pool has enough liquidity (accounting for LPs that may
        // withdraw between now and the loan — the check is advisory but
        // the repayment invariant below is the real safety guarantee).
        require(balanceBefore >= amount, "FlashLoanPool: insufficient liquidity");

        uint256 fee = (amount * feeBps) / BPS_DENOMINATOR;

        // Transfer the requested amount to the caller.
        IERC20(asset).safeTransfer(msg.sender, amount);

        // Execute the receiver's operation.
        require(
            IFlashLoanReceiver(msg.sender).executeOperation(
                asset,
                amount,
                fee,
                msg.sender,
                params
            ),
            "FlashLoanPool: callback failed"
        );

        // ─── Core safety invariant ────────────────────────────────────
        // The receiver MUST return `amount + fee` (or more). This check
        // is the sole security guarantee — it cannot be weakened.
        uint256 balanceAfter = IERC20(asset).balanceOf(address(this));
        require(
            balanceAfter >= balanceBefore + fee,
            "FlashLoanPool: repayment insufficient"
        );

        // ─── Fee split: treasury vs LPs ──────────────────────────────
        uint256 treasuryCut = (fee * treasuryShareBps) / BPS_DENOMINATOR;
        if (treasuryCut > 0 && treasury != address(0)) {
            IERC20(asset).approve(treasury, treasuryCut);
            ITreasury(treasury).deposit(asset, treasuryCut, "FlashLoanPool");
        }

        // LP value increases by the fee minus the treasury cut.
        // `balanceAfter` already includes `amount + fee` (plus any excess
        // the receiver sent). We subtract `treasuryCut` because that
        // portion has been forwarded out.
        totalLiquidity[asset] = balanceAfter - treasuryCut;

        emit FlashLoan(msg.sender, asset, amount, fee, treasuryCut);
    }

    // ─── Views ────────────────────────────────────────────────────────

    /// @notice Compute the flash loan fee for a given amount.
    function getFlashLoanFee(
        address, /* asset — feeBps is global, reserved for per-asset override */
        uint256 amount
    ) external view returns (uint256) {
        return (amount * feeBps) / BPS_DENOMINATOR;
    }

    /// @notice Maximum flash loan amount currently available.
    function maxFlashLoan(address asset) external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }
}
