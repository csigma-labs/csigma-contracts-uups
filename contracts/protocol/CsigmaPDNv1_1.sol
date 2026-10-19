// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

interface IPDNInvestmentNFT {
    struct InvestmentMetadata {
        string lenderId;
        string poolId;
        uint256 totalInvestment;
        int256 outstandingPrincipal;
        int256 outstandingCoupon;
        uint256 totalRepaid;
    }

    function mintInvestment(
        address to,
        InvestmentMetadata calldata data
    ) external returns (uint256 tokenId);

    function updateInvestmentMetadata(
        uint256 _tokenId,
        uint256 _totalInvestment,
        int256 _outstandingPrincipal,
        int256 _outstandingCoupon,
        uint256 _totalRepaid
    ) external;

    function updateCouponInMetadata(
        uint256 _tokenId,
        int256 _outstandingCoupon
    ) external;

    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    function investmentData(uint256 tokenId) external view returns (InvestmentMetadata memory);

    function managerTransfer(uint256 tokenId, address to) external;
}

error LenderIdExist(string _id);
error PoolIdExist(string _id);
error PaymentIdExist(string _id);
error LenderIdNotExist(string _id);
error PaymentIdNotExist(string _id);
error PoolIdNotExist(string _id);
error InvalidInput(uint256 _coupon);
error PaymentRecordsExist(string _id);
error InvalidAddress(address _address);
error InvalidTokenId(uint256 _tokenId);

contract CsigmaPDNv1_1 is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    struct Payment {
        string lenderId;
        string poolId;
        uint256 principal;
        uint256 coupon;
        PaymentType paymentType;
        uint64 timeStamp;
    }

    struct PaymentBatch {
        string paymentId;
        string lenderId;
        string poolId;
        uint256 principal;
        uint256 coupon;
        PaymentType paymentType;
        uint64 timeStamp;
    }

    struct Lender {
        string userId;
        string metaHash;
        uint256 totalInvested;
        uint256 totalReceived;
    }

    struct LenderBatch {
        string lenderId;
        string userId;
        string metaHash;
    }

    struct Pool {
        string poolManagerId;
        string metaHash;
        uint8 ratings;
        uint256 inceptionTime;
        uint256 expiryTime;
        uint256 poolSize;
        uint256 investmentReceived;
        uint256 totalPayment;
    }

    struct PoolBatch {
        string poolId;
        string poolManagerId;
        string metaHash;
        uint8 ratings;
        uint256 inceptionTime;
        uint256 expiryTime;
        uint256 poolSize;
    }

    enum PaymentType {INVESTMENT, PAYMENT, FEE}

    mapping (string => Payment) public payments;
    mapping (string => Lender) public lenders;
    mapping (string => Pool) public pools;
    bytes32 public constant ROLE_CREATE_MANAGER = keccak256("ROLE_CREATE_MANAGER");
    bytes32 public constant ROLE_UPGRADE_MANAGER = keccak256("ROLE_UPGRADE_MANAGER");
    bytes32 public constant ROLE_EDIT_MANAGER = keccak256("ROLE_EDIT_MANAGER");

    IPDNInvestmentNFT public csigmaPDNInvestmentNFT;
    // lenderId => poolId => tokenId
    mapping (string => mapping(string => uint256)) public lenderPoolToTokenId;
    mapping (string => address) public lenderWallet;

    event LenderAdded(string indexed _lenderId, string _userId, string _metaHash);
    event LenderDeleted(string indexed _lenderId);
    event UpdatedLenderUserId(string indexed _lenderId, string _oldUserId, string _newUserId);
    event UpdatedLenderWallet(string indexed _lenderId, address _oldLenderWallet, address _newLenderWallet);
    event UpdatedLenderMetaHash(string indexed _lenderId, string _oldMetaHash, string _newMetaHash);

    event PoolAdded(
        string indexed _poolId,
        string _poolManagerId,
        string _metaHash,
        uint8 _ratings,
        uint256 _inceptionTime,
        uint256 _expiryTime,
        uint256 _poolSize
    );
    event PoolDeleted(string indexed _poolId);
    event UpdatedPoolManagerId(string indexed _poolId, string _oldPoolManagerId, string _newPoolManagerId);
    event UpdatedPoolInceptionTime(string indexed _poolId, uint256 _oldInceptionTime, uint256 _newInceptionTime);
    event UpdatedPoolExpiryTime(string indexed _poolId, uint256 _oldExpiryTime, uint256 _newExpiryTime);
    event UpdatedPoolSize(string indexed _poolId, uint256 _oldPoolSize, uint256 _newPoolSize);
    event UpdatedPoolRatings(string indexed _poolId, uint8 _oldRatings, uint8 _newRatings);
    event UpdatedPoolMetaHash(string indexed _poolId, string _oldMetaHash, string _newMetaHash);

    event PaymentAdded(
        string indexed _paymentId,
        string _lenderId,
        string _poolId,
        uint256 _principal,
        uint256 _coupon,
        PaymentType _paymentType,
        uint64 _timeStamp
    );
    event PaymentDeleted(string indexed _paymentId, uint256 _principal, uint256 _coupon, PaymentType _paymentType);
    event UpdatedPaymentTimeStamp(string indexed _paymentId, uint64 _oldTimeStamp, uint64 _newTimeStamp);
    event LenderPoolTokenIdSet(string indexed _lenderId, string _poolId, uint256 _oldTokenId, uint256 _newTokenId);

    event AdminTransferred(address _oldOwner, address _newOwner);
    event InvestmentNFTReassigned(string indexed _lenderId, uint256 _tokenId, address _newWallet);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _createManager,
        address _upgradeManager,
        address _editManager
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ROLE_CREATE_MANAGER, _createManager);
        _grantRole(ROLE_EDIT_MANAGER, _editManager);
        _grantRole(ROLE_UPGRADE_MANAGER, _upgradeManager);
    }

    function getlenderPoolToTokenId(string calldata lenderId, string calldata poolId) public view returns (uint256) {
        return lenderPoolToTokenId[lenderId][poolId];
    }

    // Shared existence checks - factored out so the (repeated) revert-encoding is emitted once,
    // keeping the deployed bytecode under the 24576-byte limit. Behaviour is unchanged.
    function _requireLender(string calldata _lenderId) internal view {
        if(bytes(lenders[_lenderId].userId).length == 0) revert LenderIdNotExist(_lenderId);
    }

    function _requirePool(string calldata _poolId) internal view {
        if(bytes(pools[_poolId].poolManagerId).length == 0) revert PoolIdNotExist(_poolId);
    }

    function _requirePaymentAbsent(string calldata _paymentId) internal view {
        if(bytes(payments[_paymentId].poolId).length != 0) revert PaymentIdExist(_paymentId);
    }

    function _requirePaymentExists(string calldata _paymentId) internal view {
        if(bytes(payments[_paymentId].poolId).length == 0) revert PaymentIdNotExist(_paymentId);
    }

    // The NFT read and write are each reached from four sites (investment
    // and payment, add and delete), so routing them through one helper emits the external-call
    // encoding once. Callers still compute the new values, so the checked arithmetic is unchanged.
    function _readNft(uint256 _tokenId) internal view returns (IPDNInvestmentNFT.InvestmentMetadata memory) {
        return csigmaPDNInvestmentNFT.investmentData(_tokenId);
    }

    function _mintNft(address to, IPDNInvestmentNFT.InvestmentMetadata memory data) internal returns (uint256) {
        return csigmaPDNInvestmentNFT.mintInvestment(to, data);
    }

    function _writeNft(
        uint256 _tokenId,
        uint256 _totalInvestment,
        int256 _outstandingPrincipal,
        int256 _outstandingCoupon,
        uint256 _totalRepaid
    ) internal {
        csigmaPDNInvestmentNFT.updateInvestmentMetadata(
            _tokenId,
            _totalInvestment,
            _outstandingPrincipal,
            _outstandingCoupon,
            _totalRepaid
        );
    }

    function createLender(
        string calldata _lenderId,
        string calldata _userId,
        string calldata _metaHash,
        address _lenderWallet
    ) public whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {
        if(bytes(lenders[_lenderId].userId).length != 0) {revert LenderIdExist(_lenderId);}
        if(_lenderWallet == address(0)) revert InvalidAddress(_lenderWallet);
        lenders[_lenderId] = Lender(_userId, _metaHash, 0, 0);
        emit LenderAdded(_lenderId, _userId, _metaHash);
        lenderWallet[_lenderId] = _lenderWallet;
        emit UpdatedLenderWallet(_lenderId, address(0), _lenderWallet);
    }

    function updateLenderUserId(string calldata _lenderId, string calldata _userId) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requireLender(_lenderId);
        emit UpdatedLenderUserId(_lenderId, lenders[_lenderId].userId, _userId);
        lenders[_lenderId].userId = _userId;
    }

    function updateLenderMetaHash(string calldata _lenderId, string calldata _metaHash) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requireLender(_lenderId);
        emit UpdatedLenderMetaHash(_lenderId, lenders[_lenderId].metaHash, _metaHash);
        lenders[_lenderId].metaHash = _metaHash;
    }

    /// @notice Updates a lender's registered wallet. Any investment NFTs left at the old wallet
    ///         are moved separately, via reassignInvestmentNFTs.
    function updateLenderWallet(
        string calldata _lenderId,
        address _lenderWallet
    ) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requireLender(_lenderId);
        emit UpdatedLenderWallet(_lenderId, lenderWallet[_lenderId], _lenderWallet);
        lenderWallet[_lenderId] = _lenderWallet;
    }

    /// @notice Moves investment NFTs belonging to _lenderId onto that lender's currently
    ///         registered wallet. Callable by an edit manager or by the lender's own wallet.
    /// @dev The destination is read from lenderWallet rather than passed in, so a token can only
    ///      ever land on the address the mapping already points at - there is no address argument
    ///      to get wrong. Each tokenId must belong to _lenderId; a mismatch reverts the whole call.
    ///      Tokens still escrowed by the PDN are rejected by managerTransfer, since those are
    ///      collected with claimLegacyInvestmentNFTs instead. Naming a token that already sits on
    ///      the destination also reverts, so batches must not overlap.
    function reassignInvestmentNFTs(
        string calldata _lenderId,
        uint256[] calldata tokenIds
    ) external whenNotPaused {
        _requireLender(_lenderId);
        address dest = lenderWallet[_lenderId];
        if (dest == address(0)) revert InvalidAddress(dest);
        if (dest != _msgSender() && !hasRole(ROLE_EDIT_MANAGER, _msgSender())) {
            revert InvalidAddress(_msgSender());
        }

        for (uint i = 0; i < tokenIds.length; i++) {
            IPDNInvestmentNFT.InvestmentMetadata memory m = _readNft(tokenIds[i]);
            if (keccak256(bytes(m.lenderId)) != keccak256(bytes(_lenderId))) revert InvalidTokenId(tokenIds[i]);
            csigmaPDNInvestmentNFT.managerTransfer(tokenIds[i], dest);
            emit InvestmentNFTReassigned(_lenderId, tokenIds[i], dest);
        }
    }

    function deleteLenderRecord(string calldata _lenderId) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requireLender(_lenderId);
        if(!(lenders[_lenderId].totalInvested == 0 && lenders[_lenderId].totalReceived == 0)) {revert PaymentRecordsExist(_lenderId);}
        delete lenders[_lenderId];
        emit LenderDeleted(_lenderId);
    }

    function updateInvestmentNFT(address _nftContractAddress) external whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        if (_nftContractAddress == address(0)) revert InvalidAddress(_nftContractAddress);
        csigmaPDNInvestmentNFT = IPDNInvestmentNFT(_nftContractAddress);
    }

    function updateCouponInMetadata(
        uint256 tokenId,
        int256 outstandingCoupon
    ) public whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {
        csigmaPDNInvestmentNFT.updateCouponInMetadata(tokenId, outstandingCoupon);
    }

    function updateCouponInMetadataBatch(
        uint256[] calldata tokenIds,
        int256[] calldata outstandingCoupons
    ) external {
        for(uint i = 0; i < tokenIds.length; i++) {
            updateCouponInMetadata(tokenIds[i], outstandingCoupons[i]);
        }
    }

    function claimLegacyInvestmentNFTs(
        uint256[] calldata tokenIds
    ) external whenNotPaused {

        for(uint i = 0; i < tokenIds.length; i++) {
            IPDNInvestmentNFT.InvestmentMetadata memory m = _readNft(tokenIds[i]);
            address to = lenderWallet[m.lenderId];
        
            if (to != msg.sender) revert InvalidAddress(to);
            csigmaPDNInvestmentNFT.safeTransferFrom(address(this), to, tokenIds[i]);
        }
    }

    function createLenderBatch(LenderBatch[] calldata _lenderBatch, address[] calldata _lenderWallet) external {
        for(uint i = 0; i < _lenderBatch.length; i++) {
            createLender(
                _lenderBatch[i].lenderId,
                _lenderBatch[i].userId,
                _lenderBatch[i].metaHash,
                _lenderWallet[i]
            );
        }
    }

    function createPool(
        string calldata _poolId,
        string calldata _poolManagerId,
        string calldata _metaHash,
        uint8 _ratings,
        uint256 _inceptionTime,
        uint256 _expiryTime,
        uint256 _poolSize
    ) public whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {
        if(bytes(pools[_poolId].poolManagerId).length != 0) {revert PoolIdExist(_poolId);}
        pools[_poolId] = Pool(_poolManagerId, _metaHash, _ratings, _inceptionTime, _expiryTime, _poolSize, 0, 0);
        emit PoolAdded(_poolId, _poolManagerId, _metaHash, _ratings, _inceptionTime, _expiryTime, _poolSize);
    }

    function updatePoolManagerId(string calldata _poolId, string calldata _poolManagerId) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePool(_poolId);
        emit UpdatedPoolManagerId(_poolId, pools[_poolId].poolManagerId, _poolManagerId);
        pools[_poolId].poolManagerId = _poolManagerId;
    }

    function updatePoolInceptionTime(string calldata _poolId, uint256 _inceptionTime) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePool(_poolId);
        emit UpdatedPoolInceptionTime(_poolId, pools[_poolId].inceptionTime, _inceptionTime);
        pools[_poolId].inceptionTime = _inceptionTime;
    }

    function updatePoolExpiryTime(string calldata _poolId, uint256 _expiryTime) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePool(_poolId);
        emit UpdatedPoolExpiryTime(_poolId, pools[_poolId].expiryTime, _expiryTime);
        pools[_poolId].expiryTime = _expiryTime;
    }

    function updatePoolSize(string calldata _poolId, uint256 _poolSize) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePool(_poolId);
        emit UpdatedPoolSize(_poolId, pools[_poolId].poolSize, _poolSize);
        pools[_poolId].poolSize = _poolSize;
    }

    function updatePoolRatings(string calldata _poolId, uint8 _ratings) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePool(_poolId);
        emit UpdatedPoolRatings(_poolId, pools[_poolId].ratings, _ratings);
        pools[_poolId].ratings = _ratings;
    }

    function updatePoolMetaHash(string calldata _poolId, string calldata _metaHash) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePool(_poolId);
        emit UpdatedPoolMetaHash(_poolId, pools[_poolId].metaHash, _metaHash);
        pools[_poolId].metaHash = _metaHash;
    }

    function deletePoolRecord(string calldata _poolId) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePool(_poolId);
        if(!(pools[_poolId].totalPayment == 0 && pools[_poolId].investmentReceived == 0)) {revert PaymentRecordsExist(_poolId);}
        delete pools[_poolId];
        emit PoolDeleted(_poolId);
    }

    function createPoolBatch(PoolBatch[] calldata _poolBatch) external {
        for(uint i = 0; i < _poolBatch.length; i++) {
            createPool(
                _poolBatch[i].poolId,
                _poolBatch[i].poolManagerId,
                _poolBatch[i].metaHash,
                _poolBatch[i].ratings,
                _poolBatch[i].inceptionTime,
                _poolBatch[i].expiryTime,
                _poolBatch[i].poolSize
            );
        }
    }

    function addPayment(
        string calldata _paymentId,
        string calldata _lenderId,
        string calldata _poolId,
        uint256 _principal,
        uint256 _coupon,
        PaymentType _paymentType,
        uint64 _timeStamp
    ) public whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {
        _requirePaymentAbsent(_paymentId);
        _requireLender(_lenderId);
        _requirePool(_poolId);
        uint256 existingTokenId = lenderPoolToTokenId[_lenderId][_poolId];
        if(_paymentType == PaymentType.INVESTMENT) {
            if(_coupon != 0) {revert InvalidInput(_coupon);}
            lenders[_lenderId].totalInvested += _principal;
            pools[_poolId].investmentReceived += _principal;

            if (existingTokenId == 0) {
                // First investment → mint NFT
                IPDNInvestmentNFT.InvestmentMetadata memory data =
                    IPDNInvestmentNFT.InvestmentMetadata(
                        _lenderId,
                        _poolId,
                        _principal,
                        int256(_principal),
                        0,
                        0
                    );
                address lenderWalletAddr = lenderWallet[_lenderId];
                if(lenderWalletAddr == address(0)) {
                    lenderWalletAddr = address(this);
                }
                uint256 tokenId = _mintNft(lenderWalletAddr, data);
                lenderPoolToTokenId[_lenderId][_poolId] = tokenId;
            } else {
                // Subsequent investment → update metadata
                IPDNInvestmentNFT.InvestmentMetadata memory m = _readNft(existingTokenId);

                _writeNft(
                    existingTokenId,
                    m.totalInvestment + _principal,
                    m.outstandingPrincipal + int256(_principal),
                    m.outstandingCoupon,
                    m.totalRepaid
                );
            }
        } else if (_paymentType == PaymentType.PAYMENT) {
            lenders[_lenderId].totalReceived += (_principal + _coupon);
            pools[_poolId].totalPayment += (_principal + _coupon);

            IPDNInvestmentNFT.InvestmentMetadata memory m = _readNft(existingTokenId);

            _writeNft(
                existingTokenId,
                m.totalInvestment,
                m.outstandingPrincipal - int256(_principal),
                m.outstandingCoupon - int256(_coupon),
                m.totalRepaid + _principal + _coupon
            );
        }
        payments[_paymentId] = Payment(_lenderId, _poolId, _principal, _coupon, _paymentType, _timeStamp);
        emit PaymentAdded(_paymentId, _lenderId, _poolId, _principal, _coupon, _paymentType, _timeStamp);
    }

    function deletePaymentRecord(string calldata _paymentId) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        Payment memory payment = payments[_paymentId];
        _requirePaymentExists(_paymentId);
        uint256 existingTokenId = lenderPoolToTokenId[payment.lenderId][payment.poolId];
        if(payment.paymentType == PaymentType.INVESTMENT) {
            lenders[payment.lenderId].totalInvested -= payment.principal;
            pools[payment.poolId].investmentReceived -= payment.principal;
            if (existingTokenId != 0) {
                IPDNInvestmentNFT.InvestmentMetadata memory m = _readNft(existingTokenId);
                _writeNft(
                    existingTokenId,
                    m.totalInvestment - payment.principal,
                    m.outstandingPrincipal - int256(payment.principal),
                    m.outstandingCoupon,
                    m.totalRepaid
                );
            }
        } else if (payment.paymentType == PaymentType.PAYMENT) {
            lenders[payment.lenderId].totalReceived -= (payment.principal + payment.coupon);
            pools[payment.poolId].totalPayment -= (payment.principal + payment.coupon);
            if (existingTokenId != 0) {
                IPDNInvestmentNFT.InvestmentMetadata memory m = _readNft(existingTokenId);
                _writeNft(
                    existingTokenId,
                    m.totalInvestment,
                    m.outstandingPrincipal + int256(payment.principal),
                    m.outstandingCoupon + int256(payment.coupon),
                    m.totalRepaid - (payment.principal + payment.coupon)
                );
            }
        }
        delete payments[_paymentId];
        emit PaymentDeleted(_paymentId, payment.principal, payment.coupon, payment.paymentType);
    }

    function mintLegacyInvestmentNFTBatch(
        IPDNInvestmentNFT.InvestmentMetadata[] calldata data
    ) external whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {

        for (uint256 i = 0; i < data.length; i++) {
            _requireLender(data[i].lenderId);
            _requirePool(data[i].poolId);
            address lenderAddr = lenderWallet[data[i].lenderId];
            if(lenderAddr == address(0)) {
                lenderAddr = address(this);
            }
            uint256 existingTokenId = lenderPoolToTokenId[data[i].lenderId][data[i].poolId];
            if (existingTokenId != 0) revert InvalidTokenId(existingTokenId);
            uint256 tokenId = _mintNft(lenderAddr, data[i]);
            lenderPoolToTokenId[data[i].lenderId][data[i].poolId] = tokenId;
            emit LenderPoolTokenIdSet(data[i].lenderId, data[i].poolId, 0, tokenId);
        }
    }

    /// @notice Points a lender/pool pair at an investment NFT that already exists.
    /// @dev Backfill path for legacy NFTs minted before mintLegacyInvestmentNFTBatch indexed them.
    ///      The token's own metadata must name the same lender/pool pair, so a pair can never be
    ///      pointed at an unrelated position. Passing token id zero clears the index, which is how
    ///      a pair is unindexed before its lender or pool record is deleted.
    function setLenderPoolTokenId(
        string calldata _lenderId,
        string calldata _poolId,
        uint256 _tokenId
    ) external whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {
        _requireLender(_lenderId);
        _requirePool(_poolId);
        if(_tokenId != 0) {
            IPDNInvestmentNFT.InvestmentMetadata memory m = _readNft(_tokenId);
            if(
                keccak256(bytes(m.lenderId)) != keccak256(bytes(_lenderId)) ||
                keccak256(bytes(m.poolId)) != keccak256(bytes(_poolId))
            ) revert InvalidTokenId(_tokenId);
        }
        emit LenderPoolTokenIdSet(_lenderId, _poolId, lenderPoolToTokenId[_lenderId][_poolId], _tokenId);
        lenderPoolToTokenId[_lenderId][_poolId] = _tokenId;
    }

    function addPaymentBatch(PaymentBatch[] calldata _paymentBatch) external {
        for(uint i = 0; i < _paymentBatch.length; i++) {
            addPayment(
                _paymentBatch[i].paymentId,
                _paymentBatch[i].lenderId,
                _paymentBatch[i].poolId,
                _paymentBatch[i].principal,
                _paymentBatch[i].coupon,
                _paymentBatch[i].paymentType,
                _paymentBatch[i].timeStamp
            );
        }
    }

    function updatePaymentTimeStamp(string calldata _paymentId, uint64 _timeStamp) public whenNotPaused onlyRole(ROLE_EDIT_MANAGER) {
        _requirePaymentExists(_paymentId);
        emit UpdatedPaymentTimeStamp(_paymentId, payments[_paymentId].timeStamp, _timeStamp);
        payments[_paymentId].timeStamp = _timeStamp;
    }
    
    function addFee(
        string calldata _paymentId,
        string calldata _lenderId,
        string calldata _poolId,
        uint256 _amount,
        uint64 _timeStamp
    ) public whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {
        _requirePaymentAbsent(_paymentId);
        payments[_paymentId] = Payment(_lenderId, _poolId, _amount, 0, PaymentType.FEE, _timeStamp);
        emit PaymentAdded(_paymentId, _lenderId, _poolId, _amount, 0, PaymentType.FEE, _timeStamp);
    }

    function addFeeBatch(PaymentBatch[] calldata _paymentBatch) external {
        for(uint i = 0; i < _paymentBatch.length; i++) {
            addFee(
                _paymentBatch[i].paymentId,
                _paymentBatch[i].lenderId,
                _paymentBatch[i].poolId,
                _paymentBatch[i].principal,
                _paymentBatch[i].timeStamp
            );
        }
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function transferAdmin(address _newOwner) public {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }    

    function grantRole(bytes32 role, address _account)
        public
        virtual
        override
        onlyRole(getRoleAdmin(role))
        whenNotPaused
    {
        _grantRole(role, _account);
    }

    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))        
        whenNotPaused
    {
        _revokeRole(role, _account);
    }

    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(ROLE_UPGRADE_MANAGER)
    {}
}