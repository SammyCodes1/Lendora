// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title ArcLend Position NFT
/// @notice On-chain receipt linked to a live ArcLend aToken or debt-token balance.
contract PositionNFT is ERC721, Ownable {
    using Strings for uint256;

    error PositionReceiptNonTransferable();

    enum PositionType {
        SUPPLY,
        BORROW
    }

    struct PositionInfo {
        address asset;
        PositionType positionType;
        address linkedToken;
        uint256 openedAt;
    }

    mapping(uint256 => PositionInfo) public positions;
    mapping(address => mapping(address => mapping(uint8 => uint256))) public userPositionToken;

    uint256 public nextTokenId = 1;
    address public minter;
    address public pendingMinter;

    event MinterConfigured(address indexed minter);
    event MinterTransferStarted(address indexed currentMinter, address indexed pendingMinter);
    event MinterTransferCancelled(address indexed pendingMinter);

    constructor() ERC721("ArcLend Position Receipt", "ARCPOS") Ownable(msg.sender) {}

    /// @notice Permanently configures the only account allowed to mint and burn receipts.
    function setMinter(address _minter) external onlyOwner {
        require(minter == address(0), "Minter already set");
        require(_minter != address(0), "Zero minter");
        minter = _minter;
        emit MinterConfigured(_minter);
    }

    function proposeMinter(address _pendingMinter) external onlyOwner {
        require(minter != address(0), "Minter not initialized");
        require(_pendingMinter != address(0), "Zero minter");
        require(_pendingMinter != minter, "Minter unchanged");
        pendingMinter = _pendingMinter;
        emit MinterTransferStarted(minter, _pendingMinter);
    }

    function acceptMinter() external {
        require(msg.sender == pendingMinter, "Only pending minter");
        minter = pendingMinter;
        pendingMinter = address(0);
        emit MinterConfigured(minter);
    }

    function cancelMinterTransfer() external onlyOwner {
        address cancelledMinter = pendingMinter;
        require(cancelledMinter != address(0), "No pending minter");
        pendingMinter = address(0);
        emit MinterTransferCancelled(cancelledMinter);
    }

    function mint(
        address to,
        address asset,
        PositionType positionType,
        address linkedToken
    ) external returns (uint256) {
        require(msg.sender == minter, "Only PositionManager");
        require(to != address(0), "Zero recipient");
        require(asset != address(0) && linkedToken != address(0), "Zero position address");
        require(
            userPositionToken[to][asset][uint8(positionType)] == 0,
            "Position NFT already exists"
        );

        uint256 tokenId = nextTokenId++;
        positions[tokenId] = PositionInfo(asset, positionType, linkedToken, block.timestamp);
        userPositionToken[to][asset][uint8(positionType)] = tokenId;
        _safeMint(to, tokenId);
        return tokenId;
    }

    function burn(uint256 tokenId) external {
        require(msg.sender == minter, "Only PositionManager");
        PositionInfo memory info = positions[tokenId];
        address owner = ownerOf(tokenId);
        delete userPositionToken[owner][info.asset][uint8(info.positionType)];
        delete positions[tokenId];
        _burn(tokenId);
    }

    /// @notice Position receipts are bound to the account whose live indexed balance they track.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address previousOwner)
    {
        previousOwner = super._update(to, tokenId, auth);
        if (previousOwner != address(0) && to != address(0)) {
            revert PositionReceiptNonTransferable();
        }
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        address owner = ownerOf(tokenId);
        PositionInfo memory info = positions[tokenId];
        uint256 liveBalance = IERC20(info.linkedToken).balanceOf(owner);
        string memory assetSymbol = IERC20Metadata(info.asset).symbol();
        uint8 decimals = IERC20Metadata(info.asset).decimals();
        string memory typeLabel =
            info.positionType == PositionType.SUPPLY ? "SUPPLY" : "BORROW";
        string memory balanceLabel = string.concat(
            _formatAmount(liveBalance, decimals),
            " ",
            assetSymbol
        );
        string memory openedDate = _formatDate(info.openedAt);

        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720">',
            "<defs>",
            '<filter id="glow"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
            '<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#161616"/><stop offset="1" stop-color="#030303"/></linearGradient>',
            "</defs>",
            '<rect width="720" height="720" fill="#000000"/>',
            '<rect x="42" y="42" width="636" height="636" rx="42" fill="url(#glass)" stroke="#FFFFFF" stroke-opacity=".72" stroke-width="2" filter="url(#glow)"/>',
            '<path d="M88 218 C220 78 455 72 632 182" fill="none" stroke="#FFFFFF" stroke-opacity=".18" stroke-width="12" stroke-linecap="round"/>',
            '<path d="M120 230 C245 122 438 116 600 196" fill="none" stroke="#FFFFFF" stroke-opacity=".08" stroke-width="5" stroke-linecap="round"/>',
            '<text x="88" y="120" fill="#FFFFFF" fill-opacity=".55" font-family="Arial,sans-serif" font-size="22">ARCLEND POSITION</text>',
            '<text x="88" y="330" fill="#FFFFFF" font-family="Arial,sans-serif" font-size="92" font-weight="700">',
            typeLabel,
            "</text>",
            '<text x="88" y="414" fill="#FFFFFF" font-family="monospace" font-size="42">',
            balanceLabel,
            "</text>",
            '<line x1="88" y1="462" x2="632" y2="462" stroke="#FFFFFF" stroke-opacity=".16"/>',
            '<text x="88" y="520" fill="#FFFFFF" fill-opacity=".7" font-family="Arial,sans-serif" font-size="24">ArcLend Position #',
            tokenId.toString(),
            "</text>",
            '<text x="88" y="562" fill="#FFFFFF" fill-opacity=".42" font-family="Arial,sans-serif" font-size="20">Opened ',
            openedDate,
            "</text>",
            '<text x="88" y="620" fill="#FFFFFF" fill-opacity=".28" font-family="Arial,sans-serif" font-size="17">Live balance read from Arc Testnet</text>',
            "</svg>"
        );

        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(svg))
        );
        string memory json = string.concat(
            '{"name":"ArcLend ',
            typeLabel,
            " ",
            assetSymbol,
            " Position #",
            tokenId.toString(),
            '","description":"On-chain receipt for a live ArcLend position on Arc Testnet.",',
            '"image":"',
            image,
            '","attributes":[',
            '{"trait_type":"Type","value":"',
            typeLabel,
            '"},',
            '{"trait_type":"Asset","value":"',
            assetSymbol,
            '"},',
            '{"trait_type":"Opened","value":',
            info.openedAt.toString(),
            "}",
            "]}"
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }

    function _formatAmount(uint256 amount, uint8 decimals) internal pure returns (string memory) {
        if (decimals == 0) {
            return amount.toString();
        }

        uint256 unit = 10 ** uint256(decimals);
        uint256 whole = amount / unit;
        uint256 fraction = amount % unit;
        if (fraction == 0) {
            return whole.toString();
        }

        string memory rawFraction = _leftPad(fraction.toString(), decimals);
        bytes memory fractionBytes = bytes(rawFraction);
        uint256 end = fractionBytes.length;
        while (end > 0 && fractionBytes[end - 1] == bytes1("0")) {
            end--;
        }
        bytes memory trimmed = new bytes(end);
        for (uint256 i = 0; i < end; i++) {
            trimmed[i] = fractionBytes[i];
        }
        return string.concat(whole.toString(), ".", string(trimmed));
    }

    function _leftPad(string memory value, uint256 length) internal pure returns (string memory) {
        bytes memory raw = bytes(value);
        if (raw.length >= length) {
            return value;
        }
        bytes memory padded = new bytes(length);
        uint256 padding = length - raw.length;
        for (uint256 i = 0; i < padding; i++) {
            padded[i] = bytes1("0");
        }
        for (uint256 i = 0; i < raw.length; i++) {
            padded[padding + i] = raw[i];
        }
        return string(padded);
    }

    function _formatDate(uint256 timestamp) internal pure returns (string memory) {
        (uint256 year, uint256 month, uint256 day) = _daysToDate(timestamp / 1 days);
        return string.concat(
            year.toString(),
            "-",
            _twoDigits(month),
            "-",
            _twoDigits(day)
        );
    }

    function _twoDigits(uint256 value) internal pure returns (string memory) {
        return value < 10 ? string.concat("0", value.toString()) : value.toString();
    }

    // Gregorian date conversion adapted from the public-domain BokkyPooBah date algorithm.
    function _daysToDate(uint256 daysSinceEpoch)
        internal
        pure
        returns (uint256 year, uint256 month, uint256 day)
    {
        int256 __days = int256(daysSinceEpoch);
        int256 L = __days + 68_569 + 2_440_588;
        int256 N = (4 * L) / 146_097;
        L = L - (146_097 * N + 3) / 4;
        int256 _year = (4_000 * (L + 1)) / 1_461_001;
        L = L - (1_461 * _year) / 4 + 31;
        int256 _month = (80 * L) / 2_447;
        int256 _day = L - (2_447 * _month) / 80;
        L = _month / 11;
        _month = _month + 2 - 12 * L;
        _year = 100 * (N - 49) + _year + L;
        year = uint256(_year);
        month = uint256(_month);
        day = uint256(_day);
    }
}
