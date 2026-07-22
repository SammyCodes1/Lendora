// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Mock Stablecoin
/// @notice Six-decimal test token used only by the ArcLend Hardhat test suite.
contract MockStablecoin is ERC20, Ownable {
    /// @notice Creates a named six-decimal mock stablecoin.
    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) Ownable(msg.sender) {}

    /// @notice Returns the stablecoin precision.
    /// @return Number of decimals, always 6.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints test tokens.
    /// @param to Recipient.
    /// @param amount Amount in six-decimal token units.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
