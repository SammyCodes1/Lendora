// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILendingPool {
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

    function supply(address asset, uint256 amount, address onBehalfOf) external;
    function withdraw(address asset, uint256 amount, address to) external;
    function borrow(address asset, uint256 amount, address onBehalfOf) external;
    function repay(address asset, uint256 amount, address onBehalfOf) external returns (uint256 actualAmount);
    function liquidate(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external;
    function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external;
    function setPriceOracle(address newOracle) external;
    function setInterestRateModel(address newInterestRateModel) external;
    function pause() external;
    function unpause() external;
    function getUserAccountData(address user) external view returns (UserAccountData memory data);
    function getReserveData(address asset) external view returns (ReserveData memory);
    function getReservesList() external view returns (address[] memory);
    function userCollateralEnabled(address user, address asset) external view returns (bool);
    function interestRateModel() external view returns (address);
    function priceOracle() external view returns (address);
    function paused() external view returns (bool);
}

interface IPositionNFT {
    enum PositionType {
        SUPPLY,
        BORROW
    }

    struct PositionInfo {
        address asset;
        PositionType positionType;
        address linkedToken;
        uint256 openedAt;
    }

    function mint(
        address to,
        address asset,
        PositionType positionType,
        address linkedToken
    ) external returns (uint256);
    function burn(uint256 tokenId) external;
    function userPositionToken(
        address user,
        address asset,
        uint8 positionType
    ) external view returns (uint256);
    function positions(uint256 tokenId)
        external
        view
        returns (
            address asset,
            PositionType positionType,
            address linkedToken,
            uint256 openedAt
        );
}

/// @title ArcLend Position Manager
/// @notice Additive periphery that opens positions through the existing live LendingPool and mints receipts.
contract PositionManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ILendingPool public immutable lendingPool;
    IPositionNFT public immutable positionNFT;

    constructor(address _lendingPool, address _positionNFT) Ownable(msg.sender) {
        require(_lendingPool != address(0), "Zero LendingPool");
        require(_positionNFT != address(0), "Zero PositionNFT");
        lendingPool = ILendingPool(_lendingPool);
        positionNFT = IPositionNFT(_positionNFT);
    }

    function supply(address asset, uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        require(IERC20(asset).balanceOf(address(this)) - balanceBefore == amount, "Unsupported token");
        IERC20(asset).forceApprove(address(lendingPool), amount);
        lendingPool.supply(asset, amount, msg.sender);
        _mintIfNeeded(msg.sender, asset, IPositionNFT.PositionType.SUPPLY);
    }

    function borrow(address asset, uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        lendingPool.borrow(asset, amount, msg.sender);
        uint256 received = IERC20(asset).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "No borrowed funds received");
        uint256 userBalanceBefore = IERC20(asset).balanceOf(msg.sender);
        IERC20(asset).safeTransfer(msg.sender, received);
        require(
            IERC20(asset).balanceOf(msg.sender) - userBalanceBefore == received &&
                IERC20(asset).balanceOf(address(this)) == balanceBefore,
            "Unsupported token"
        );
        _mintIfNeeded(msg.sender, asset, IPositionNFT.PositionType.BORROW);
    }

    function claimExistingPosition(
        address asset,
        IPositionNFT.PositionType positionType
    ) external nonReentrant {
        ILendingPool.ReserveData memory reserve = lendingPool.getReserveData(asset);
        require(reserve.isActive, "Inactive reserve");
        address linkedToken =
            positionType == IPositionNFT.PositionType.SUPPLY
                ? reserve.aToken
                : reserve.debtToken;
        require(IERC20(linkedToken).balanceOf(msg.sender) > 0, "No existing position to claim");
        require(
            positionNFT.userPositionToken(msg.sender, asset, uint8(positionType)) == 0,
            "Already claimed"
        );
        positionNFT.mint(msg.sender, asset, positionType, linkedToken);
    }

    function closePosition(
        address asset,
        IPositionNFT.PositionType positionType
    ) external nonReentrant {
        uint256 tokenId =
            positionNFT.userPositionToken(msg.sender, asset, uint8(positionType));
        require(tokenId != 0, "No position NFT found");
        (
            address positionAsset,
            IPositionNFT.PositionType storedType,
            address linkedToken,

        ) = positionNFT.positions(tokenId);
        require(positionAsset == asset && storedType == positionType, "Position mismatch");
        require(IERC20(linkedToken).balanceOf(msg.sender) == 0, "Position still open");
        positionNFT.burn(tokenId);
    }

    function _mintIfNeeded(
        address user,
        address asset,
        IPositionNFT.PositionType positionType
    ) internal {
        if (positionNFT.userPositionToken(user, asset, uint8(positionType)) != 0) {
            return;
        }
        ILendingPool.ReserveData memory reserve = lendingPool.getReserveData(asset);
        require(reserve.isActive, "Inactive reserve");
        address linkedToken =
            positionType == IPositionNFT.PositionType.SUPPLY
                ? reserve.aToken
                : reserve.debtToken;
        positionNFT.mint(user, asset, positionType, linkedToken);
    }
}
