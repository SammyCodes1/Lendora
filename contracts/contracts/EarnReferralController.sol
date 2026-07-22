// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IReferralEarnVault {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function deposit(uint256 assets, address receiver, uint256 minShares) external returns (uint256 shares);
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
}

/// @title ArcLend Earn Referral Controller
/// @notice Routes Earn Vault deposits, records referrers, and accrues asset rewards plus level-based points.
contract EarnReferralController is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant MIN_LEVEL = 1;
    uint8 public constant MAX_LEVEL = 5;
    uint256 public constant BPS = 10_000;
    uint256 public constant POINT_UNIT = 1e6;
    uint16 public constant MAX_ACTIVITY_POINT_MULTIPLIER = 1_000;
    uint8 public constant MAX_REFERRAL_DEPTH = 32;
    uint256 public constant MIN_REWARD_HOLDING_PERIOD = 30 days;

    bytes32 public constant ACTIVITY_EARN_DEPOSIT = keccak256("EARN_DEPOSIT");
    bytes32 public constant ACTIVITY_LEND_DEPOSIT = keccak256("LEND_DEPOSIT");
    bytes32 public constant ACTIVITY_BORROW = keccak256("BORROW");
    bytes32 public constant ACTIVITY_REPAY = keccak256("REPAY");
    bytes32 public constant ACTIVITY_DOMAIN_MINT = keccak256("DOMAIN_MINT");
    bytes32 public constant ACTIVITY_DOMAIN_PURCHASE = keccak256("DOMAIN_PURCHASE");

    struct VaultConfig {
        address asset;
        bool enabled;
    }

    struct ReferralRewardPosition {
        address referrer;
        address asset;
        uint128 qualifyingAssets;
        uint128 reward;
        uint64 unlockAt;
        bool finalized;
    }

    mapping(address => VaultConfig) public vaultConfigs;
    mapping(address => address) public referrerOf;
    mapping(address => uint8) private referrerLevels;
    mapping(uint8 => uint16) public rewardBpsByLevel;
    mapping(address => uint256) public rewardReserves;
    mapping(address => mapping(address => uint256)) public pendingRewards;
    mapping(address => mapping(address => uint256)) public referredVolume;
    mapping(address => uint256) public pendingPoints;
    mapping(address => uint256) public claimedPoints;
    mapping(address => uint256) public referredUsers;
    mapping(address => bool) public activityRecorders;
    mapping(bytes32 => bool) public recordedActivity;
    mapping(bytes32 => uint16) public activityPointMultiplier;
    mapping(address => mapping(bytes32 => uint256)) public userActivityVolume;
    mapping(address => mapping(bytes32 => uint256)) public userActivityPoints;
    mapping(address => mapping(address => uint256)) public rewardedPrincipal;
    mapping(address => mapping(address => ReferralRewardPosition)) public referralRewardPositions;

    event VaultConfigured(address indexed vault, address indexed asset, bool enabled);
    event ReferrerRegistered(address indexed user, address indexed referrer);
    event ReferralLevelUpdated(address indexed referrer, uint8 level);
    event ReferralRewardRateUpdated(uint8 indexed level, uint16 rewardBps);
    event ReferralRewardsFunded(address indexed asset, address indexed funder, uint256 amount);
    event ReferralDeposit(
        address indexed vault,
        address indexed user,
        address indexed referrer,
        address asset,
        uint256 assets,
        uint256 reward,
        uint256 points
    );
    event ReferralRewardClaimed(address indexed referrer, address indexed asset, address indexed receiver, uint256 amount);
    event ReferralRewardScheduled(
        address indexed vault,
        address indexed user,
        address indexed referrer,
        address asset,
        uint256 qualifyingAssets,
        uint256 reward,
        uint256 unlockAt
    );
    event ReferralRewardFinalized(address indexed vault, address indexed user, address indexed referrer, uint256 reward);
    event ReferralRewardForfeited(address indexed vault, address indexed user, address indexed referrer, uint256 reward);
    event ReferralPointsClaimed(address indexed referrer, uint256 points);
    event ActivityRecorderUpdated(address indexed recorder, bool approved);
    event ActivityPointMultiplierUpdated(bytes32 indexed activity, uint16 multiplier);
    event ActivityRecorded(
        bytes32 indexed eventId,
        address indexed user,
        bytes32 indexed activity,
        uint256 amount,
        uint256 points
    );
    event ActivityPointsEarned(address indexed user, bytes32 indexed activity, uint256 amount, uint256 points);

    modifier onlyActivityRecorder() {
        require(
            msg.sender == owner() || activityRecorders[msg.sender],
            "ReferralController: not activity recorder"
        );
        _;
    }

    constructor(address owner_) Ownable(owner_) {
        require(owner_ != address(0), "ReferralController: zero owner");
        rewardBpsByLevel[1] = 5;
        rewardBpsByLevel[2] = 10;
        rewardBpsByLevel[3] = 15;
        rewardBpsByLevel[4] = 20;
        rewardBpsByLevel[5] = 25;
        activityPointMultiplier[ACTIVITY_EARN_DEPOSIT] = 1;
        activityPointMultiplier[ACTIVITY_LEND_DEPOSIT] = 1;
        activityPointMultiplier[ACTIVITY_BORROW] = 1;
        activityPointMultiplier[ACTIVITY_REPAY] = 1;
        activityPointMultiplier[ACTIVITY_DOMAIN_MINT] = 50;
        activityPointMultiplier[ACTIVITY_DOMAIN_PURCHASE] = 25;
    }

    function configureVault(address vault, address asset, bool enabled) external onlyOwner {
        require(vault != address(0), "ReferralController: zero vault");
        require(asset != address(0), "ReferralController: zero asset");
        vaultConfigs[vault] = VaultConfig({asset: asset, enabled: enabled});
        emit VaultConfigured(vault, asset, enabled);
    }

    function setRewardBps(uint8 level, uint16 rewardBps) external onlyOwner {
        require(level >= MIN_LEVEL && level <= MAX_LEVEL, "ReferralController: invalid level");
        require(rewardBps <= 100, "ReferralController: reward too high");
        rewardBpsByLevel[level] = rewardBps;
        emit ReferralRewardRateUpdated(level, rewardBps);
    }

    function setReferralLevel(address referrer, uint8 level) external onlyOwner {
        require(referrer != address(0), "ReferralController: zero referrer");
        require(level >= MIN_LEVEL && level <= MAX_LEVEL, "ReferralController: invalid level");
        referrerLevels[referrer] = level;
        emit ReferralLevelUpdated(referrer, level);
    }

    function setActivityRecorder(address recorder, bool approved) external onlyOwner {
        require(recorder != address(0), "ReferralController: zero recorder");
        activityRecorders[recorder] = approved;
        emit ActivityRecorderUpdated(recorder, approved);
    }

    function setActivityPointMultiplier(bytes32 activity, uint16 multiplier) external onlyOwner {
        require(activity != bytes32(0), "ReferralController: zero activity");
        require(multiplier <= MAX_ACTIVITY_POINT_MULTIPLIER, "ReferralController: multiplier too high");
        activityPointMultiplier[activity] = multiplier;
        emit ActivityPointMultiplierUpdated(activity, multiplier);
    }

    function referralLevel(address referrer) public view returns (uint8) {
        uint8 level = referrerLevels[referrer];
        return level == 0 ? MIN_LEVEL : level;
    }

    function registerReferrer(address referrer) external {
        _registerReferrer(msg.sender, referrer);
    }

    function fundRewards(address asset, uint256 amount) external onlyOwner nonReentrant {
        require(asset != address(0), "ReferralController: zero asset");
        require(amount > 0, "ReferralController: zero amount");
        uint256 balanceBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        require(
            IERC20(asset).balanceOf(address(this)) - balanceBefore == amount,
            "ReferralController: unsupported token"
        );
        rewardReserves[asset] += amount;
        emit ReferralRewardsFunded(asset, msg.sender, amount);
    }

    function depositWithReferral(
        address vault,
        uint256 assets,
        address receiver,
        address referrer
    ) external nonReentrant returns (uint256 shares) {
        return _depositWithReferral(vault, assets, receiver, referrer, 0);
    }

    function depositWithReferral(
        address vault,
        uint256 assets,
        address receiver,
        address referrer,
        uint256 minShares
    ) external nonReentrant returns (uint256 shares) {
        return _depositWithReferral(vault, assets, receiver, referrer, minShares);
    }

    function _depositWithReferral(
        address vault,
        uint256 assets,
        address receiver,
        address referrer,
        uint256 minShares
    ) internal returns (uint256 shares) {
        VaultConfig memory config = vaultConfigs[vault];
        require(config.enabled, "ReferralController: vault disabled");
        require(receiver != address(0), "ReferralController: zero receiver");
        require(assets > 0, "ReferralController: zero assets");

        if (referrer != address(0) && referrerOf[receiver] == address(0)) {
            require(receiver == msg.sender, "ReferralController: receiver must register");
            _registerReferrer(receiver, referrer);
        }

        uint256 positionBefore = IReferralEarnVault(vault).convertToAssets(
            IReferralEarnVault(vault).balanceOf(receiver)
        );
        uint256 balanceBefore = IERC20(config.asset).balanceOf(address(this));
        IERC20(config.asset).safeTransferFrom(msg.sender, address(this), assets);
        require(
            IERC20(config.asset).balanceOf(address(this)) - balanceBefore == assets,
            "ReferralController: unsupported token"
        );
        IERC20(config.asset).forceApprove(vault, assets);
        shares = IReferralEarnVault(vault).deposit(assets, receiver, minShares);

        uint256 positionAfter = IReferralEarnVault(vault).convertToAssets(
            IReferralEarnVault(vault).balanceOf(receiver)
        );
        require(positionAfter >= positionBefore, "ReferralController: position decreased");
        uint256 highWater = rewardedPrincipal[receiver][vault];
        uint256 eligibleAssets = positionAfter > highWater ? positionAfter - highWater : 0;
        if (positionAfter > highWater) {
            rewardedPrincipal[receiver][vault] = positionAfter;
        }

        _accrueReferral(vault, config.asset, receiver, eligibleAssets);
        _awardActivityPoints(receiver, ACTIVITY_EARN_DEPOSIT, eligibleAssets);
    }

    function recordActivity(
        bytes32 eventId,
        address user,
        bytes32 activity,
        uint256 amount
    ) external onlyActivityRecorder returns (uint256 points) {
        require(eventId != bytes32(0), "ReferralController: zero event");
        require(user != address(0), "ReferralController: zero user");
        require(amount > 0, "ReferralController: zero amount");
        require(!recordedActivity[eventId], "ReferralController: activity recorded");
        require(activityPointMultiplier[activity] > 0, "ReferralController: activity disabled");

        recordedActivity[eventId] = true;
        points = _awardActivityPoints(user, activity, amount);
        emit ActivityRecorded(eventId, user, activity, amount, points);
    }

    function claimRewards(address asset, address receiver) external nonReentrant returns (uint256 amount) {
        require(receiver != address(0), "ReferralController: zero receiver");
        require(receiver != address(this), "ReferralController: invalid receiver");
        amount = pendingRewards[msg.sender][asset];
        require(amount > 0, "ReferralController: no rewards");

        pendingRewards[msg.sender][asset] = 0;
        uint256 receiverBefore = IERC20(asset).balanceOf(receiver);
        uint256 controllerBefore = IERC20(asset).balanceOf(address(this));
        IERC20(asset).safeTransfer(receiver, amount);
        require(
            IERC20(asset).balanceOf(receiver) - receiverBefore == amount &&
                controllerBefore - IERC20(asset).balanceOf(address(this)) == amount,
            "ReferralController: unsupported token"
        );
        emit ReferralRewardClaimed(msg.sender, asset, receiver, amount);
    }

    function finalizeReferralReward(address vault, address user) external nonReentrant returns (uint256 reward) {
        ReferralRewardPosition storage position = referralRewardPositions[user][vault];
        require(position.referrer != address(0), "ReferralController: reward not scheduled");
        require(!position.finalized, "ReferralController: reward finalized");
        require(block.timestamp >= position.unlockAt, "ReferralController: reward locked");

        uint256 currentAssets = IReferralEarnVault(vault).convertToAssets(
            IReferralEarnVault(vault).balanceOf(user)
        );
        require(currentAssets >= position.qualifyingAssets, "ReferralController: holding requirement");

        position.finalized = true;
        reward = position.reward;
        address referrer = position.referrer;
        address asset = position.asset;
        pendingRewards[referrer][asset] += reward;
        emit ReferralRewardFinalized(vault, user, referrer, reward);
        delete referralRewardPositions[user][vault];
    }

    function forfeitReferralReward(address vault, address user) external nonReentrant returns (uint256 reward) {
        ReferralRewardPosition storage position = referralRewardPositions[user][vault];
        require(position.referrer != address(0), "ReferralController: reward not scheduled");
        require(!position.finalized, "ReferralController: reward finalized");
        require(block.timestamp >= position.unlockAt, "ReferralController: reward locked");

        uint256 currentAssets = IReferralEarnVault(vault).convertToAssets(
            IReferralEarnVault(vault).balanceOf(user)
        );
        require(currentAssets < position.qualifyingAssets, "ReferralController: holding requirement met");

        position.finalized = true;
        reward = position.reward;
        address referrer = position.referrer;
        address asset = position.asset;
        rewardReserves[asset] += reward;
        emit ReferralRewardForfeited(vault, user, referrer, reward);
        delete referralRewardPositions[user][vault];
    }

    function claimPoints() external nonReentrant returns (uint256 points) {
        points = pendingPoints[msg.sender];
        require(points > 0, "ReferralController: no points");

        pendingPoints[msg.sender] = 0;
        claimedPoints[msg.sender] += points;
        emit ReferralPointsClaimed(msg.sender, points);
    }

    function _registerReferrer(address user, address referrer) internal {
        require(user != address(0), "ReferralController: zero user");
        require(referrer != address(0), "ReferralController: zero referrer");
        require(referrer != user, "ReferralController: self referral");
        require(referrerOf[user] == address(0), "ReferralController: referrer set");

        address cursor = referrer;
        for (uint8 depth = 0; depth < MAX_REFERRAL_DEPTH; depth++) {
            require(cursor != user, "ReferralController: circular referral");
            cursor = referrerOf[cursor];
            if (cursor == address(0)) {
                break;
            }
        }
        require(cursor == address(0), "ReferralController: referral chain too deep");

        referrerOf[user] = referrer;
        referredUsers[referrer] += 1;
        emit ReferrerRegistered(user, referrer);
    }

    function _accrueReferral(address vault, address asset, address user, uint256 assets) internal {
        address referrer = referrerOf[user];
        if (referrer == address(0)) {
            return;
        }

        if (assets == 0) {
            emit ReferralDeposit(vault, user, referrer, asset, 0, 0, 0);
            return;
        }

        uint8 level = referralLevel(referrer);
        uint256 reward;
        ReferralRewardPosition storage position = referralRewardPositions[user][vault];
        if (position.referrer == address(0)) {
            reward = (assets * rewardBpsByLevel[level]) / BPS;
            uint256 reserve = rewardReserves[asset];
            if (reward > reserve) {
                reward = reserve;
            }
            if (reward > 0) {
                rewardReserves[asset] = reserve - reward;
                require(assets <= type(uint128).max && reward <= type(uint128).max, "ReferralController: value overflow");
                uint256 unlockAt = block.timestamp + MIN_REWARD_HOLDING_PERIOD;
                position.referrer = referrer;
                position.asset = asset;
                position.qualifyingAssets = uint128(assets);
                position.reward = uint128(reward);
                position.unlockAt = uint64(unlockAt);
                emit ReferralRewardScheduled(vault, user, referrer, asset, assets, reward, unlockAt);
            }
        }

        uint256 points = (assets * level) / POINT_UNIT;
        pendingPoints[referrer] += points;
        referredVolume[referrer][asset] += assets;

        emit ReferralDeposit(vault, user, referrer, asset, assets, reward, points);
    }

    function _awardActivityPoints(address user, bytes32 activity, uint256 amount) internal returns (uint256 points) {
        uint16 multiplier = activityPointMultiplier[activity];
        if (multiplier == 0) {
            return 0;
        }

        points = (amount * multiplier) / POINT_UNIT;
        if (points > 0) {
            pendingPoints[user] += points;
            userActivityPoints[user][activity] += points;
        }
        userActivityVolume[user][activity] += amount;

        emit ActivityPointsEarned(user, activity, amount, points);
    }
}
