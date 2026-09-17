// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IPriceOracle {
    function getPrice(address token) external view returns (uint256 price, uint8 decimals);
}

contract ChainlinkPriceOracle is IPriceOracle, Ownable {
    mapping(address => address) public priceFeeds;
    uint256 public maxStaleness = 86_400; // 24 h

    event PriceFeedSet(address indexed asset, address indexed feed);
    event MaxStalenessSet(uint256 newMaxStaleness);

    constructor() Ownable(msg.sender) {}

    function setPriceFeed(address asset, address feed) external onlyOwner {
        require(asset != address(0), "zero asset");
        priceFeeds[asset] = feed;
        emit PriceFeedSet(asset, feed);
    }

    function setMaxStaleness(uint256 _s) external onlyOwner {
        maxStaleness = _s;
        emit MaxStalenessSet(_s);
    }

    function getPrice(address token) external view override returns (uint256 price, uint8 decimals) {
        address feed = priceFeeds[token];
        require(feed != address(0), "no feed");

        (, int256 answer,, uint256 updatedAt,) = AggregatorV3Interface(feed).latestRoundData();
        require(answer > 0, "bad answer");
        require(block.timestamp - updatedAt <= maxStaleness, "stale");

        uint8 feedDec = AggregatorV3Interface(feed).decimals();
        if (feedDec == 8) return (uint256(answer), 8);
        if (feedDec < 8) return (uint256(answer) * 10 ** (8 - feedDec), 8);
        return (uint256(answer) / 10 ** (feedDec - 8), 8);
    }
}
