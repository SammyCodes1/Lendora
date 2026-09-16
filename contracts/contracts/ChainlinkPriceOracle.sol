// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256 price, uint8 decimals);
}

/// @title Lendora Chainlink Price Oracle
/// @notice Production on-chain price feed powered by Chainlink Data Feeds on Arc Mainnet.
/// @dev Implements IPriceOracle for Lendora's LendingPool. Zero off-chain API keys or keeper bots required.
contract ChainlinkPriceOracle is IPriceOracle, Ownable {
    /// @notice Maps an underlying asset address to its Chainlink AggregatorV3 feed
    mapping(address => address) public priceFeeds;

    /// @notice Fallback price in 8 decimals if an aggregator is not set or temporarily unresponsive
    mapping(address => uint256) public fallbackPrices;

    /// @notice Maximum allowed age for price updates (default: 24 hours, 0 = disabled)
    uint256 public maxPriceAge = 86400;

    event PriceFeedUpdated(address indexed asset, address indexed feed);
    event FallbackPriceUpdated(address indexed asset, uint256 price);
    event MaxPriceAgeUpdated(uint256 newMaxPriceAge);

    /// @param usdc Arc Mainnet USDC address.
    /// @param eurc Arc Mainnet EURC address.
    constructor(address usdc, address eurc) Ownable(msg.sender) {
        // Seed baseline fallback prices ($1.00 for USDC, $1.08 for EURC with 8 decimals)
        if (usdc != address(0)) {
            fallbackPrices[usdc] = 100_000_000;
            emit FallbackPriceUpdated(usdc, 100_000_000);
        }
        if (eurc != address(0)) {
            fallbackPrices[eurc] = 108_000_000;
            emit FallbackPriceUpdated(eurc, 108_000_000);
        }
    }

    /// @notice Configures the Chainlink aggregator feed for an asset
    /// @param asset Underlying ERC-20 token address (e.g. USDC, EURC)
    /// @param feed Chainlink AggregatorV3 proxy address on Arc Mainnet
    function setAssetFeed(address asset, address feed) external onlyOwner {
        require(asset != address(0), "ChainlinkPriceOracle: zero asset");
        priceFeeds[asset] = feed;
        emit PriceFeedUpdated(asset, feed);
    }

    /// @notice Configures a fallback price for an asset (8 decimals)
    /// @param asset Underlying ERC-20 token address
    /// @param price 8-decimal USD price
    function setFallbackPrice(address asset, uint256 price) external onlyOwner {
        require(asset != address(0), "ChainlinkPriceOracle: zero asset");
        require(price > 0, "ChainlinkPriceOracle: zero price");
        fallbackPrices[asset] = price;
        emit FallbackPriceUpdated(asset, price);
    }

    /// @notice Configures maximum allowed age for Chainlink reports in seconds
    /// @param newMaxPriceAge Max seconds before considering an update stale (0 to disable check)
    function setMaxPriceAge(uint256 newMaxPriceAge) external onlyOwner {
        maxPriceAge = newMaxPriceAge;
        emit MaxPriceAgeUpdated(newMaxPriceAge);
    }

    /// @notice Returns the USD price of an asset in 8 decimals, conforming to IPriceOracle
    /// @param token Asset to query
    /// @return price USD price with 8 decimals
    /// @return decimals Always 8 decimals
    function getPrice(address token) external view override returns (uint256 price, uint8 decimals) {
        address feed = priceFeeds[token];
        if (feed != address(0)) {
            try AggregatorV3Interface(feed).latestRoundData() returns (
                uint80,
                int256 answer,
                uint256,
                uint256 updatedAt,
                uint80
            ) {
                if (answer > 0 && (maxPriceAge == 0 || block.timestamp - updatedAt <= maxPriceAge)) {
                    uint8 feedDecimals = AggregatorV3Interface(feed).decimals();
                    uint256 rawPrice = uint256(answer);
                    if (feedDecimals == 8) {
                        return (rawPrice, 8);
                    } else if (feedDecimals < 8) {
                        return (rawPrice * (10 ** (8 - feedDecimals)), 8);
                    } else {
                        return (rawPrice / (10 ** (feedDecimals - 8)), 8);
                    }
                }
            } catch {}
        }

        uint256 fallbackPrice = fallbackPrices[token];
        require(fallbackPrice > 0, "ChainlinkPriceOracle: no price available");
        return (fallbackPrice, 8);
    }
}
