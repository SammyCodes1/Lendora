// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Lendora Interest-Bearing Token
/// @notice Represents a lender's indexed claim on a 6-decimal reserve asset.
contract AToken is ERC20, Ownable {
    uint256 public constant RAY = 1e27;

    address public immutable underlyingAsset;
    address public immutable pool;
    uint256 public liquidityIndex = RAY;

    mapping(address => uint256) private scaledBalances;
    uint256 private scaledTotalSupply;

    event LiquidityIndexUpdated(uint256 previousIndex, uint256 newIndex);
    event LiquidityLossApplied(uint256 previousIndex, uint256 newIndex);

    modifier onlyPool() {
        require(msg.sender == pool, "AToken: caller is not pool");
        _;
    }

    /// @notice Creates an indexed supply token for a reserve.
    /// @param underlyingAsset_ Underlying 6-decimal ERC-20 reserve asset.
    /// @param pool_ LendingPool authorized to mint, burn, and update the index.
    constructor(address underlyingAsset_, address pool_) ERC20("Lendora Interest Bearing Token", "aLNDR") Ownable(msg.sender) {
        require(underlyingAsset_ != address(0), "AToken: zero underlying");
        require(pool_ != address(0), "AToken: zero pool");

        underlyingAsset = underlyingAsset_;
        pool = pool_;
    }

    /// @notice Returns the token precision, matching Arc stablecoin ERC-20 interfaces.
    /// @return Number of decimals, always 6.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Returns an account balance including accrued supply interest.
    /// @param account Account to query.
    /// @return Indexed token balance.
    function balanceOf(address account) public view override returns (uint256) {
        return (scaledBalances[account] * liquidityIndex) / RAY;
    }

    /// @notice Returns total supply including accrued supply interest.
    /// @return Indexed total token supply.
    function totalSupply() public view override returns (uint256) {
        return (scaledTotalSupply * liquidityIndex) / RAY;
    }

    /// @notice Returns an account's internal scaled balance.
    /// @param account Account to query.
    /// @return Internal scaled balance.
    function scaledBalanceOf(address account) external view returns (uint256) {
        return scaledBalances[account];
    }

    /// @notice Returns the internal scaled total supply.
    /// @return Internal scaled total supply.
    function scaledTotalSupplyOf() external view returns (uint256) {
        return scaledTotalSupply;
    }

    /// @notice Mints an indexed claim for newly supplied liquidity.
    /// @param to Account receiving the aTokens.
    /// @param amount Underlying amount in 6-decimal asset units.
    /// @param index Current reserve liquidity index in ray precision.
    function mint(address to, uint256 amount, uint256 index) external onlyPool returns (uint256 actualAmount) {
        require(to != address(0), "AToken: mint to zero");
        require(amount > 0, "AToken: zero amount");
        require(index > 0, "AToken: invalid index");

        updateLiquidityIndex(index);

        uint256 balanceBefore = balanceOf(to);
        uint256 scaledAmount = (amount * RAY) / liquidityIndex;
        require(scaledAmount > 0, "AToken: scaled amount zero");

        scaledBalances[to] += scaledAmount;
        scaledTotalSupply += scaledAmount;

        actualAmount = balanceOf(to) - balanceBefore;
        emit Transfer(address(0), to, actualAmount);
    }

    /// @notice Burns an indexed claim when liquidity is withdrawn or seized.
    /// @param from Account whose aTokens are burned.
    /// @param amount Underlying amount in 6-decimal asset units.
    /// @param index Current reserve liquidity index in ray precision.
    function burn(address from, uint256 amount, uint256 index) external onlyPool returns (uint256 actualAmount) {
        require(from != address(0), "AToken: burn from zero");
        require(amount > 0, "AToken: zero amount");
        require(index > 0, "AToken: invalid index");

        updateLiquidityIndex(index);

        uint256 indexedBalance = balanceOf(from);
        uint256 scaledAmount = amount >= indexedBalance
            ? scaledBalances[from]
            : (amount * RAY) / liquidityIndex;
        require(scaledAmount > 0, "AToken: scaled amount zero");
        require(scaledBalances[from] >= scaledAmount, "AToken: burn exceeds balance");

        scaledBalances[from] -= scaledAmount;
        scaledTotalSupply -= scaledAmount;

        actualAmount = indexedBalance - balanceOf(from);
        emit Transfer(from, address(0), actualAmount);
    }

    /// @notice Moves an indexed supplier claim during liquidation without requiring underlying liquidity.
    function transferOnLiquidation(
        address from,
        address to,
        uint256 amount,
        uint256 index
    ) external onlyPool returns (uint256 actualAmount) {
        require(from != address(0) && to != address(0), "AToken: zero account");
        require(from != to, "AToken: same account");
        require(amount > 0, "AToken: zero amount");
        updateLiquidityIndex(index);

        uint256 indexedBalance = balanceOf(from);
        uint256 scaledAmount = amount >= indexedBalance
            ? scaledBalances[from]
            : (amount * RAY) / liquidityIndex;
        require(scaledAmount > 0, "AToken: scaled amount zero");
        require(scaledBalances[from] >= scaledAmount, "AToken: transfer exceeds balance");

        uint256 balanceBefore = balanceOf(from);
        scaledBalances[from] -= scaledAmount;
        scaledBalances[to] += scaledAmount;
        actualAmount = balanceBefore - balanceOf(from);
        emit Transfer(from, to, actualAmount);
    }

    /// @notice Advances the reserve liquidity index.
    /// @param newIndex New non-decreasing liquidity index in ray precision.
    function updateLiquidityIndex(uint256 newIndex) public onlyPool {
        require(newIndex >= liquidityIndex, "AToken: index regression");
        uint256 previousIndex = liquidityIndex;
        liquidityIndex = newIndex;
        if (newIndex != previousIndex) {
            emit LiquidityIndexUpdated(previousIndex, newIndex);
        }
    }

    /// @notice Socializes unrecoverable reserve debt across all suppliers.
    /// @param newIndex Reduced liquidity index after applying the reserve loss.
    function applyLiquidityLoss(uint256 newIndex) external onlyPool {
        require(newIndex > 0 && newIndex < liquidityIndex, "AToken: invalid loss index");
        uint256 previousIndex = liquidityIndex;
        liquidityIndex = newIndex;
        emit LiquidityLossApplied(previousIndex, newIndex);
    }

    /// @notice aTokens are non-transferable because collateral movement must be validated by the pool.
    /// @param to Ignored destination.
    /// @param amount Ignored amount.
    /// @return Always reverts.
    function transfer(address to, uint256 amount) public pure override returns (bool) {
        if (to == address(0) && amount == type(uint256).max) {
            revert("AToken: non-transferable");
        }
        revert("AToken: non-transferable");
    }

    /// @notice aToken allowances are disabled because balances are non-transferable.
    function approve(address spender, uint256 amount) public pure override returns (bool) {
        if (spender == address(0) && amount == type(uint256).max) {
            revert("AToken: non-transferable");
        }
        revert("AToken: non-transferable");
    }

    /// @notice aTokens are non-transferable by allowance because collateral movement must be validated by the pool.
    /// @param from Ignored source.
    /// @param to Ignored destination.
    /// @param amount Ignored amount.
    /// @return Always reverts.
    function transferFrom(address from, address to, uint256 amount) public pure override returns (bool) {
        if (from == address(0) && to == address(0) && amount == type(uint256).max) {
            revert("AToken: non-transferable");
        }
        revert("AToken: non-transferable");
    }

}
