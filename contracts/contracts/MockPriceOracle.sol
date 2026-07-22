// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ArcLend Mock Price Oracle
/// @notice Stores owner-managed USD prices for Arc Testnet assets using 8 decimal precision.
contract MockPriceOracle is Ownable {
    /// @notice Returns the configured 8-decimal USD price for a token.
    mapping(address => uint256) public prices;
    /// @notice Last update timestamp for each configured token price.
    mapping(address => uint256) public priceUpdatedAt;
    /// @notice Optional lower and upper bounds for each token's 8-decimal USD price.
    mapping(address => PriceBounds) public priceBounds;

    // Zero disables expiry for this explicitly testnet-only mock oracle. A
    // production deployment must replace this contract with a live oracle.
    uint256 public maxPriceAge;
    uint256 public constant MAX_BOUNDS_SPREAD_BPS = 2_000;
    uint256 public constant BPS = 10_000;

    struct PriceBounds {
        uint256 min;
        uint256 max;
    }

    event PriceUpdated(address indexed token, uint256 price);
    event PriceBoundsUpdated(address indexed token, uint256 minPrice, uint256 maxPrice);
    event MaxPriceAgeUpdated(uint256 maxPriceAge);

    /// @notice Creates the oracle and seeds USDC and EURC testnet prices.
    /// @param usdc Arc Testnet USDC ERC-20 interface address.
    /// @param eurc Arc Testnet EURC address.
    constructor(address usdc, address eurc) Ownable(msg.sender) {
        priceBounds[usdc] = PriceBounds({min: 99_000_000, max: 101_000_000});
        priceBounds[eurc] = PriceBounds({min: 98_000_000, max: 117_000_000});
        emit PriceBoundsUpdated(usdc, 99_000_000, 101_000_000);
        emit PriceBoundsUpdated(eurc, 98_000_000, 117_000_000);
        _setPrice(usdc, 100_000_000);
        _setPrice(eurc, 108_000_000);
    }

    /// @notice Updates an asset's mock USD price.
    /// @param token Asset whose price will be updated.
    /// @param priceUSD8decimals USD price with 8 decimals.
    function setPrice(address token, uint256 priceUSD8decimals) external onlyOwner {
        _setPrice(token, priceUSD8decimals);
    }

    /// @notice Configures optional sanity bounds for a token price.
    /// @param token Asset whose price bounds will be updated.
    /// @param minPriceUSD8decimals Minimum accepted 8-decimal USD price, or zero for no lower bound.
    /// @param maxPriceUSD8decimals Maximum accepted 8-decimal USD price, or zero for no upper bound.
    function setPriceBounds(
        address token,
        uint256 minPriceUSD8decimals,
        uint256 maxPriceUSD8decimals
    ) external onlyOwner {
        require(token != address(0), "MockPriceOracle: zero token");
        require(minPriceUSD8decimals > 0, "MockPriceOracle: zero min bound");
        require(maxPriceUSD8decimals >= minPriceUSD8decimals, "MockPriceOracle: invalid bounds");
        require(
            ((maxPriceUSD8decimals - minPriceUSD8decimals) * BPS) / minPriceUSD8decimals <= MAX_BOUNDS_SPREAD_BPS,
            "MockPriceOracle: bounds too wide"
        );

        priceBounds[token] = PriceBounds({min: minPriceUSD8decimals, max: maxPriceUSD8decimals});
        emit PriceBoundsUpdated(token, minPriceUSD8decimals, maxPriceUSD8decimals);
    }

    /// @notice Updates the maximum accepted age for stored prices.
    /// @param maxPriceAge_ Maximum age in seconds.
    function setMaxPriceAge(uint256 maxPriceAge_) external onlyOwner {
        maxPriceAge = maxPriceAge_;
        emit MaxPriceAgeUpdated(maxPriceAge_);
    }

    /// @notice Returns an asset's configured USD price.
    /// @param token Asset to query.
    /// @return price USD price with 8 decimals.
    /// @return decimals Number of price decimals, always 8.
    function getPrice(address token) external view returns (uint256 price, uint8 decimals) {
        price = prices[token];
        require(price > 0, "MockPriceOracle: price not set");
        require(
            maxPriceAge == 0 || block.timestamp - priceUpdatedAt[token] <= maxPriceAge,
            "MockPriceOracle: stale price"
        );
        decimals = 8;
    }

    /// @notice Validates and stores a mock price.
    /// @param token Asset whose price will be stored.
    /// @param priceUSD8decimals USD price with 8 decimals.
    function _setPrice(address token, uint256 priceUSD8decimals) internal {
        require(token != address(0), "MockPriceOracle: zero token");
        require(priceUSD8decimals > 0, "MockPriceOracle: zero price");
        PriceBounds memory bounds = priceBounds[token];
        require(bounds.min > 0 && bounds.max > 0, "MockPriceOracle: bounds not set");
        require(priceUSD8decimals >= bounds.min, "MockPriceOracle: price below bounds");
        require(priceUSD8decimals <= bounds.max, "MockPriceOracle: price above bounds");

        prices[token] = priceUSD8decimals;
        priceUpdatedAt[token] = block.timestamp;
        emit PriceUpdated(token, priceUSD8decimals);
    }
}
