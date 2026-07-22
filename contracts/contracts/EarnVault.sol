// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IEarnVaultAToken {
    function scaledBalanceOf(address account) external view returns (uint256);
}

interface IEarnVaultInterestRateModel {
    function calculateSupplyRate(uint256 totalBorrowed, uint256 totalLiquidity) external pure returns (uint256);
}

interface IEarnVaultLendingPool {
    struct ReserveData {
        address aToken;
        address debtToken;
        address underlyingAsset;
        uint256 liquidityIndex;
        uint256 borrowIndex;
        uint256 lastUpdateTimestamp;
        uint128 totalLiquidity;
        uint128 totalBorrowed;
        uint16 ltv;
        uint16 liquidationThreshold;
        uint16 liquidationBonus;
        bool isActive;
        bool isBorrowingEnabled;
        bool isCollateralEnabled;
    }

    function getReserveData(address asset) external view returns (ReserveData memory);
    function interestRateModel() external view returns (address);
    function supply(address asset, uint256 amount, address onBehalfOf) external;
    function withdraw(address asset, uint256 amount, address to) external;
}

/// @title ArcLend Earn Vault
/// @notice Accepts one stablecoin, supplies it into ArcLend, and mints shares backed by lending yield.
contract EarnVault is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant RAY = 1e27;
    uint256 public constant VIRTUAL_ASSETS = 1e6;
    uint256 public constant VIRTUAL_SHARES = 1e6;
    uint256 public constant MINIMUM_DEPOSIT = 1e6;

    IERC20 public immutable asset;
    IEarnVaultLendingPool public immutable lendingPool;
    IEarnVaultAToken public immutable aToken;
    uint8 private immutable assetDecimals;

    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event RewardsAdded(address indexed caller, uint256 assets);

    constructor(
        address asset_,
        address lendingPool_,
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        require(asset_ != address(0), "EarnVault: zero asset");
        require(lendingPool_ != address(0), "EarnVault: zero pool");
        require(owner_ != address(0), "EarnVault: zero owner");

        IEarnVaultLendingPool pool = IEarnVaultLendingPool(lendingPool_);
        IEarnVaultLendingPool.ReserveData memory reserve = pool.getReserveData(asset_);
        require(reserve.isActive, "EarnVault: inactive reserve");
        require(reserve.aToken != address(0), "EarnVault: missing aToken");
        require(reserve.underlyingAsset == asset_, "EarnVault: asset mismatch");

        asset = IERC20(asset_);
        lendingPool = pool;
        aToken = IEarnVaultAToken(reserve.aToken);
        assetDecimals = IERC20Metadata(asset_).decimals();
    }

    function decimals() public view override returns (uint8) {
        return assetDecimals;
    }

    /// @notice Current vault assets including virtual accrued lending interest.
    function totalAssets() public view returns (uint256) {
        IEarnVaultLendingPool.ReserveData memory reserve = lendingPool.getReserveData(address(asset));
        uint256 liquidityIndex = reserve.liquidityIndex;
        uint256 timeDelta = block.timestamp - reserve.lastUpdateTimestamp;

        if (timeDelta > 0) {
            address rateModel = lendingPool.interestRateModel();
            uint256 supplyRatePerSecond = IEarnVaultInterestRateModel(rateModel).calculateSupplyRate(
                reserve.totalBorrowed,
                reserve.totalLiquidity
            );
            uint256 supplyGrowth = RAY + (supplyRatePerSecond * timeDelta);
            liquidityIndex = (liquidityIndex * supplyGrowth) / RAY;
        }

        uint256 suppliedAssets = (aToken.scaledBalanceOf(address(this)) * liquidityIndex) / RAY;
        return suppliedAssets + asset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return _convertToShares(assets, totalAssets(), totalSupply(), false);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return _convertToAssets(shares, totalAssets(), totalSupply(), false);
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return _convertToShares(assets, totalAssets(), totalSupply(), true);
    }

    function availableAssets() public view returns (uint256) {
        return asset.balanceOf(address(this)) + asset.balanceOf(address(lendingPool));
    }

    function maxWithdraw(address owner_) external view returns (uint256) {
        uint256 userAssets = convertToAssets(balanceOf(owner_));
        uint256 liquidAssets = availableAssets();
        return userAssets < liquidAssets ? userAssets : liquidAssets;
    }

    function maxRedeem(address owner_) external view returns (uint256) {
        uint256 userShares = balanceOf(owner_);
        uint256 userAssets = convertToAssets(userShares);
        uint256 liquidAssets = availableAssets();
        if (userAssets <= liquidAssets) {
            return userShares;
        }
        return _convertToShares(liquidAssets, totalAssets(), totalSupply(), false);
    }

    function deposit(uint256 assets, address receiver) external nonReentrant returns (uint256 shares) {
        return _deposit(assets, receiver, 0);
    }

    function deposit(
        uint256 assets,
        address receiver,
        uint256 minShares
    ) external nonReentrant returns (uint256 shares) {
        return _deposit(assets, receiver, minShares);
    }

    function _deposit(uint256 assets, address receiver, uint256 minShares) internal returns (uint256 shares) {
        require(receiver != address(0), "EarnVault: zero receiver");
        require(assets >= MINIMUM_DEPOSIT, "EarnVault: deposit below minimum");

        uint256 managedAssets = totalAssets();
        uint256 shareSupply = totalSupply();
        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), assets);
        uint256 received = asset.balanceOf(address(this)) - balanceBefore;
        require(received >= MINIMUM_DEPOSIT, "EarnVault: received below minimum");

        shares = _convertToShares(received, managedAssets, shareSupply, false);
        require(shares > 0, "EarnVault: zero shares");
        require(shares >= minShares, "EarnVault: insufficient shares");

        asset.forceApprove(address(lendingPool), received);
        lendingPool.supply(address(asset), received, address(this));

        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, received, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner_) external nonReentrant returns (uint256 shares) {
        require(receiver != address(0), "EarnVault: zero receiver");
        require(owner_ != address(0), "EarnVault: zero owner");
        require(assets > 0, "EarnVault: zero assets");

        shares = _convertToShares(assets, totalAssets(), totalSupply(), true);
        require(shares > 0, "EarnVault: zero shares");
        if (msg.sender != owner_) {
            _spendAllowance(owner_, msg.sender, shares);
        }

        _burn(owner_, shares);
        _withdrawAssets(assets, receiver);
        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address owner_) external nonReentrant returns (uint256 assets) {
        require(receiver != address(0), "EarnVault: zero receiver");
        require(owner_ != address(0), "EarnVault: zero owner");
        require(shares > 0, "EarnVault: zero shares");
        if (msg.sender != owner_) {
            _spendAllowance(owner_, msg.sender, shares);
        }

        assets = _convertToAssets(shares, totalAssets(), totalSupply(), false);
        require(assets > 0, "EarnVault: zero assets");

        _burn(owner_, shares);
        _withdrawAssets(assets, receiver);
        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
    }

    /// @notice Adds protocol fee rewards to existing share holders without minting new shares.
    function depositRewards(uint256 assets) external onlyOwner nonReentrant {
        require(assets > 0, "EarnVault: zero assets");

        uint256 balanceBefore = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), assets);
        uint256 received = asset.balanceOf(address(this)) - balanceBefore;
        require(received > 0, "EarnVault: no rewards received");
        asset.forceApprove(address(lendingPool), received);
        lendingPool.supply(address(asset), received, address(this));

        emit RewardsAdded(msg.sender, received);
    }

    function _convertToShares(
        uint256 assets,
        uint256 managedAssets,
        uint256 shareSupply,
        bool roundUp
    ) internal pure returns (uint256) {
        uint256 adjustedSupply = shareSupply + VIRTUAL_SHARES;
        uint256 adjustedAssets = managedAssets + VIRTUAL_ASSETS;
        uint256 numerator = assets * adjustedSupply;
        return roundUp ? (numerator + adjustedAssets - 1) / adjustedAssets : numerator / adjustedAssets;
    }

    function _convertToAssets(
        uint256 shares,
        uint256 managedAssets,
        uint256 shareSupply,
        bool roundUp
    ) internal pure returns (uint256) {
        uint256 adjustedSupply = shareSupply + VIRTUAL_SHARES;
        uint256 adjustedAssets = managedAssets + VIRTUAL_ASSETS;
        uint256 numerator = shares * adjustedAssets;
        return roundUp ? (numerator + adjustedSupply - 1) / adjustedSupply : numerator / adjustedSupply;
    }

    function _withdrawAssets(uint256 assets, address receiver) internal {
        uint256 idleAssets = asset.balanceOf(address(this));
        uint256 idleToUse = assets < idleAssets ? assets : idleAssets;
        if (idleToUse > 0) {
            asset.safeTransfer(receiver, idleToUse);
        }
        uint256 remaining = assets - idleToUse;
        if (remaining > 0) {
            lendingPool.withdraw(address(asset), remaining, receiver);
        }
    }
}
