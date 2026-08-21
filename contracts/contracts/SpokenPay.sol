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
/// @notice Recurring payments to a pinned .lendora name or address.
///         A relayer (or the owner) later pulls wallet tokens only if health
///         factor stays above the plan floor. Yield-only plans never withdraw
///         supplied principal — they spend idle ERC-20 already in the wallet
///         (claimed interest). If a pinned .lendora name moves, the plan halts.
contract SpokenPay is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_INTERVAL = 15 minutes;
    uint256 public constant MIN_HEALTH_FACTOR = 11e17; // 1.10

    bytes32 public constant OUTCOME_PAID = "paid";
    bytes32 public constant OUTCOME_SKIPPED_HEALTH = "health";
    bytes32 public constant OUTCOME_SKIPPED_BALANCE = "balance";
    bytes32 public constant OUTCOME_HALTED_DOMAIN = "domain";

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
    mapping(address => uint256[]) private _planIdsByUser;
    mapping(uint256 => bytes32) public lastOutcome;
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
    event PlanSkipped(
        uint256 indexed planId,
        address indexed user,
        bytes32 reason,
        uint256 nextRunAt
    );
    event PlanHalted(uint256 indexed planId, address indexed user, bytes32 reason);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidInterval();
    error InvalidHealthFactor();
    error InvalidRecipient();
    error NotPlanOwner();
    error PlanInactive();
    error NotDue();
    error UnauthorizedExecutor();
    error HealthTooLow();
    error InsufficientWalletBalance();

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

    function planIdsOf(address user) external view returns (uint256[] memory) {
        return _planIdsByUser[user];
    }

    function previewPlan(uint256 planId)
        external
        view
        returns (
            bool due,
            bool active,
            bytes32 blocker,
            address payTo,
            uint256 walletBalance,
            uint256 healthFactor
        )
    {
        Plan storage plan = plans[planId];
        payTo = plan.recipient;
        if (plan.user == address(0)) {
            return (false, false, "missing", address(0), 0, 0);
        }
        active = plan.active;
        walletBalance = IERC20(plan.token).balanceOf(plan.user);
        (, , , healthFactor) = lendingPool.getUserAccountData(plan.user);
        due = plan.active && block.timestamp >= plan.nextRunAt;
        if (!plan.active) {
            blocker = lastOutcome[planId] == OUTCOME_HALTED_DOMAIN
                ? OUTCOME_HALTED_DOMAIN
                : bytes32("inactive");
            return (false, false, blocker, payTo, walletBalance, healthFactor);
        }
        if (bytes(plan.domainName).length > 0) {
            address live = walletDomain.resolveDomain(plan.domainName);
            if (live == address(0) || live != plan.recipient) {
                // Keep `due` so the relayer still calls executePlan and halts.
                return (due, true, OUTCOME_HALTED_DOMAIN, payTo, walletBalance, healthFactor);
            }
        }
        if (!due) {
            return (false, true, "not-due", payTo, walletBalance, healthFactor);
        }
        if (healthFactor < plan.minHealthFactorWad) {
            return (true, true, OUTCOME_SKIPPED_HEALTH, payTo, walletBalance, healthFactor);
        }
        if (walletBalance < plan.amount) {
            return (true, true, OUTCOME_SKIPPED_BALANCE, payTo, walletBalance, healthFactor);
        }
        return (true, true, bytes32(0), payTo, walletBalance, healthFactor);
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

        address payTo = recipient;
        if (bytes(domainName).length > 0) {
            address resolved = walletDomain.resolveDomain(domainName);
            if (resolved == address(0)) revert InvalidRecipient();
            if (payTo != address(0) && payTo != resolved) revert InvalidRecipient();
            payTo = resolved;
        }
        if (payTo == address(0) || payTo == msg.sender) revert InvalidRecipient();

        uint64 startAt = firstRunAt < uint64(block.timestamp)
            ? uint64(block.timestamp)
            : firstRunAt;

        planId = nextPlanId++;
        plans[planId] = Plan({
            user: msg.sender,
            token: token,
            recipient: payTo,
            domainName: domainName,
            amount: amount,
            interval: interval,
            nextRunAt: startAt,
            minHealthFactorWad: minHealthFactorWad,
            fromYieldOnly: fromYieldOnly,
            active: true
        });
        _planIdsByUser[msg.sender].push(planId);

        emit PlanCreated(
            planId,
            msg.sender,
            token,
            payTo,
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
        lastOutcome[planId] = "cancelled";
        emit PlanCancelled(planId, msg.sender);
    }

    /// @return outcome paid, health, balance, or domain.
    function executePlan(uint256 planId)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 outcome)
    {
        Plan storage plan = plans[planId];
        if (!plan.active) revert PlanInactive();
        bool ownerExec = msg.sender == plan.user;
        if (!ownerExec && !relayers[msg.sender]) {
            revert UnauthorizedExecutor();
        }
        // Relayer must wait for the cadence. The owner may run immediately.
        if (!ownerExec && block.timestamp < plan.nextRunAt) revert NotDue();

        if (bytes(plan.domainName).length > 0) {
            address live = walletDomain.resolveDomain(plan.domainName);
            if (live == address(0) || live != plan.recipient) {
                plan.active = false;
                lastOutcome[planId] = OUTCOME_HALTED_DOMAIN;
                emit PlanHalted(planId, plan.user, OUTCOME_HALTED_DOMAIN);
                return OUTCOME_HALTED_DOMAIN;
            }
        }

        (, , , uint256 healthFactor) = lendingPool.getUserAccountData(plan.user);
        if (healthFactor < plan.minHealthFactorWad) {
            if (ownerExec) revert HealthTooLow();
            return _skip(planId, plan, OUTCOME_SKIPPED_HEALTH);
        }

        uint256 walletBalance = IERC20(plan.token).balanceOf(plan.user);
        if (walletBalance < plan.amount) {
            if (ownerExec) revert InsufficientWalletBalance();
            return _skip(planId, plan, OUTCOME_SKIPPED_BALANCE);
        }

        IERC20(plan.token).safeTransferFrom(plan.user, plan.recipient, plan.amount);
        plan.nextRunAt = uint64(block.timestamp + plan.interval);
        lastOutcome[planId] = OUTCOME_PAID;
        emit PlanExecuted(
            planId,
            plan.user,
            plan.recipient,
            plan.amount,
            plan.nextRunAt
        );
        return OUTCOME_PAID;
    }

    function _skip(
        uint256 planId,
        Plan storage plan,
        bytes32 reason
    ) private returns (bytes32) {
        plan.nextRunAt = uint64(block.timestamp + plan.interval);
        lastOutcome[planId] = reason;
        emit PlanSkipped(planId, plan.user, reason, plan.nextRunAt);
        return reason;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
