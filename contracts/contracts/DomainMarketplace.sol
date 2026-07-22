// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWalletDomain is IERC721 {
    function tokenIdOf(string memory domainName) external pure returns (uint256);
}

contract DomainMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Listing {
        address seller;
        uint256 price;
    }

    IWalletDomain public immutable walletDomain;
    IERC20 public immutable paymentToken;

    mapping(uint256 => Listing) public listings;

    event DomainListed(
        uint256 indexed tokenId,
        address indexed seller,
        uint256 price
    );
    event DomainListingCancelled(uint256 indexed tokenId, address indexed seller);
    event DomainPurchased(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price
    );

    error InvalidAddress();
    error InvalidPrice();
    error NotDomainOwner();
    error MarketplaceNotApproved();
    error NotListed();
    error SellerNoLongerOwnsDomain();
    error SellerCannotBuy();
    error ListingStillValid();
    error PriceExceedsMaximum();

    constructor(address walletDomain_, address paymentToken_) {
        if (walletDomain_ == address(0) || paymentToken_ == address(0)) {
            revert InvalidAddress();
        }

        walletDomain = IWalletDomain(walletDomain_);
        paymentToken = IERC20(paymentToken_);
    }

    function listDomain(string calldata domainName, uint256 price) external {
        list(walletDomain.tokenIdOf(domainName), price);
    }

    function list(uint256 tokenId, uint256 price) public {
        if (price == 0) revert InvalidPrice();
        if (walletDomain.ownerOf(tokenId) != msg.sender) revert NotDomainOwner();
        if (!_isMarketplaceApproved(tokenId, msg.sender)) {
            revert MarketplaceNotApproved();
        }

        listings[tokenId] = Listing({ seller: msg.sender, price: price });
        emit DomainListed(tokenId, msg.sender, price);
    }

    function updateListing(uint256 tokenId, uint256 price) external {
        if (price == 0) revert InvalidPrice();
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert NotListed();
        if (listing.seller != msg.sender) revert NotDomainOwner();
        if (walletDomain.ownerOf(tokenId) != msg.sender) revert NotDomainOwner();
        if (!_isMarketplaceApproved(tokenId, msg.sender)) {
            revert MarketplaceNotApproved();
        }

        listings[tokenId] = Listing({ seller: msg.sender, price: price });
        emit DomainListed(tokenId, msg.sender, price);
    }

    function cancelListing(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert NotListed();
        if (listing.seller != msg.sender) revert NotDomainOwner();

        delete listings[tokenId];
        emit DomainListingCancelled(tokenId, msg.sender);
    }

    function clearStaleListing(uint256 tokenId) external {
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert NotListed();

        try walletDomain.ownerOf(tokenId) returns (address currentOwner) {
            if (
                currentOwner == listing.seller &&
                _isMarketplaceApproved(tokenId, listing.seller)
            ) {
                revert ListingStillValid();
            }
        } catch {
            // Burned or otherwise invalid token ids are stale listings.
        }

        delete listings[tokenId];
        emit DomainListingCancelled(tokenId, listing.seller);
    }

    function buy(uint256 tokenId, uint256 maxPrice) external nonReentrant {
        Listing memory listing = listings[tokenId];
        if (listing.seller == address(0)) revert NotListed();
        if (listing.seller == msg.sender) revert SellerCannotBuy();
        if (maxPrice == 0 || listing.price > maxPrice) revert PriceExceedsMaximum();
        if (walletDomain.ownerOf(tokenId) != listing.seller) {
            revert SellerNoLongerOwnsDomain();
        }
        if (!_isMarketplaceApproved(tokenId, listing.seller)) {
            revert MarketplaceNotApproved();
        }

        delete listings[tokenId];

        uint256 sellerBalanceBefore = paymentToken.balanceOf(listing.seller);
        uint256 buyerBalanceBefore = paymentToken.balanceOf(msg.sender);
        paymentToken.safeTransferFrom(msg.sender, listing.seller, listing.price);
        if (
            paymentToken.balanceOf(listing.seller) - sellerBalanceBefore != listing.price ||
            buyerBalanceBefore - paymentToken.balanceOf(msg.sender) != listing.price
        ) revert InvalidPrice();
        walletDomain.transferFrom(listing.seller, msg.sender, tokenId);

        emit DomainPurchased(tokenId, listing.seller, msg.sender, listing.price);
    }

    function _isMarketplaceApproved(
        uint256 tokenId,
        address owner
    ) private view returns (bool) {
        return
            walletDomain.getApproved(tokenId) == address(this) ||
            walletDomain.isApprovedForAll(owner, address(this));
    }
}
