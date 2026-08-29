// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ITreasury {
    function deposit(
        address asset,
        uint256 amount,
        string calldata source
    ) external;
}

/// @title ArcLend SwapPool
/// @notice Constant-product AMM (x * y = k) for a single USDC/EURC pair.
///         Completely independent of LendingPool / FlashLoanPool reserves.
///         LP shares are an ERC-20 (ALP-USDC-EURC).
contract SwapPool is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// @notice Hard cap for swap fee (1.00%). Matches FlashLoanPool-style sanity bound.
    uint256 public constant MAX_FEE_BPS = 100;
    /// @notice Maximum treasury share: 50% (protects LP yield).
    uint256 public constant MAX_TREASURY_SHARE_BPS = 5_000;

    IERC20 public immutable tokenA; // USDC
    IERC20 public immutable tokenB; // EURC

    uint256 public reserveA;
    uint256 public reserveB;
    /// @notice Swap fee in basis points. Default 30 = 0.30%.
    uint256 public feeBps = 30;

    // ─── Treasury ─────────────────────────────────────────────────────

    /// @notice Protocol treasury address for fee revenue.
    address public treasury;
    /// @notice Share of swap fees routed to Treasury.
    ///         Default 1500 = 15% of the fee. Slightly lower than
    ///         FlashLoanPool because swap LPs take on more ongoing
    ///         impermanent-loss-style risk than flash loan LPs do.
    uint256 public treasuryShareBps = 1500;

    // ─── Events ───────────────────────────────────────────────────────

    event LiquidityAdded(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpTokens
    );
    event LiquidityRemoved(
        address indexed provider,
        uint256 amountA,
        uint256 amountB,
        uint256 lpTokens
    );
    event Swap(
        address indexed user,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );
    event FeeBpsUpdated(uint256 feeBps);
    event TreasuryUpdated(address treasury);
    event TreasuryShareUpdated(uint256 treasuryShareBps);

    constructor(
        address _tokenA,
        address _tokenB,
        address owner_
    ) ERC20("Lendora Swap LP", "ALP-USDC-EURC") Ownable(owner_) {
        require(_tokenA != address(0) && _tokenB != address(0), "SwapPool: zero token");
        require(_tokenA != _tokenB, "SwapPool: identical tokens");
        require(owner_ != address(0), "SwapPool: zero owner");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    /// @notice Match USDC/EURC 6-decimal scale so initial sqrt(amountA*amountB) LP units are human-readable.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ─── Owner administration ─────────────────────────────────────────

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_FEE_BPS, "SwapPool: fee too high");
        feeBps = newFeeBps;
        emit FeeBpsUpdated(newFeeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setTreasuryShareBps(uint256 newShareBps) external onlyOwner {
        require(newShareBps <= MAX_TREASURY_SHARE_BPS, "Cannot exceed 50%");
        treasuryShareBps = newShareBps;
        emit TreasuryShareUpdated(newShareBps);
    }

    // ─── Liquidity ────────────────────────────────────────────────────

    /// @notice Deposit both assets and mint LP shares.
    /// @dev Subsequent deposits must match the current reserve ratio. Excess of
    ///      the non-binding side is refunded (standard AMM deposit behavior).
    function addLiquidity(
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 minLpTokens
    ) external nonReentrant returns (uint256 lpTokens) {
        require(amountADesired > 0 && amountBDesired > 0, "SwapPool: zero deposit");

        uint256 amountA = amountADesired;
        uint256 amountB = amountBDesired;
        uint256 supply = totalSupply();

        if (supply == 0) {
            // Initial liquidity: geometric mean of deposited amounts.
            lpTokens = _sqrt(amountA * amountB);
            require(lpTokens > 0, "SwapPool: insufficient initial liquidity");
        } else {
            // Proportional deposit — use the binding side; refund excess of the other.
            uint256 amountBOptimal = (amountADesired * reserveB) / reserveA;
            if (amountBOptimal <= amountBDesired) {
                amountB = amountBOptimal;
            } else {
                uint256 amountAOptimal = (amountBDesired * reserveA) / reserveB;
                require(amountAOptimal <= amountADesired, "SwapPool: insufficient A");
                amountA = amountAOptimal;
            }

            uint256 lpFromA = (amountA * supply) / reserveA;
            uint256 lpFromB = (amountB * supply) / reserveB;
            lpTokens = lpFromA < lpFromB ? lpFromA : lpFromB;
            require(lpTokens > 0, "SwapPool: zero LP");
        }

        require(lpTokens >= minLpTokens, "Slippage: LP tokens below minimum");

        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        reserveA += amountA;
        reserveB += amountB;
        _mint(msg.sender, lpTokens);

        emit LiquidityAdded(msg.sender, amountA, amountB, lpTokens);
    }

    /// @notice Burn LP shares and withdraw proportional reserves.
    function removeLiquidity(
        uint256 lpTokens,
        uint256 minAmountA,
        uint256 minAmountB
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(lpTokens > 0, "SwapPool: zero LP");
        uint256 supply = totalSupply();
        require(supply > 0, "SwapPool: no liquidity");

        amountA = (lpTokens * reserveA) / supply;
        amountB = (lpTokens * reserveB) / supply;
        require(amountA >= minAmountA && amountB >= minAmountB, "Slippage: below minimum");

        _burn(msg.sender, lpTokens);
        reserveA -= amountA;
        reserveB -= amountB;

        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);

        emit LiquidityRemoved(msg.sender, amountA, amountB, lpTokens);
    }

    // ─── Swap ─────────────────────────────────────────────────────────

    /// @notice Swap exact input for the other asset, subject to minAmountOut.
    ///         A share of the collected fee is routed to the protocol Treasury;
    ///         the rest stays in the pool for LPs.
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external nonReentrant returns (uint256 amountOut) {
        require(tokenIn == address(tokenA) || tokenIn == address(tokenB), "Invalid token");
        require(amountIn > 0, "SwapPool: zero input");

        bool isTokenA = tokenIn == address(tokenA);
        (uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (reserveA, reserveB)
            : (reserveB, reserveA);
        require(reserveIn > 0 && reserveOut > 0, "SwapPool: empty pool");

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= minAmountOut, "Slippage: output below minimum");
        require(amountOut < reserveOut, "SwapPool: insufficient liquidity");

        // Transfer tokens.
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        address tokenOut = isTokenA ? address(tokenB) : address(tokenA);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        // ─── Fee split: treasury vs LPs ──────────────────────────────
        // The fee is collected implicitly (less tokenOut for the same
        // tokenIn). We route the treasury's share from the input-side
        // reserve so the pool invariant stays consistent.
        uint256 fee = (amountIn * feeBps) / BPS_DENOMINATOR;
        uint256 treasuryCut = (fee * treasuryShareBps) / BPS_DENOMINATOR;

        if (treasuryCut > 0 && treasury != address(0)) {
            IERC20(tokenIn).approve(treasury, treasuryCut);
            ITreasury(treasury).deposit(tokenIn, treasuryCut, "SwapPool");
        }

        // Update reserves. The treasury cut is deducted from the input
        // side because it was forwarded out of the pool. The LP share
        // of the fee (fee - treasuryCut) stays in reserves, increasing k.
        if (isTokenA) {
            reserveA = reserveA + amountIn - treasuryCut;
            reserveB -= amountOut;
        } else {
            reserveB = reserveB + amountIn - treasuryCut;
            reserveA -= amountOut;
        }

        // Invariant: reserves product must not decrease (k is non-decreasing
        // after fees minus treasury cut). The LP share of the fee ensures
        // this still holds.
        uint256 kBefore = reserveIn * reserveOut;
        require(reserveA * reserveB >= kBefore, "SwapPool: K");

        emit Swap(msg.sender, tokenIn, amountIn, tokenOut, amountOut);
    }

    // ─── Views ────────────────────────────────────────────────────────

    /// @notice View quote for an exact-input swap (frontend / routing).
    function getQuote(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        if (tokenIn != address(tokenA) && tokenIn != address(tokenB)) return 0;

        bool isTokenA = tokenIn == address(tokenA);
        (uint256 reserveIn, uint256 reserveOut) = isTokenA
            ? (reserveA, reserveB)
            : (reserveB, reserveA);
        if (reserveIn == 0 || reserveOut == 0) return 0;

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        if (amountOut >= reserveOut) return 0;
    }

    // ─── Internals ────────────────────────────────────────────────────

    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal view returns (uint256) {
        uint256 amountInWithFee = amountIn * (BPS_DENOMINATOR - feeBps);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * BPS_DENOMINATOR + amountInWithFee;
        return numerator / denominator;
    }

    /// @dev Babylonian square root (Uniswap V2 style).
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
