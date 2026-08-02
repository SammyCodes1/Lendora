// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ArcLend Pyth Price Oracle
/// @notice Live USD price feed powered by Pyth Network, replacing MockPriceOracle
/// for production-quality price data on Arc Testnet.
/// @dev Implements the same getPrice(address) → (uint256, uint8) interface that
/// LendingPool.sol expects via IPriceOracle — no modifications to LendingPool
/// are required. The oracle is swapped in via LendingPool.setPriceOracle().
contract PythPriceOracle is Ownable {
    /// @notice The Pyth contract on this chain, used to read and update prices.
    IPyth public pyth;

    /// @notice Maps an ArcLend asset address to its Pyth price feed ID.
    mapping(address => bytes32) public priceFeedIds;

    /// @notice Maximum age (in seconds) before a Pyth price is considered stale.
    /// Pyth's getPriceNoOlderThan will revert with StalePrice if exceeded.
    uint256 public maxStaleness = 300; // 5 minutes

    event PriceFeedRegistered(address indexed asset, bytes32 priceFeedId);
    event MaxStalenessUpdated(uint256 newMaxStaleness);
    event PriceRefreshed(address indexed refresher, uint256 feeCharged);

    /// @param pythContract Pyth contract address deployed on this chain.
    constructor(address pythContract) Ownable(msg.sender) {
        require(pythContract != address(0), "PythPriceOracle: zero pyth");
        pyth = IPyth(pythContract);
    }

    /// @notice Registers a Pyth price feed ID for a given asset.
    /// @param asset The ArcLend asset address (e.g. USDC, EURC).
    /// @param priceFeedId The Pyth bytes32 price feed ID.
    function setPriceFeedId(address asset, bytes32 priceFeedId) external onlyOwner {
        require(asset != address(0), "PythPriceOracle: zero asset");
        require(priceFeedId != bytes32(0), "PythPriceOracle: zero feed id");
        priceFeedIds[asset] = priceFeedId;
        emit PriceFeedRegistered(asset, priceFeedId);
    }

    /// @notice Updates the staleness threshold.
    /// @param newMaxStaleness New max age in seconds.
    function setMaxStaleness(uint256 newMaxStaleness) external onlyOwner {
        require(newMaxStaleness > 0, "PythPriceOracle: zero staleness");
        maxStaleness = newMaxStaleness;
        emit MaxStalenessUpdated(newMaxStaleness);
    }

    /// @notice Returns an asset's USD price from Pyth, matching MockPriceOracle's
    /// exact interface so LendingPool needs zero changes.
    /// @param token Asset to query.
    /// @return price USD price with 8 decimals.
    /// @return decimals Always 8, matching LendingPool's expectation.
    function getPrice(address token) external view returns (uint256 price, uint8 decimals) {
        bytes32 feedId = priceFeedIds[token];
        require(feedId != bytes32(0), "PythPriceOracle: asset not registered");

        // Reverts with StalePrice if on-chain price hasn't been refreshed
        // within maxStaleness seconds — this is Pyth's built-in safety.
        PythStructs.Price memory pythPrice = pyth.getPriceNoOlderThan(feedId, maxStaleness);

        require(pythPrice.price > 0, "PythPriceOracle: invalid price");

        // Pyth expo is typically negative (e.g. -8 means 8 decimal places).
        // We need to normalize to exactly 8 decimals for LendingPool.
        int32 expo = pythPrice.expo;
        uint256 rawPrice = uint256(uint64(pythPrice.price));
        uint8 pythDecimals = uint8(uint32(-expo));

        // Normalize to 8 decimals
        if (pythDecimals == 8) {
            price = rawPrice;
        } else if (pythDecimals > 8) {
            price = rawPrice / (10 ** (pythDecimals - 8));
        } else {
            price = rawPrice * (10 ** (8 - pythDecimals));
        }

        require(price > 0, "PythPriceOracle: zero normalized price");
        decimals = 8;
    }

    /// @notice Permissionless price refresh — anyone can pay the small update fee
    /// to keep the on-chain price fresh. Called by ArcLend's keeper on a schedule,
    /// but not restricted to the keeper.
    /// @dev On Arc, the update fee is paid in native USDC (18 decimals), NOT the
    /// 6-decimal ERC-20 USDC used elsewhere in ArcLend.
    /// @param priceUpdateData Encoded price update data from Pyth Hermes API.
    function refreshPrice(bytes[] calldata priceUpdateData) external payable {
        uint256 fee = pyth.getUpdateFee(priceUpdateData);
        require(msg.value >= fee, "PythPriceOracle: insufficient fee");
        pyth.updatePriceFeeds{value: fee}(priceUpdateData);
        if (msg.value > fee) {
            payable(msg.sender).transfer(msg.value - fee);
        }
        emit PriceRefreshed(msg.sender, fee);
    }

    /// @notice Returns the update fee for given price data, useful for frontends
    /// and keepers to know how much native token to send.
    function getRefreshFee(bytes[] calldata priceUpdateData) external view returns (uint256) {
        return pyth.getUpdateFee(priceUpdateData);
    }
}
