// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashLoanPool {
    function flashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external;
}

interface IFlashLoanReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 fee,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface ITreasuryRouter {
    function withdraw(
        address asset,
        address to,
        uint256 amount
    ) external;
}

/// @title ArcLend LaaSRouter
/// @notice Liquidity-as-a-Service partner router. Routes flash loans through
///         FlashLoanPool and pays partner fee-shares from the protocol
///         Treasury — finally backed by real, accounted-for funds rather
///         than an undefined source.
///
///         The router itself implements IFlashLoanReceiver so it can relay
///         the callback to the actual user's IFlashLoanReceiver contract.
contract LaaSRouter is Ownable, ReentrancyGuard, IFlashLoanReceiver {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Partner registration.
    struct Partner {
        address payoutAddress;
        uint256 shareBps; // partner's share of the flash loan fee, in bps
        bool active;
    }

    /// @notice Partner registry, keyed by a user-provided partnerId.
    mapping(bytes32 => Partner) public partners;

    /// @notice The FlashLoanPool this router pulls liquidity from.
    address public flashLoanPool;
    /// @notice The protocol Treasury that holds fee revenue for partner payouts.
    address public treasury;

    /// @notice Global default partner share bps for partners without a custom
    ///         shareBps set. Default 5000 = 50% of the fee goes to partner.
    uint256 public defaultPartnerShareBps = 5000;

    // ─── Events ───────────────────────────────────────────────────────

    event PartnerRegistered(
        bytes32 indexed partnerId,
        address indexed payoutAddress,
        uint256 shareBps
    );
    event PartnerUpdated(
        bytes32 indexed partnerId,
        address indexed payoutAddress,
        uint256 shareBps,
        bool active
    );
    event FlashLoanViaPartner(
        bytes32 indexed partnerId,
        address indexed initiator,
        address asset,
        uint256 amount,
        uint256 fee,
        uint256 partnerShare
    );
    event FlashLoanPoolUpdated(address flashLoanPool);
    event TreasuryUpdated(address treasury);
    event DefaultPartnerShareBpsUpdated(uint256 shareBps);

    constructor(address owner_) Ownable(owner_) {
        require(owner_ != address(0), "LaaSRouter: zero owner");
    }

    // ─── Owner administration ─────────────────────────────────────────

    function setFlashLoanPool(address _flashLoanPool) external onlyOwner {
        flashLoanPool = _flashLoanPool;
        emit FlashLoanPoolUpdated(_flashLoanPool);
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setDefaultPartnerShareBps(uint256 newShareBps) external onlyOwner {
        require(newShareBps <= BPS_DENOMINATOR, "Cannot exceed 100%");
        defaultPartnerShareBps = newShareBps;
        emit DefaultPartnerShareBpsUpdated(newShareBps);
    }

    /// @notice Register a new LaaS partner.
    /// @param partnerId      Unique partner identifier (e.g. keccak256("acme-finance")).
    /// @param payoutAddress  Address that receives partner fee-shares.
    /// @param shareBps       Partner's basis-point share of each flash loan fee.
    ///                       0 means "use defaultPartnerShareBps".
    function registerPartner(
        bytes32 partnerId,
        address payoutAddress,
        uint256 shareBps
    ) external onlyOwner {
        require(payoutAddress != address(0), "LaaSRouter: zero payout");
        require(shareBps <= BPS_DENOMINATOR, "LaaSRouter: share > 100%");
        partners[partnerId] = Partner({
            payoutAddress: payoutAddress,
            shareBps: shareBps,
            active: true
        });
        emit PartnerRegistered(partnerId, payoutAddress, shareBps);
    }

    function updatePartner(
        bytes32 partnerId,
        address payoutAddress,
        uint256 shareBps,
        bool active
    ) external onlyOwner {
        require(payoutAddress != address(0), "LaaSRouter: zero payout");
        require(shareBps <= BPS_DENOMINATOR, "LaaSRouter: share > 100%");
        partners[partnerId] = Partner({
            payoutAddress: payoutAddress,
            shareBps: shareBps,
            active: active
        });
        emit PartnerUpdated(partnerId, payoutAddress, shareBps, active);
    }

    // ─── Flash loan via partner ───────────────────────────────────────

    /// @notice Execute a flash loan routed through a LaaS partner.
    /// @dev The caller (initiator) MUST implement IFlashLoanReceiver,
    ///      as this router relays the callback. This function:
    ///        1. Executes the flash loan via FlashLoanPool.
    ///        2. After repayment, computes the partner's fee share.
    ///        3. Pulls the partner payout FROM the protocol Treasury
    ///           (backed by real treasuryShareBps revenue from Step 2).
    ///
    ///      Treasury.withdraw() authorisation: this contract MUST be
    ///      registered as an authorizedSpender on Treasury.sol for the
    ///      automated payout path to work. If it is NOT authorized, the
    ///      withdraw call will revert and the flash loan will fail.
    ///
    ///      Alternative (if you prefer manual review): skip the automated
    ///      withdraw here, emit an event instead, and have the Treasury
    ///      owner batch-pay partners periodically.
    function flashLoanViaPartner(
        address asset,
        uint256 amount,
        bytes32 partnerId,
        bytes calldata userParams
    ) external nonReentrant {
        Partner storage partner = partners[partnerId];
        require(partner.active, "LaaSRouter: partner not active");

        // Encode the partner id and user params so we can decode them
        // in executeOperation.
        bytes memory routerParams = abi.encode(
            partnerId,
            msg.sender, // the initiator / end-user
            userParams
        );

        // Execute the flash loan. FlashLoanPool calls back to
        // this contract's executeOperation(), which forwards to the
        // initiator.
        IFlashLoanPool(flashLoanPool).flashLoan(asset, amount, routerParams);
    }

    // ─── IFlashLoanReceiver (relay) ───────────────────────────────────

    /// @notice Called by FlashLoanPool during a flash loan initiated via
    ///         flashLoanViaPartner(). Relays the callback to the original
    ///         initiator.
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 fee,
        address, /* initiator — FlashLoanPool passes itself, we ignore it */
        bytes calldata params
    ) external override returns (bool) {
        // Only FlashLoanPool may call this.
        require(msg.sender == flashLoanPool, "LaaSRouter: not pool");

        // Decode params set in flashLoanViaPartner.
        (bytes32 partnerId, address user, bytes memory userParams) =
            abi.decode(params, (bytes32, address, bytes));

        // Forward funds to the actual user.
        IERC20(asset).safeTransfer(user, amount);

        // Call the actual user's callback.
        require(
            IFlashLoanReceiver(user).executeOperation(
                asset,
                amount,
                fee,
                user,
                userParams
            ),
            "LaaSRouter: user callback failed"
        );

        // User should have repaid to this contract. Now repay FlashLoanPool.
        uint256 repayAmount = amount + fee;
        IERC20(asset).approve(flashLoanPool, repayAmount);
        IERC20(asset).safeTransfer(flashLoanPool, repayAmount);

        // ─── Partner payout FROM Treasury ────────────────────────────
        // At this point FlashLoanPool has already deposited the
        // treasuryCut into Treasury (in its own flashLoan() function),
        // so Treasury actually holds the funds to pay this out.
        Partner storage partner = partners[partnerId];
        uint256 effectiveShareBps = partner.shareBps > 0
            ? partner.shareBps
            : defaultPartnerShareBps;
        uint256 partnerShare = (fee * effectiveShareBps) / BPS_DENOMINATOR;

        if (partnerShare > 0 && treasury != address(0)) {
            // LaaSRouter must be an authorizedSpender on Treasury for
            // this to succeed. If not authorized, the admin can instead
            // listen for FlashLoanViaPartner events and batch-pay.
            ITreasuryRouter(treasury).withdraw(
                asset,
                partner.payoutAddress,
                partnerShare
            );
        }

        emit FlashLoanViaPartner(
            partnerId,
            user,
            asset,
            amount,
            fee,
            partnerShare
        );

        return true;
    }

    // ─── Views ────────────────────────────────────────────────────────

    function getPartner(bytes32 partnerId)
        external
        view
        returns (Partner memory)
    {
        return partners[partnerId];
    }
}
