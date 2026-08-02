// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/// @notice Minimal Pyth mock for local unit tests of PythPriceOracle.
contract MockPyth {
    mapping(bytes32 => PythStructs.Price) private prices;
    uint256 public updateFee = 1 wei;
    uint256 public updateCount;

    error StalePrice();
    error PriceFeedNotFound();

    function setPrice(
        bytes32 priceId,
        int64 price,
        int32 expo,
        uint64 publishTime
    ) external {
        prices[priceId] = PythStructs.Price({
            price: price,
            conf: 0,
            expo: expo,
            publishTime: publishTime
        });
    }

    function setUpdateFee(uint256 fee) external {
        updateFee = fee;
    }

    function getPriceNoOlderThan(
        bytes32 id,
        uint age
    ) external view returns (PythStructs.Price memory price) {
        price = prices[id];
        if (price.publishTime == 0) revert PriceFeedNotFound();
        if (block.timestamp > price.publishTime + age) revert StalePrice();
        return price;
    }

    function getUpdateFee(bytes[] calldata) external view returns (uint256) {
        return updateFee;
    }

    function updatePriceFeeds(bytes[] calldata) external payable {
        require(msg.value >= updateFee, "MockPyth: insufficient fee");
        updateCount += 1;
        if (msg.value > updateFee) {
            payable(msg.sender).transfer(msg.value - updateFee);
        }
    }
}
