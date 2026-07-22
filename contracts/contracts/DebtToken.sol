// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ArcLend Variable Debt Token
/// @notice Non-transferable indexed token representing borrower obligations for a 6-decimal reserve asset.
contract DebtToken is ERC20, Ownable {
    uint256 public constant RAY = 1e27;

    address public immutable underlyingAsset;
    address public immutable pool;
    uint256 public borrowIndex = RAY;

    mapping(address => uint256) private scaledBalances;
    uint256 private scaledTotalSupply;

    event Mint(address indexed user, uint256 amount, uint256 index);
    event Burn(address indexed user, uint256 amount, uint256 index);
    event BorrowIndexUpdated(uint256 previousIndex, uint256 newIndex);

    modifier onlyPool() {
        require(msg.sender == pool, "DebtToken: caller is not pool");
        _;
    }

    /// @notice Creates a variable debt token for a reserve.
    /// @param underlyingAsset_ Underlying 6-decimal ERC-20 reserve asset.
    /// @param pool_ LendingPool authorized to manage debt balances and the index.
    constructor(address underlyingAsset_, address pool_) ERC20("ArcLend Variable Debt Token", "debtARC") Ownable(msg.sender) {
        require(underlyingAsset_ != address(0), "DebtToken: zero underlying");
        require(pool_ != address(0), "DebtToken: zero pool");

        underlyingAsset = underlyingAsset_;
        pool = pool_;
    }

    /// @notice Returns the debt token precision.
    /// @return Number of decimals, always 6.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Returns an account's debt including accrued borrow interest.
    /// @param account Account to query.
    /// @return Indexed debt balance.
    function balanceOf(address account) public view override returns (uint256) {
        return (scaledBalances[account] * borrowIndex) / RAY;
    }

    /// @notice Returns total outstanding indexed debt.
    /// @return Indexed total debt supply.
    function totalSupply() public view override returns (uint256) {
        return (scaledTotalSupply * borrowIndex) / RAY;
    }

    /// @notice Returns an account's internal scaled debt.
    /// @param account Account to query.
    /// @return Internal scaled debt balance.
    function scaledBalanceOf(address account) external view returns (uint256) {
        return scaledBalances[account];
    }

    /// @notice Returns the internal scaled total debt.
    /// @return Internal scaled total debt.
    function scaledTotalSupplyOf() external view returns (uint256) {
        return scaledTotalSupply;
    }

    /// @notice Mints debt when a user borrows.
    /// @param to Borrower whose debt increases.
    /// @param amount Borrowed amount in 6-decimal asset units.
    /// @param index Current reserve borrow index in ray precision.
    function mint(address to, uint256 amount, uint256 index) external onlyPool returns (uint256 actualAmount) {
        require(to != address(0), "DebtToken: mint to zero");
        require(amount > 0, "DebtToken: zero amount");
        require(index >= RAY, "DebtToken: invalid index");

        _updateBorrowIndex(index);

        uint256 debtBefore = balanceOf(to);
        uint256 scaledAmount = (amount * RAY) / borrowIndex;
        require(scaledAmount > 0, "DebtToken: scaled amount zero");

        scaledBalances[to] += scaledAmount;
        scaledTotalSupply += scaledAmount;

        actualAmount = balanceOf(to) - debtBefore;
        emit Transfer(address(0), to, actualAmount);
        emit Mint(to, actualAmount, borrowIndex);
    }

    /// @notice Burns debt when a loan is repaid or liquidated.
    /// @param from Borrower whose debt decreases.
    /// @param amount Repaid amount in 6-decimal asset units.
    /// @param index Current reserve borrow index in ray precision.
    function burn(address from, uint256 amount, uint256 index) external onlyPool returns (uint256 actualAmount) {
        require(from != address(0), "DebtToken: burn from zero");
        require(amount > 0, "DebtToken: zero amount");
        require(index >= RAY, "DebtToken: invalid index");

        _updateBorrowIndex(index);

        uint256 indexedDebt = balanceOf(from);
        uint256 scaledAmount = amount >= indexedDebt
            ? scaledBalances[from]
            : (amount * RAY) / borrowIndex;
        require(scaledAmount > 0, "DebtToken: scaled amount zero");
        require(scaledBalances[from] >= scaledAmount, "DebtToken: burn exceeds balance");

        scaledBalances[from] -= scaledAmount;
        scaledTotalSupply -= scaledAmount;

        actualAmount = indexedDebt - balanceOf(from);
        emit Transfer(from, address(0), actualAmount);
        emit Burn(from, actualAmount, borrowIndex);
    }

    /// @notice Advances the borrow index without changing principal.
    /// @param newIndex New non-decreasing borrow index in ray precision.
    function updateBorrowIndex(uint256 newIndex) external onlyPool {
        _updateBorrowIndex(newIndex);
    }

    /// @notice Debt positions cannot be transferred.
    /// @param to Ignored destination.
    /// @param amount Ignored amount.
    /// @return Always reverts.
    function transfer(address to, uint256 amount) public pure override returns (bool) {
        if (to == address(0) && amount == type(uint256).max) {
            revert("DebtToken: non-transferable");
        }
        revert("DebtToken: non-transferable");
    }

    /// @notice Debt token allowances are disabled because balances are non-transferable.
    function approve(address spender, uint256 amount) public pure override returns (bool) {
        if (spender == address(0) && amount == type(uint256).max) {
            revert("DebtToken: non-transferable");
        }
        revert("DebtToken: non-transferable");
    }

    /// @notice Debt positions cannot be transferred by allowance.
    /// @param from Ignored source.
    /// @param to Ignored destination.
    /// @param amount Ignored amount.
    /// @return Always reverts.
    function transferFrom(address from, address to, uint256 amount) public pure override returns (bool) {
        if (from == address(0) && to == address(0) && amount == type(uint256).max) {
            revert("DebtToken: non-transferable");
        }
        revert("DebtToken: non-transferable");
    }

    /// @notice Validates and stores a new borrow index.
    /// @param newIndex New borrow index in ray precision.
    function _updateBorrowIndex(uint256 newIndex) internal {
        require(newIndex >= borrowIndex, "DebtToken: index regression");
        uint256 previousIndex = borrowIndex;
        borrowIndex = newIndex;
        if (newIndex != previousIndex) {
            emit BorrowIndexUpdated(previousIndex, newIndex);
        }
    }
}
