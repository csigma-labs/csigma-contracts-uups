// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

error LenderIdExist(string _id);
error PoolIdExist(string _id);
error PaymentIdExist(string _id);
error LenderIdNotExist(string _id);
error PoolIdNotExist(string _id);
error InvalidInput(uint256 _coupon);

contract CsigmaPDN is
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

    enum PaymentType {INVESTMENT, PAYMENT}

    mapping (string => Payment) public payments;
    mapping (string => Lender) public lenders;
    mapping (string => Pool) public pools;
    bytes32 public constant ROLE_CREATE_MANAGER = keccak256("ROLE_CREATE_MANAGER");
    bytes32 public constant ROLE_UPGRADE_MANAGER = keccak256("ROLE_UPGRADE_MANAGER");

    event LenderAdded(string indexed _lenderId, string _userId, string _metaHash);
    event PoolAdded(
        string indexed _poolId,
        string _poolManagerId,
        string _metaHash,
        uint8 _ratings,
        uint256 _inceptionTime,
        uint256 _expiryTime,
        uint256 _poolSize
    );
    event PaymentAdded(
        string indexed _paymentId,
        string _lenderId,
        string _poolId,
        uint256 _principal,
        uint256 _coupon,
        PaymentType _paymentType,
        uint64 _timeStamp
    );
    event CreateManagerAdded(address _account);
    event CreateManagerRemoved(address _account);
    event UpgraderAdded(address _account);
    event UpgraderRemoved(address _account);
    event AdminTransferred(address _oldOwner, address _newOwner);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _createManager,
        address _upgradeManager
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ROLE_CREATE_MANAGER, _createManager);
        _grantRole(ROLE_UPGRADE_MANAGER, _upgradeManager);
    }

    function isCreateManager(address _account) public view returns (bool) {
        return hasRole(ROLE_CREATE_MANAGER, _account);
    }

    function isUpgradeManager(address _account) public view returns (bool) {
        return hasRole(ROLE_UPGRADE_MANAGER, _account);
    }

    function createLender(
        string calldata _lenderId,
        string calldata _userId,
        string calldata _metaHash
    ) public whenNotPaused onlyRole(ROLE_CREATE_MANAGER) {
        if(bytes(lenders[_lenderId].userId).length != 0) {revert LenderIdExist(_lenderId);}
        lenders[_lenderId] = Lender(_userId, _metaHash, 0, 0);
        emit LenderAdded(_lenderId, _userId, _metaHash);
    }

    function createLenderBatch(LenderBatch[] calldata _lenderBatch) external {
        for(uint i = 0; i < _lenderBatch.length; i++) {
            createLender(
                _lenderBatch[i].lenderId,
                _lenderBatch[i].userId,
                _lenderBatch[i].metaHash
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
        if(bytes(payments[_paymentId].poolId).length != 0) {revert PaymentIdExist(_paymentId);}
        if(bytes(lenders[_lenderId].userId).length == 0) {revert LenderIdNotExist(_lenderId);}
        if(bytes(pools[_poolId].poolManagerId).length == 0) {revert PoolIdNotExist(_poolId);}
        if(_paymentType == PaymentType.INVESTMENT) {
            if(_coupon != 0) {revert InvalidInput(_coupon);}
            lenders[_lenderId].totalInvested += _principal;
            pools[_poolId].investmentReceived += _principal;
        } else {
            lenders[_lenderId].totalReceived += (_principal + _coupon);
            pools[_poolId].totalPayment += (_principal + _coupon);
        }
        payments[_paymentId] = Payment(_lenderId, _poolId, _principal, _coupon, _paymentType, _timeStamp);
        emit PaymentAdded(_paymentId, _lenderId, _poolId, _principal, _coupon, _paymentType, _timeStamp);
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
 
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function addCreateManager(address _account) public           
    {
        grantRole(ROLE_CREATE_MANAGER, _account);
        emit CreateManagerAdded(_account);
    }

    function removeCreateManager(address _account) public {
        revokeRole(ROLE_CREATE_MANAGER, _account);
        emit CreateManagerRemoved(_account);
    }

    function addUpgradeManager(address _account) public         
    {
        grantRole(ROLE_UPGRADE_MANAGER, _account);
        emit UpgraderAdded(_account);
    }

    function removeUpgradeManager(address _account) public        
    {
        revokeRole(ROLE_UPGRADE_MANAGER, _account);
        emit UpgraderRemoved(_account);
    }

    function transferAdmin(address _newOwner) public
    {
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