// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IInterestRateModel {
    function calculateBorrowRate(uint256 totalBorrowed, uint256 totalLiquidity) external pure returns (uint256);
    function calculateSupplyRate(uint256 totalBorrowed, uint256 totalLiquidity) external pure returns (uint256);
}

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256 price, uint8 decimals);
}

interface IAToken {
    function mint(address to, uint256 amount, uint256 liquidityIndex) external returns (uint256 actualAmount);
    function burn(address from, uint256 amount, uint256 liquidityIndex) external returns (uint256 actualAmount);
    function updateLiquidityIndex(uint256 newIndex) external;
    function applyLiquidityLoss(uint256 newIndex) external;
    function transferOnLiquidation(
        address from,
        address to,
        uint256 amount,
        uint256 liquidityIndex
    ) external returns (uint256 actualAmount);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function scaledBalanceOf(address account) external view returns (uint256);
    function underlyingAsset() external view returns (address);
    function pool() external view returns (address);
    function decimals() external view returns (uint8);
}

interface IDebtToken {
    function mint(address to, uint256 amount, uint256 borrowIndex) external returns (uint256 actualAmount);
    function burn(address from, uint256 amount, uint256 borrowIndex) external returns (uint256 actualAmount);
    function updateBorrowIndex(uint256 newIndex) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function scaledBalanceOf(address account) external view returns (uint256);
    function underlyingAsset() external view returns (address);
    function pool() external view returns (address);
    function decimals() external view returns (uint8);
}

/// @title ArcLend Lending Pool
/// @notice Core Arc Testnet lending market for supplying, borrowing, repaying, withdrawing, and liquidating 6-decimal stablecoins.
contract LendingPool is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant RAY = 1e27;
    uint256 public constant WAD = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant ASSET_UNIT = 1e6;
    uint256 public constant CLOSE_FACTOR_BPS = 5_000;
    uint256 public constant MAX_RESERVES = 16;

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

    struct UserAccountData {
        uint256 totalCollateralUSD;
        uint256 totalDebtUSD;
        uint256 availableBorrowsUSD;
        uint256 healthFactor;
    }

    mapping(address => ReserveData) public reserves;
    address[] public reservesList;
    mapping(address => mapping(address => bool)) public userCollateralEnabled;
    mapping(address => mapping(address => bool)) public borrowDelegates;
    mapping(address => uint256) public supplyCaps;
    mapping(address => uint256) public borrowCaps;

    IInterestRateModel public interestRateModel;
    IPriceOracle public priceOracle;
    IPriceOracle public fallbackPriceOracle;

    event ReserveInitialized(
        address indexed asset,
        address indexed aToken,
        address indexed debtToken,
        uint16 ltv,
        uint16 liquidationThreshold,
        uint16 liquidationBonus
    );
    event Supply(address indexed asset, address indexed user, address indexed onBehalfOf, uint256 amount);
    event Withdraw(address indexed asset, address indexed user, address indexed to, uint256 amount);
    event Borrow(address indexed asset, address indexed user, address indexed onBehalfOf, uint256 amount);
    event Repay(address indexed asset, address indexed payer, address indexed onBehalfOf, uint256 amount);
    event LiquidationCall(
        address indexed collateralAsset,
        address indexed debtAsset,
        address indexed user,
        uint256 debtCovered,
        uint256 collateralSeized,
        address liquidator
    );
    event ReserveUsedAsCollateralEnabled(address indexed asset, address indexed user);
    event ReserveUsedAsCollateralDisabled(address indexed asset, address indexed user);
    event ReserveInterestAccrued(
        address indexed asset,
        uint256 liquidityIndex,
        uint256 borrowIndex,
        uint256 totalLiquidity,
        uint256 totalBorrowed
    );
    event PriceOracleUpdated(address indexed newOracle);
    event FallbackPriceOracleUpdated(address indexed newOracle);
    event InterestRateModelUpdated(address indexed newInterestRateModel);
    event BorrowDelegateUpdated(address indexed user, address indexed delegate, bool approved);
    event ReserveBorrowingUpdated(address indexed asset, bool enabled);
    event ReserveCollateralUpdated(address indexed asset, bool enabled);
    event ReserveRiskParametersUpdated(
        address indexed asset,
        uint16 ltv,
        uint16 liquidationThreshold,
        uint16 liquidationBonus
    );
    event ReserveCapsUpdated(address indexed asset, uint256 supplyCap, uint256 borrowCap);
    event LiquidationSettledInATokens(
        address indexed collateralAsset,
        address indexed user,
        address indexed liquidator,
        uint256 amount
    );
    event BadDebtWrittenOff(
        address indexed asset,
        address indexed user,
        uint256 debtWrittenOff,
        uint256 lenderLoss
    );

    /// @notice Creates the pool with its initial oracle and interest rate model.
    /// @param priceOracle_ Price oracle returning 8-decimal USD prices.
    /// @param interestRateModel_ Utilization-based interest rate model.
    constructor(address priceOracle_, address interestRateModel_) Ownable(msg.sender) {
        require(priceOracle_ != address(0), "LendingPool: zero oracle");
        require(interestRateModel_ != address(0), "LendingPool: zero rate model");

        priceOracle = IPriceOracle(priceOracle_);
        interestRateModel = IInterestRateModel(interestRateModel_);
    }

    /// @notice Registers a new 6-decimal ERC-20 reserve.
    /// @param asset Underlying reserve asset.
    /// @param aToken Interest-bearing supply token.
    /// @param debtToken Non-transferable variable debt token.
    /// @param ltv Maximum borrow basis points credited to collateral.
    /// @param liquidationThreshold Liquidation threshold in basis points.
    /// @param liquidationBonus Liquidator collateral bonus in basis points.
    function initReserve(
        address asset,
        address aToken,
        address debtToken,
        uint16 ltv,
        uint16 liquidationThreshold,
        uint16 liquidationBonus
    ) external onlyOwner nonReentrant whenNotPaused {
        require(asset != address(0), "LendingPool: zero asset");
        require(aToken != address(0), "LendingPool: zero aToken");
        require(debtToken != address(0), "LendingPool: zero debtToken");
        require(!reserves[asset].isActive, "LendingPool: reserve exists");
        require(reservesList.length < MAX_RESERVES, "LendingPool: reserve limit");
        require(ltv <= liquidationThreshold, "LendingPool: invalid ltv");
        require(liquidationThreshold <= BPS, "LendingPool: invalid threshold");
        require(liquidationBonus <= 2_000, "LendingPool: bonus too high");
        require(IAToken(aToken).underlyingAsset() == asset, "LendingPool: invalid aToken asset");
        require(IDebtToken(debtToken).underlyingAsset() == asset, "LendingPool: invalid debtToken asset");
        require(IAToken(aToken).pool() == address(this), "LendingPool: invalid aToken pool");
        require(IDebtToken(debtToken).pool() == address(this), "LendingPool: invalid debtToken pool");
        require(IAToken(aToken).decimals() == 6, "LendingPool: invalid aToken decimals");
        require(IDebtToken(debtToken).decimals() == 6, "LendingPool: invalid debtToken decimals");
        require(IERC20Metadata(asset).decimals() == 6, "LendingPool: invalid asset decimals");

        reserves[asset] = ReserveData({
            aToken: aToken,
            debtToken: debtToken,
            underlyingAsset: asset,
            liquidityIndex: RAY,
            borrowIndex: RAY,
            lastUpdateTimestamp: block.timestamp,
            totalLiquidity: 0,
            totalBorrowed: 0,
            ltv: ltv,
            liquidationThreshold: liquidationThreshold,
            liquidationBonus: liquidationBonus,
            isActive: true,
            isBorrowingEnabled: true,
            isCollateralEnabled: true
        });

        reservesList.push(asset);
        emit ReserveInitialized(asset, aToken, debtToken, ltv, liquidationThreshold, liquidationBonus);
    }

    /// @notice Supplies a reserve asset and mints indexed aTokens.
    /// @param asset Underlying 6-decimal ERC-20 reserve asset.
    /// @param amount Amount to supply in asset units.
    /// @param onBehalfOf Account receiving aTokens and collateral credit.
    function supply(address asset, uint256 amount, address onBehalfOf) external nonReentrant whenNotPaused {
        ReserveData storage reserve = _activeReserve(asset);
        require(onBehalfOf != address(0), "LendingPool: zero beneficiary");
        require(amount > 0, "LendingPool: zero amount");

        _accrueInterest(asset);

        uint256 supplyCap = supplyCaps[asset];
        require(
            supplyCap == 0 || IAToken(reserve.aToken).totalSupply() + amount <= supplyCap,
            "LendingPool: supply cap exceeded"
        );

        uint256 actualAmount = IAToken(reserve.aToken).mint(onBehalfOf, amount, reserve.liquidityIndex);
        _pullExact(asset, msg.sender, actualAmount);
        if (reserve.isCollateralEnabled) {
            userCollateralEnabled[onBehalfOf][asset] = true;
            emit ReserveUsedAsCollateralEnabled(asset, onBehalfOf);
        }

        reserve.totalLiquidity = _toUint128(IAToken(reserve.aToken).totalSupply());

        emit Supply(asset, msg.sender, onBehalfOf, actualAmount);
    }

    /// @notice Burns aTokens and withdraws reserve liquidity.
    /// @param asset Underlying reserve asset.
    /// @param amount Amount to withdraw in 6-decimal asset units.
    /// @param to Account receiving the underlying asset.
    function withdraw(address asset, uint256 amount, address to) external nonReentrant whenNotPaused {
        ReserveData storage reserve = _activeReserve(asset);
        require(to != address(0), "LendingPool: zero recipient");
        require(amount > 0, "LendingPool: zero amount");

        _accrueInterest(asset);

        uint256 userBalance = IAToken(reserve.aToken).balanceOf(msg.sender);
        require(userBalance >= amount, "LendingPool: insufficient aToken");
        require(IERC20(asset).balanceOf(address(this)) >= amount, "LendingPool: insufficient liquidity");

        uint256 actualAmount = IAToken(reserve.aToken).burn(msg.sender, amount, reserve.liquidityIndex);
        reserve.totalLiquidity = _toUint128(IAToken(reserve.aToken).totalSupply());

        if (_hasOutstandingDebt(msg.sender)) {
            require(getUserAccountData(msg.sender).healthFactor >= WAD, "LendingPool: health factor too low");
        }

        _pushExact(asset, to, actualAmount);

        if (IAToken(reserve.aToken).balanceOf(msg.sender) == 0) {
            userCollateralEnabled[msg.sender][asset] = false;
            emit ReserveUsedAsCollateralDisabled(asset, msg.sender);
        }

        emit Withdraw(asset, msg.sender, to, actualAmount);
    }

    /// @notice Borrows reserve liquidity against an account's enabled collateral.
    /// @param asset Underlying asset to borrow.
    /// @param amount Amount to borrow in 6-decimal asset units.
    /// @param onBehalfOf Account receiving the debt position.
    function borrow(address asset, uint256 amount, address onBehalfOf) external nonReentrant whenNotPaused {
        ReserveData storage reserve = _activeReserve(asset);
        require(reserve.isBorrowingEnabled, "LendingPool: borrowing disabled");
        require(onBehalfOf != address(0), "LendingPool: zero beneficiary");
        require(
            msg.sender == onBehalfOf || borrowDelegates[onBehalfOf][msg.sender],
            "LendingPool: unauthorized borrow"
        );
        require(amount > 0, "LendingPool: zero amount");
        require(IERC20(asset).balanceOf(address(this)) >= amount, "LendingPool: insufficient liquidity");

        _accrueInterest(asset);

        uint256 borrowCap = borrowCaps[asset];
        require(
            borrowCap == 0 || IDebtToken(reserve.debtToken).totalSupply() + amount <= borrowCap,
            "LendingPool: borrow cap exceeded"
        );

        UserAccountData memory accountData = getUserAccountData(onBehalfOf);
        uint256 borrowValueUSD = _assetToUSD(asset, amount);
        require(accountData.availableBorrowsUSD >= borrowValueUSD, "LendingPool: insufficient collateral");

        uint256 actualAmount = IDebtToken(reserve.debtToken).mint(onBehalfOf, amount, reserve.borrowIndex);
        reserve.totalBorrowed = _toUint128(IDebtToken(reserve.debtToken).totalSupply());

        // Explicit post-borrow HF check (defense in depth beyond LTV gate).
        require(
            getUserAccountData(onBehalfOf).healthFactor >= WAD,
            "LendingPool: health factor too low"
        );

        _pushExact(asset, msg.sender, actualAmount);

        emit Borrow(asset, msg.sender, onBehalfOf, actualAmount);
    }

    /// @notice Repays all or part of an account's reserve debt.
    /// @param asset Underlying debt asset.
    /// @param amount Maximum amount to repay in 6-decimal asset units.
    /// @param onBehalfOf Borrower whose debt is reduced.
    /// @return actualAmount Amount transferred and burned.
    function repay(
        address asset,
        uint256 amount,
        address onBehalfOf
    ) external nonReentrant returns (uint256 actualAmount) {
        ReserveData storage reserve = _activeReserve(asset);
        require(onBehalfOf != address(0), "LendingPool: zero beneficiary");
        require(amount > 0, "LendingPool: zero amount");

        _accrueInterest(asset);

        uint256 debt = IDebtToken(reserve.debtToken).balanceOf(onBehalfOf);
        require(debt > 0, "LendingPool: no debt");

        uint256 requestedAmount = amount > debt ? debt : amount;
        actualAmount = IDebtToken(reserve.debtToken).burn(onBehalfOf, requestedAmount, reserve.borrowIndex);
        _pullExact(asset, msg.sender, actualAmount);
        reserve.totalBorrowed = _toUint128(IDebtToken(reserve.debtToken).totalSupply());

        emit Repay(asset, msg.sender, onBehalfOf, actualAmount);
    }

    /// @notice Liquidates an unhealthy account by repaying debt in exchange for discounted collateral.
    /// @param collateralAsset Reserve asset seized from the borrower.
    /// @param debtAsset Reserve asset repaid by the liquidator.
    /// @param user Borrower being liquidated.
    /// @param debtToCover Maximum debt amount offered by the liquidator.
    function liquidate(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover
    ) external nonReentrant {
        _liquidate(collateralAsset, debtAsset, user, debtToCover, false);
    }

    /// @notice Liquidates an unhealthy account, optionally settling collateral as indexed aTokens.
    function liquidate(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external nonReentrant {
        _liquidate(collateralAsset, debtAsset, user, debtToCover, receiveAToken);
    }

    function _liquidate(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) internal {
        ReserveData storage collateralReserve = _activeReserve(collateralAsset);
        ReserveData storage debtReserve = _activeReserve(debtAsset);
        require(user != address(0), "LendingPool: zero user");
        require(user != msg.sender, "LendingPool: self liquidation");
        require(debtToCover > 0, "LendingPool: zero debt");
        require(
            userCollateralEnabled[user][collateralAsset],
            "LendingPool: asset is not user collateral"
        );

        _accrueInterest(collateralAsset);
        if (collateralAsset != debtAsset) {
            _accrueInterest(debtAsset);
        }

        UserAccountData memory accountData = getUserAccountData(user);
        require(accountData.healthFactor < WAD, "LendingPool: healthy account");

        uint256 userDebt = IDebtToken(debtReserve.debtToken).balanceOf(user);
        require(userDebt > 0, "LendingPool: no debt");

        uint256 maxDebtAmount = (userDebt * CLOSE_FACTOR_BPS) / BPS;
        if (maxDebtAmount == 0) {
            maxDebtAmount = 1;
        }

        uint256 actualDebtToCover = debtToCover;
        if (actualDebtToCover > userDebt) {
            actualDebtToCover = userDebt;
        }
        if (actualDebtToCover > maxDebtAmount) {
            actualDebtToCover = maxDebtAmount;
        }

        uint256 userCollateral = IAToken(collateralReserve.aToken).balanceOf(user);
        uint256 requestedDebtValueUSD = _assetToUSD(debtAsset, actualDebtToCover);
        uint256 requestedCollateralBaseAmount = _usdToAsset(collateralAsset, requestedDebtValueUSD);
        uint256 requestedCollateralToSeize =
            (requestedCollateralBaseAmount * (BPS + collateralReserve.liquidationBonus)) / BPS;
        if (requestedCollateralToSeize > userCollateral) {
            uint256 collateralBaseAvailable = (userCollateral * BPS) / (BPS + collateralReserve.liquidationBonus);
            uint256 collateralValueAvailableUSD = _assetToUSD(collateralAsset, collateralBaseAvailable);
            uint256 collateralBackedDebt = _usdToAsset(debtAsset, collateralValueAvailableUSD);
            if (actualDebtToCover > collateralBackedDebt) {
                actualDebtToCover = collateralBackedDebt;
            }
        }
        require(actualDebtToCover > 0, "LendingPool: debt not collateralized");

        actualDebtToCover = IDebtToken(debtReserve.debtToken).burn(
            user,
            actualDebtToCover,
            debtReserve.borrowIndex
        );
        uint256 debtValueUSD = _assetToUSD(debtAsset, actualDebtToCover);
        uint256 collateralBaseAmount = _usdToAsset(collateralAsset, debtValueUSD);
        uint256 collateralToSeize = (collateralBaseAmount * (BPS + collateralReserve.liquidationBonus)) / BPS;
        if (collateralToSeize > userCollateral) {
            collateralToSeize = userCollateral;
        } else if (collateralToSeize < userCollateral) {
            uint256 remainingCollateral = userCollateral - collateralToSeize;
            uint256 remainingDebtCapacity = _usdToAsset(
                debtAsset,
                _assetToUSD(collateralAsset, remainingCollateral)
            );
            uint256 minimumDebtBurn = (debtReserve.borrowIndex + RAY - 1) / RAY;
            if (remainingDebtCapacity < minimumDebtBurn) {
                collateralToSeize = userCollateral;
            }
        }
        require(collateralToSeize > 0, "LendingPool: no collateral");
        if (receiveAToken) {
            collateralToSeize = IAToken(collateralReserve.aToken).transferOnLiquidation(
                user,
                msg.sender,
                collateralToSeize,
                collateralReserve.liquidityIndex
            );
        } else {
            collateralToSeize = IAToken(collateralReserve.aToken).burn(
                user,
                collateralToSeize,
                collateralReserve.liquidityIndex
            );
            require(
                IERC20(collateralAsset).balanceOf(address(this)) >= collateralToSeize,
                "LendingPool: insufficient collateral liquidity"
            );
        }

        _pullExact(debtAsset, msg.sender, actualDebtToCover);

        debtReserve.totalBorrowed = _toUint128(IDebtToken(debtReserve.debtToken).totalSupply());
        collateralReserve.totalLiquidity = _toUint128(IAToken(collateralReserve.aToken).totalSupply());

        if (receiveAToken) {
            emit LiquidationSettledInATokens(collateralAsset, user, msg.sender, collateralToSeize);
        } else {
            _pushExact(collateralAsset, msg.sender, collateralToSeize);
        }

        if (IAToken(collateralReserve.aToken).balanceOf(user) == 0) {
            userCollateralEnabled[user][collateralAsset] = false;
            emit ReserveUsedAsCollateralDisabled(collateralAsset, user);
        }

        emit LiquidationCall(collateralAsset, debtAsset, user, actualDebtToCover, collateralToSeize, msg.sender);
    }

    /// @notice Writes off debt that has no remaining enabled collateral and socializes the loss to suppliers.
    /// @dev This is an explicit governance action and should only be used after liquidation has exhausted collateral.
    function writeOffBadDebt(address asset, address user) external onlyOwner nonReentrant {
        ReserveData storage reserve = _activeReserve(asset);
        require(user != address(0), "LendingPool: zero user");

        _accrueInterest(asset);
        UserAccountData memory accountData = getUserAccountData(user);
        require(accountData.totalDebtUSD > 0, "LendingPool: no bad debt");
        require(!_hasRemainingCollateral(user), "LendingPool: collateral remains");

        uint256 debt = IDebtToken(reserve.debtToken).balanceOf(user);
        require(debt > 0, "LendingPool: no reserve debt");

        uint256 oldLiquidity = reserve.totalLiquidity;
        uint256 debtWrittenOff = IDebtToken(reserve.debtToken).burn(user, debt, reserve.borrowIndex);
        reserve.totalBorrowed = _toUint128(IDebtToken(reserve.debtToken).totalSupply());

        uint256 targetLoss = debtWrittenOff > oldLiquidity ? oldLiquidity : debtWrittenOff;
        uint256 lenderLoss;
        if (targetLoss > 0 && oldLiquidity > 0) {
            uint256 targetLiquidity = oldLiquidity - targetLoss;
            uint256 newIndex = (reserve.liquidityIndex * targetLiquidity) / oldLiquidity;
            if (newIndex == 0) {
                newIndex = 1;
            }
            IAToken(reserve.aToken).applyLiquidityLoss(newIndex);
            reserve.liquidityIndex = newIndex;
            reserve.totalLiquidity = _toUint128(IAToken(reserve.aToken).totalSupply());
            lenderLoss = oldLiquidity - reserve.totalLiquidity;
        }

        emit BadDebtWrittenOff(asset, user, debtWrittenOff, lenderLoss);
    }

    /// @notice Enables or disables a supplied reserve as caller collateral.
    /// @param asset Reserve whose collateral setting is changed.
    /// @param useAsCollateral True to enable collateral use, false to disable it.
    function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external nonReentrant whenNotPaused {
        ReserveData storage reserve = _activeReserve(asset);
        if (useAsCollateral) {
            require(reserve.isCollateralEnabled, "LendingPool: collateral disabled");
        }

        userCollateralEnabled[msg.sender][asset] = useAsCollateral;

        require(getUserAccountData(msg.sender).healthFactor >= WAD, "LendingPool: health factor too low");

        if (useAsCollateral) {
            emit ReserveUsedAsCollateralEnabled(asset, msg.sender);
        } else {
            emit ReserveUsedAsCollateralDisabled(asset, msg.sender);
        }
    }

    /// @notice Allows or revokes another account's ability to borrow on caller's behalf.
    /// @param delegate Account allowed to initiate borrows that create debt for caller.
    /// @param approved True to approve, false to revoke.
    function setBorrowDelegate(address delegate, bool approved) external nonReentrant whenNotPaused {
        require(delegate != address(0), "LendingPool: zero delegate");
        borrowDelegates[msg.sender][delegate] = approved;
        emit BorrowDelegateUpdated(msg.sender, delegate, approved);
    }

    /// @notice Replaces the pool price oracle.
    /// @param newPriceOracle New oracle returning 8-decimal USD prices.
    function setPriceOracle(address newPriceOracle) external onlyOwner nonReentrant {
        require(newPriceOracle != address(0), "LendingPool: zero oracle");
        priceOracle = IPriceOracle(newPriceOracle);
        emit PriceOracleUpdated(newPriceOracle);
    }

    /// @notice Configures an independent oracle used when the primary oracle reverts or returns invalid data.
    function setFallbackPriceOracle(address newFallbackPriceOracle) external onlyOwner nonReentrant {
        require(newFallbackPriceOracle != address(priceOracle), "LendingPool: duplicate oracle");
        fallbackPriceOracle = IPriceOracle(newFallbackPriceOracle);
        emit FallbackPriceOracleUpdated(newFallbackPriceOracle);
    }

    /// @notice Replaces the utilization-based interest rate model.
    /// @param newInterestRateModel New interest rate model.
    function setInterestRateModel(address newInterestRateModel) external onlyOwner nonReentrant {
        require(newInterestRateModel != address(0), "LendingPool: zero rate model");
        for (uint256 i = 0; i < reservesList.length; i++) {
            _accrueInterest(reservesList[i]);
        }
        interestRateModel = IInterestRateModel(newInterestRateModel);
        emit InterestRateModelUpdated(newInterestRateModel);
    }

    /// @notice Sets reserve exposure limits. Zero leaves the corresponding side uncapped.
    function setReserveCaps(
        address asset,
        uint256 supplyCap,
        uint256 borrowCap
    ) external onlyOwner nonReentrant {
        ReserveData storage reserve = _activeReserve(asset);
        require(
            supplyCap == 0 || supplyCap >= IAToken(reserve.aToken).totalSupply(),
            "LendingPool: cap below supply"
        );
        require(
            borrowCap == 0 || borrowCap >= IDebtToken(reserve.debtToken).totalSupply(),
            "LendingPool: cap below debt"
        );
        supplyCaps[asset] = supplyCap;
        borrowCaps[asset] = borrowCap;
        emit ReserveCapsUpdated(asset, supplyCap, borrowCap);
    }

    /// @notice Enables or disables new borrows for a reserve.
    /// @param asset Reserve asset to update.
    /// @param enabled Whether borrowing is enabled.
    function setReserveBorrowingEnabled(address asset, bool enabled) external onlyOwner nonReentrant {
        ReserveData storage reserve = _activeReserve(asset);
        reserve.isBorrowingEnabled = enabled;
        emit ReserveBorrowingUpdated(asset, enabled);
    }

    /// @notice Enables or disables collateral credit for a reserve.
    /// @param asset Reserve asset to update.
    /// @param enabled Whether collateral use is enabled.
    function setReserveCollateralEnabled(address asset, bool enabled) external onlyOwner nonReentrant {
        ReserveData storage reserve = _activeReserve(asset);
        reserve.isCollateralEnabled = enabled;
        emit ReserveCollateralUpdated(asset, enabled);
    }

    /// @notice Updates reserve risk parameters.
    /// @param asset Reserve asset to update.
    /// @param ltv Maximum borrow basis points credited to collateral.
    /// @param liquidationThreshold Liquidation threshold in basis points.
    /// @param liquidationBonus Liquidator collateral bonus in basis points.
    function setReserveRiskParameters(
        address asset,
        uint16 ltv,
        uint16 liquidationThreshold,
        uint16 liquidationBonus
    ) external onlyOwner nonReentrant {
        ReserveData storage reserve = _activeReserve(asset);
        require(ltv <= liquidationThreshold, "LendingPool: invalid ltv");
        require(liquidationThreshold <= BPS, "LendingPool: invalid threshold");
        require(liquidationBonus <= 2_000, "LendingPool: bonus too high");

        reserve.ltv = ltv;
        reserve.liquidationThreshold = liquidationThreshold;
        reserve.liquidationBonus = liquidationBonus;

        emit ReserveRiskParametersUpdated(asset, ltv, liquidationThreshold, liquidationBonus);
    }

    /// @notice Pauses user and reserve initialization operations.
    function pause() external onlyOwner nonReentrant {
        _pause();
    }

    /// @notice Resumes user and reserve initialization operations.
    function unpause() external onlyOwner nonReentrant {
        _unpause();
    }

    /// @notice Aggregates a user's collateral, debt, borrowing power, and liquidation health.
    /// @param user Account to evaluate.
    /// @return data Account values in 8-decimal USD units and health factor in 1e18 precision.
    function getUserAccountData(address user) public view returns (UserAccountData memory data) {
        uint256 weightedLtv;
        uint256 weightedLiquidationThreshold;

        for (uint256 i = 0; i < reservesList.length; i++) {
            address asset = reservesList[i];
            ReserveData storage reserve = reserves[asset];

            (uint256 currentLiquidityIndex, uint256 currentBorrowIndex) = _currentIndexes(reserve);

            if (userCollateralEnabled[user][asset]) {
                uint256 collateralBalance =
                    (IAToken(reserve.aToken).scaledBalanceOf(user) * currentLiquidityIndex) / RAY;
                if (collateralBalance > 0) {
                    uint256 collateralValue = _assetToUSD(asset, collateralBalance);
                    data.totalCollateralUSD += collateralValue;
                    weightedLtv += collateralValue * reserve.ltv;
                    weightedLiquidationThreshold += collateralValue * reserve.liquidationThreshold;
                }
            }

            uint256 debtBalance = (IDebtToken(reserve.debtToken).scaledBalanceOf(user) * currentBorrowIndex) / RAY;
            if (debtBalance > 0) {
                data.totalDebtUSD += _assetToUSD(asset, debtBalance);
            }
        }

        uint256 avgLtv = data.totalCollateralUSD == 0 ? 0 : weightedLtv / data.totalCollateralUSD;
        uint256 avgLiquidationThreshold =
            data.totalCollateralUSD == 0 ? 0 : weightedLiquidationThreshold / data.totalCollateralUSD;

        uint256 borrowLimitUSD = (data.totalCollateralUSD * avgLtv) / BPS;
        data.availableBorrowsUSD = borrowLimitUSD > data.totalDebtUSD ? borrowLimitUSD - data.totalDebtUSD : 0;

        if (data.totalDebtUSD == 0) {
            data.healthFactor = type(uint256).max;
        } else {
            uint256 liquidationAdjustedCollateralUSD = (data.totalCollateralUSD * avgLiquidationThreshold) / BPS;
            data.healthFactor = (liquidationAdjustedCollateralUSD * WAD) / data.totalDebtUSD;
        }
    }

    /// @notice Returns the stored reserve configuration and indices.
    /// @param asset Reserve asset to query.
    /// @return Reserve data.
    function getReserveData(address asset) external view returns (ReserveData memory) {
        return reserves[asset];
    }

    /// @notice Returns all registered reserve assets.
    /// @return Registered reserve asset addresses.
    function getReservesList() external view returns (address[] memory) {
        return reservesList;
    }

    /// @notice Accrues linearized supply and borrow interest since the last reserve update.
    /// @param asset Reserve asset to update.
    function _accrueInterest(address asset) internal {
        ReserveData storage reserve = _activeReserve(asset);
        uint256 timeDelta = block.timestamp - reserve.lastUpdateTimestamp;

        if (timeDelta == 0) {
            return;
        }

        uint256 oldLiquidityIndex = reserve.liquidityIndex;
        uint256 oldBorrowIndex = reserve.borrowIndex;

        uint256 borrowRatePerSecond =
            interestRateModel.calculateBorrowRate(reserve.totalBorrowed, reserve.totalLiquidity);
        uint256 supplyRatePerSecond =
            interestRateModel.calculateSupplyRate(reserve.totalBorrowed, reserve.totalLiquidity);

        uint256 borrowGrowth = RAY + (borrowRatePerSecond * timeDelta);
        uint256 supplyGrowth = RAY + (supplyRatePerSecond * timeDelta);

        reserve.borrowIndex = (oldBorrowIndex * borrowGrowth) / RAY;
        reserve.liquidityIndex = (oldLiquidityIndex * supplyGrowth) / RAY;
        reserve.lastUpdateTimestamp = block.timestamp;

        IAToken(reserve.aToken).updateLiquidityIndex(reserve.liquidityIndex);
        IDebtToken(reserve.debtToken).updateBorrowIndex(reserve.borrowIndex);
        reserve.totalLiquidity = _toUint128(IAToken(reserve.aToken).totalSupply());
        reserve.totalBorrowed = _toUint128(IDebtToken(reserve.debtToken).totalSupply());

        emit ReserveInterestAccrued(
            asset,
            reserve.liquidityIndex,
            reserve.borrowIndex,
            reserve.totalLiquidity,
            reserve.totalBorrowed
        );
    }

    /// @notice Computes reserve indexes as if interest were accrued at the current timestamp.
    /// @param reserve Reserve data to evaluate.
    /// @return liquidityIndex_ Current virtual liquidity index.
    /// @return borrowIndex_ Current virtual borrow index.
    function _currentIndexes(
        ReserveData storage reserve
    ) internal view returns (uint256 liquidityIndex_, uint256 borrowIndex_) {
        liquidityIndex_ = reserve.liquidityIndex;
        borrowIndex_ = reserve.borrowIndex;

        uint256 timeDelta = block.timestamp - reserve.lastUpdateTimestamp;
        if (timeDelta == 0) {
            return (liquidityIndex_, borrowIndex_);
        }

        uint256 borrowRatePerSecond =
            interestRateModel.calculateBorrowRate(reserve.totalBorrowed, reserve.totalLiquidity);
        uint256 supplyRatePerSecond =
            interestRateModel.calculateSupplyRate(reserve.totalBorrowed, reserve.totalLiquidity);

        uint256 borrowGrowth = RAY + (borrowRatePerSecond * timeDelta);
        uint256 supplyGrowth = RAY + (supplyRatePerSecond * timeDelta);

        borrowIndex_ = (borrowIndex_ * borrowGrowth) / RAY;
        liquidityIndex_ = (liquidityIndex_ * supplyGrowth) / RAY;
    }

    /// @notice Loads an active reserve or reverts.
    /// @param asset Reserve asset.
    /// @return reserve Active reserve storage reference.
    function _activeReserve(address asset) internal view returns (ReserveData storage reserve) {
        reserve = reserves[asset];
        require(reserve.isActive, "LendingPool: inactive reserve");
    }

    function _hasOutstandingDebt(address user) internal view returns (bool) {
        for (uint256 i = 0; i < reservesList.length; i++) {
            ReserveData storage reserve = reserves[reservesList[i]];
            if (IDebtToken(reserve.debtToken).scaledBalanceOf(user) > 0) {
                return true;
            }
        }
        return false;
    }

    function _hasRemainingCollateral(address user) internal view returns (bool) {
        for (uint256 i = 0; i < reservesList.length; i++) {
            address asset = reservesList[i];
            ReserveData storage reserve = reserves[asset];
            if (
                userCollateralEnabled[user][asset] &&
                IAToken(reserve.aToken).scaledBalanceOf(user) > 0
            ) {
                return true;
            }
        }
        return false;
    }

    /// @notice Converts a 6-decimal reserve amount to an 8-decimal USD value.
    /// @param asset Reserve asset.
    /// @param amount Amount in 6-decimal asset units.
    /// @return USD value with 8 decimals.
    function _assetToUSD(address asset, uint256 amount) internal view returns (uint256) {
        (uint256 price,) = _getPrice(asset);
        return (amount * price) / ASSET_UNIT;
    }

    /// @notice Converts an 8-decimal USD value to a 6-decimal reserve amount.
    /// @param asset Reserve asset.
    /// @param usdValue USD value with 8 decimals.
    /// @return Amount in 6-decimal asset units.
    function _usdToAsset(address asset, uint256 usdValue) internal view returns (uint256) {
        (uint256 price,) = _getPrice(asset);
        return (usdValue * ASSET_UNIT) / price;
    }

    function _getPrice(address asset) internal view returns (uint256 price, uint8 decimals) {
        try priceOracle.getPrice(asset) returns (uint256 primaryPrice, uint8 primaryDecimals) {
            if (primaryPrice > 0 && primaryDecimals == 8) {
                return (primaryPrice, primaryDecimals);
            }
        } catch {}

        require(address(fallbackPriceOracle) != address(0), "LendingPool: no valid oracle price");
        (price, decimals) = fallbackPriceOracle.getPrice(asset);
        require(price > 0, "LendingPool: zero oracle price");
        require(decimals == 8, "LendingPool: oracle decimals");
    }

    function _pullExact(address asset, address from, uint256 amount) internal {
        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(from, address(this), amount);
        require(
            IERC20(asset).balanceOf(address(this)) - balanceBefore == amount,
            "LendingPool: unsupported token"
        );
    }

    function _pushExact(address asset, address to, uint256 amount) internal {
        require(to != address(this), "LendingPool: invalid recipient");
        uint256 poolBalanceBefore = IERC20(asset).balanceOf(address(this));
        uint256 recipientBalanceBefore = IERC20(asset).balanceOf(to);
        IERC20(asset).safeTransfer(to, amount);
        require(
            poolBalanceBefore - IERC20(asset).balanceOf(address(this)) == amount &&
                IERC20(asset).balanceOf(to) - recipientBalanceBefore == amount,
            "LendingPool: unsupported token"
        );
    }

    /// @notice Safely narrows a value to uint128.
    /// @param value Value to narrow.
    /// @return Narrowed uint128 value.
    function _toUint128(uint256 value) internal pure returns (uint128) {
        require(value <= type(uint128).max, "LendingPool: uint128 overflow");
        return uint128(value);
    }

}
