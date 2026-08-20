// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ILendingPoolAccountData {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralUSD,
            uint256 totalDebtUSD,
            uint256 availableBorrowsUSD,
            uint256 healthFactor
        );
}

interface IWalletDomainResolver {
    function resolveDomain(string memory domainName) external view returns (address);
}

/// @title SpokenPay
/// @notice English-operated recurring payments. A user authorizes a plan once;
///         a relayer (or the user) later pulls wallet tokens to a .lendora name
///         or address only if health factor stays above the plan floor.
///         Yield-only plans never touch supplied principal — they pull idle
///         ERC-20 in the wallet (claimed interest).
contract SpokenPay is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_INTERVAL = 15 minutes;
    uint256 public constant MIN_HEALTH_FACTOR = 11e17; // 1.10

    struct Plan {
        address user;
        address token;
        address recipient;
        string domainName;
        uint128 amount;
        uint64 interval;
        uint64 nextRunAt;
        uint64 minHealthFactorWad;
        bool fromYieldOnly;
        bool active;
    }

    ILendingPoolAccountData public immutable lendingPool;
    IWalletDomainResolver public immutable walletDomain;

    mapping(address => bool) public relayers;
    mapping(uint256 => Plan) public plans;
    uint256 public nextPlanId = 1;

    event RelayerUpdated(address indexed relayer, bool allowed);
    event PlanCreated(
        uint256 indexed planId,
        address indexed user,
        address indexed token,
        address recipient,
        string domainName,
        uint256 amount,
        uint256 interval,
        uint256 nextRunAt,
        uint256 minHealthFactorWad,
        bool fromYieldOnly
    );
    event PlanCancelled(uint256 indexed planId, address indexed user);
    event PlanExecuted(
        uint256 indexed planId,
        address indexed user,
        address indexed recipient,
        uint256 amount,
        uint256 nextRunAt
    );

    error InvalidAddress();
    error InvalidAmount();
    error InvalidInterval();
    error InvalidHealthFactor();
    error InvalidRecipient();
    error NotPlanOwner();
    error PlanInactive();
    error NotDue();
    error HealthTooLow();
    error InsufficientWalletBalance();
    error UnauthorizedExecutor();

    constructor(
        address lendingPool_,
        address walletDomain_,
        address initialRelayer
    ) Ownable(msg.sender) {
        if (lendingPool_ == address(0) || walletDomain_ == address(0)) {
            revert InvalidAddress();
        }
        lendingPool = ILendingPoolAccountData(lendingPool_);
        walletDomain = IWalletDomainResolver(walletDomain_);
        if (initialRelayer != address(0)) {
            relayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        if (relayer == address(0)) revert InvalidAddress();
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function createPlan(
        address token,
        address recipient,
        string calldata domainName,
        uint128 amount,
        uint64 interval,
        uint64 firstRunAt,
        uint64 minHealthFactorWad,
        bool fromYieldOnly
    ) external whenNotPaused returns (uint256 planId) {
        if (token == address(0)) revert InvalidAddress();
        if (amount == 0) revert InvalidAmount();
        if (interval < MIN_INTERVAL) revert InvalidInterval();
        if (minHealthFactorWad < MIN_HEALTH_FACTOR) revert InvalidHealthFactor();
        if (recipient == address(0) && bytes(domainName).length == 0) {
            revert InvalidRecipient();
        }
        if (recipient != address(0) && recipient == msg.sender) {
            revert InvalidRecipient();
        }

        uint64 startAt = firstRunAt < uint64(block.timestamp)
            ? uint64(block.timestamp)
            : firstRunAt;

        planId = nextPlanId++;
        plans[planId] = Plan({
            user: msg.sender,
            token: token,
            recipient: recipient,
            domainName: domainName,
            amount: amount,
            interval: interval,
            nextRunAt: startAt,
            minHealthFactorWad: minHealthFactorWad,
            fromYieldOnly: fromYieldOnly,
            active: true
        });

        emit PlanCreated(
            planId,
            msg.sender,
            token,
            recipient,
            domainName,
            amount,
            interval,
            startAt,
            minHealthFactorWad,
            fromYieldOnly
        );
    }

    function cancelPlan(uint256 planId) external {
        Plan storage plan = plans[planId];
        if (plan.user != msg.sender) revert NotPlanOwner();
        if (!plan.active) revert PlanInactive();
        plan.active = false;
        emit PlanCancelled(planId, msg.sender);
    }

    function executePlan(uint256 planId) external whenNotPaused nonReentrant {
        Plan storage plan = plans[planId];
        if (!plan.active) revert PlanInactive();
        if (msg.sender != plan.user && !relayers[msg.sender]) {
            revert UnauthorizedExecutor();
        }
        if (block.timestamp < plan.nextRunAt) revert NotDue();

        (, , , uint256 healthFactor) = lendingPool.getUserAccountData(plan.user);
        if (healthFactor < plan.minHealthFactorWad) revert HealthTooLow();

        address to = plan.recipient;
        if (bytes(plan.domainName).length > 0) {
            address resolved = walletDomain.resolveDomain(plan.domainName);
            if (resolved == address(0)) revert InvalidRecipient();
            to = resolved;
        }
        if (to == address(0) || to == plan.user) revert InvalidRecipient();

        uint256 walletBalance = IERC20(plan.token).balanceOf(plan.user);
        if (walletBalance < plan.amount) revert InsufficientWalletBalance();

        IERC20(plan.token).safeTransferFrom(plan.user, to, plan.amount);
        plan.nextRunAt = uint64(block.timestamp + plan.interval);

        emit PlanExecuted(planId, plan.user, to, plan.amount, plan.nextRunAt);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
