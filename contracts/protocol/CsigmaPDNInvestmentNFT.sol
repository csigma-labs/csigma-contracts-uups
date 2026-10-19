// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

error TokenIdNotExist(uint256 _id);
error TransferNotAllowed(address _from, address _to);

contract CsigmaPDNInvestmentNFT is
    Initializable,
    ERC721Upgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant ROLE_MANAGER = keccak256("ROLE_MANAGER");

    struct InvestmentMetadata {
        string lenderId;
        string poolId;
        uint256 totalInvestment;
        int256 outstandingPrincipal;
        int256 outstandingCoupon;
        uint256 totalRepaid;
    }

    string private baseURI;
    uint256 public nextTokenId;

    mapping(uint256 => InvestmentMetadata) private _investmentData;

    event InvestmentMinted(uint256 indexed tokenId, address indexed to);
    event InvestmentMetadataUpdated(uint256 indexed tokenId, uint256 totalInvestment, int256 outstandingPrincipal, int256 outstandingCoupon, uint256 totalRepaid);
    event InvestmentReassigned(uint256 indexed tokenId, address indexed from, address indexed to);
    event BaseURIUpdated(string newURI);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string calldata _name,
        string calldata _symbol,
        string calldata _uri,
        address _admin,
        address _PDNContractAddress
    ) public initializer {
        __ERC721_init(_name, _symbol);
        __AccessControl_init();
        __UUPSUpgradeable_init();

        nextTokenId = 1;
        baseURI = _uri;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ROLE_MANAGER, _PDNContractAddress);
    }

    function _baseURI() internal view virtual override returns (string memory) {
        return baseURI;
    }

    function mintInvestment(
        address to,
        InvestmentMetadata calldata data
    ) external onlyRole(ROLE_MANAGER) returns (uint256 tokenId){
        tokenId = nextTokenId;
        nextTokenId++;
        _mint(to, tokenId);
        _investmentData[tokenId] = data;
        emit InvestmentMinted(tokenId, to);
    }

    function updateInvestmentMetadata(
        uint256 _tokenId,
        uint256 _totalInvestment,
        int256 _outstandingPrincipal,
        int256 _outstandingCoupon,
        uint256 _totalRepaid
    ) external onlyRole(ROLE_MANAGER) {
        if(_ownerOf(_tokenId) == address(0)) revert TokenIdNotExist(_tokenId);
        InvestmentMetadata storage m = _investmentData[_tokenId];
        m.totalInvestment = _totalInvestment;
        m.outstandingPrincipal = _outstandingPrincipal;
        m.outstandingCoupon = _outstandingCoupon;
        m.totalRepaid = _totalRepaid;
        emit InvestmentMetadataUpdated(_tokenId, m.totalInvestment, m.outstandingPrincipal, m.outstandingCoupon, m.totalRepaid);
    }

    function updateCouponInMetadata(
        uint256 _tokenId,
        int256 _outstandingCoupon
    ) external onlyRole(ROLE_MANAGER) {
        if(_ownerOf(_tokenId) == address(0)) revert TokenIdNotExist(_tokenId);
        InvestmentMetadata storage m = _investmentData[_tokenId];
        m.outstandingCoupon = _outstandingCoupon;
        emit InvestmentMetadataUpdated(_tokenId, m.totalInvestment, m.outstandingPrincipal, m.outstandingCoupon, m.totalRepaid);
    }

    // Moves a token without the current owner's approval - only the PDN holds ROLE_MANAGER, and
    // it uses this to correct a token stranded at a wallet that lenderWallet no longer points to.
    // Reverts if the caller is itself the current owner: an escrowed (PDN-held) token must go
    // through mintInvestment's recipient or claimLegacyInvestmentNFTs, not this path, since those
    // require the destination to prove control by calling in itself.
    function managerTransfer(uint256 tokenId, address to) external onlyRole(ROLE_MANAGER) {
        address from = _ownerOf(tokenId);
        if (from == address(0)) revert TokenIdNotExist(tokenId);
        if (from == _msgSender() || to == address(0) || to == from) revert TransferNotAllowed(from, to);
        _transfer(from, to, tokenId);
        emit InvestmentReassigned(tokenId, from, to);
    }

    function investmentData(uint256 tokenId)
        external
        view
        returns (InvestmentMetadata memory)
    {
        return _investmentData[tokenId];
    }

    function setBaseURI(string memory _newbaseURI) external onlyRole(DEFAULT_ADMIN_ROLE) {
        baseURI = _newbaseURI;
        emit BaseURIUpdated(baseURI);
    }

    function emergencyUpdateMetadata(
        uint256 _tokenId,
        uint256 _totalInvestment,
        int256 _outstandingPrincipal,
        int256 _outstandingCoupon,
        uint256 _totalRepaid
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_ownerOf(_tokenId) == address(0)) revert TokenIdNotExist(_tokenId);

        InvestmentMetadata storage m = _investmentData[_tokenId];
        m.totalInvestment = _totalInvestment;
        m.outstandingPrincipal = _outstandingPrincipal;
        m.outstandingCoupon = _outstandingCoupon;
        m.totalRepaid = _totalRepaid;

        emit InvestmentMetadataUpdated(_tokenId, m.totalInvestment, m.outstandingPrincipal, m.outstandingCoupon, m.totalRepaid);
    }


    function supportsInterface(bytes4 interfaceId) public view override(ERC721Upgradeable, AccessControlUpgradeable) returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override {

        super._beforeTokenTransfer(from, to, tokenId, batchSize);

        // Allow mint
        if (from == address(0)) return;

        // PDN -> lender wallet
        bool valid = (hasRole(ROLE_MANAGER, msg.sender) && to != address(0));
        if (!valid) {
            revert TransferNotAllowed(from, to);
        }
    }

    function _authorizeUpgrade(address)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}
