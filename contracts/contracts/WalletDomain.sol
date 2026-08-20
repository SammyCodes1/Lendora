// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract WalletDomain is ERC721Enumerable {
    uint256 public constant MIN_COMMITMENT_AGE_BLOCKS = 1;
    uint256 public constant MAX_COMMITMENT_AGE_BLOCKS = 256;

    struct DomainCommitment {
        address committer;
        uint64 blockNumber;
    }

    mapping(uint256 => string) public domainNames;
    mapping(address => uint256) private primaryTokenIds;
    mapping(bytes32 => DomainCommitment) public domainCommitments;

    event DomainMinted(address indexed owner, string domainName, uint256 indexed tokenId);
    event PrimaryDomainSet(address indexed owner, string domainName, uint256 indexed tokenId);
    event DomainBurned(address indexed owner, string domainName, uint256 indexed tokenId);
    event DomainCommitmentSubmitted(bytes32 indexed commitment, address indexed committer, uint256 blockNumber);

    error InvalidDomainName();
    error DomainNotOwned();
    error InvalidCommitment();
    error CommitmentTooNew();
    error CommitmentExpired();

    constructor() ERC721("Lendora Wallet Domains", "LNDR") {}

    function makeCommitment(
        string memory domainName,
        address owner,
        bytes32 secret
    ) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, owner, tokenIdOf(domainName), secret));
    }

    function commitDomain(bytes32 commitment) external {
        if (commitment == bytes32(0)) revert InvalidCommitment();
        DomainCommitment memory existing = domainCommitments[commitment];
        if (
            existing.committer != address(0) &&
            block.number <= uint256(existing.blockNumber) + MAX_COMMITMENT_AGE_BLOCKS
        ) revert InvalidCommitment();

        domainCommitments[commitment] = DomainCommitment({
            committer: msg.sender,
            blockNumber: uint64(block.number)
        });
        emit DomainCommitmentSubmitted(commitment, msg.sender, block.number);
    }

    function mintDomain(string memory domainName, bytes32 secret) public returns (uint256 tokenId) {
        _validateDomainName(domainName);
        bytes32 commitment = makeCommitment(domainName, msg.sender, secret);
        DomainCommitment memory submitted = domainCommitments[commitment];
        if (submitted.committer != msg.sender) revert InvalidCommitment();
        uint256 age = block.number - uint256(submitted.blockNumber);
        if (age < MIN_COMMITMENT_AGE_BLOCKS) revert CommitmentTooNew();
        if (age > MAX_COMMITMENT_AGE_BLOCKS) revert CommitmentExpired();

        delete domainCommitments[commitment];
        tokenId = tokenIdOf(domainName);
        _safeMint(msg.sender, tokenId);
        domainNames[tokenId] = domainName;

        emit DomainMinted(msg.sender, domainName, tokenId);
    }

    function setPrimaryDomain(string memory domainName) public {
        uint256 tokenId = tokenIdOf(domainName);
        if (_ownerOf(tokenId) != msg.sender) revert DomainNotOwned();

        primaryTokenIds[msg.sender] = tokenId;
        emit PrimaryDomainSet(msg.sender, domainName, tokenId);
    }

    function burnDomain(string memory domainName) public {
        uint256 tokenId = tokenIdOf(domainName);
        if (_ownerOf(tokenId) != msg.sender) revert DomainNotOwned();

        _burn(tokenId);
        delete domainNames[tokenId];

        emit DomainBurned(msg.sender, domainName, tokenId);
    }
    
    function resolveDomain(string memory domainName) public view returns (address) {
        return _ownerOf(tokenIdOf(domainName));
    }

    function isRegistered(string memory domainName) public view returns (bool) {
        return _ownerOf(tokenIdOf(domainName)) != address(0);
    }

    function tokenIdOf(string memory domainName) public pure returns (uint256) {
        return uint256(keccak256(bytes(domainName)));
    }

    function primaryDomainOf(address owner) public view returns (string memory) {
        uint256 tokenId = primaryTokenIds[owner];
        if (tokenId == 0 || _ownerOf(tokenId) != owner) return "";

        return domainNames[tokenId];
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory name_ = domainNames[tokenId];
        bytes memory json = bytes(
            string.concat(
                "{\"name\":\"",
                name_,
                ".lendora\",\"description\":\"Lendora wallet domain on Arc Testnet\",\"attributes\":[{\"trait_type\":\"Domain\",\"value\":\"",
                name_,
                ".lendora\"}],\"external_url\":\"https://testnet.arcscan.app/token/",
                Strings.toHexString(address(this)),
                "?a=",
                Strings.toString(tokenId),
                "\"}"
            )
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address previousOwner)
    {
        previousOwner = super._update(to, tokenId, auth);
        if (previousOwner != address(0) && primaryTokenIds[previousOwner] == tokenId) {
            primaryTokenIds[previousOwner] = 0;
        }
    }

    function _increaseBalance(address account, uint128 value)
        internal
        override(ERC721Enumerable)
    {
        super._increaseBalance(account, value);
    }

    function _validateDomainName(string memory domainName) private pure {
        bytes memory nameBytes = bytes(domainName);
        uint256 length = nameBytes.length;
        if (length < 3 || length > 32) revert InvalidDomainName();
        if (nameBytes[0] == "-" || nameBytes[length - 1] == "-") revert InvalidDomainName();

        for (uint256 i = 0; i < length; i++) {
            bytes1 char = nameBytes[i];
            bool isLowerAlpha = char >= "a" && char <= "z";
            bool isDigit = char >= "0" && char <= "9";
            bool isHyphen = char == "-";

            if (!isLowerAlpha && !isDigit && !isHyphen) revert InvalidDomainName();
        }
    }
}
