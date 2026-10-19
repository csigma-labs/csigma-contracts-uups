// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./CsigmaPermissionedPool.sol";
import "./CsigmaPermissionedFundManager.sol";
import "./CsigmaPermissionedWithdrawalManager.sol";
import "../interfaces/ICsigmaV1.sol";

error InvalidAddress(address _poolManager);
error InvalidPoolName(string _poolName);
error PoolManagerNotVerified(string _poolManagerId);

/// @title CsigmaPermissionedFactory
/// @notice Contract to create and manage cSigma permissioned pools with KYB verification requirements
/// @dev This factory manages the deployment of pools, fund managers, and withdrawal managers for the permissioned system
contract CsigmaPermissionedFactory is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    /// @notice Address of the pool implementation contract
    address public poolImplementation;
    
    /// @notice Address of the fund manager implementation contract
    address public fundManagerImplementation;
    
    /// @notice Address of the Diamond V1 contract
    address public diamondV1;
    
    /// @notice Mapping to track verified pool managers
    mapping (address => bool) public isPoolManager;
    
    /// @notice Mapping to track whitelisted tokens that can be used for pools
    mapping (address => bool) public isWhitelistedToken;
    
    /// @notice Mapping to prevent duplicate pool names
    mapping (string => bool) private isPoolNameUsed;
    
    /// @notice Array of all created pool addresses
    address[] public pools;
    
    /// @notice Address of the withdrawal manager implementation contract
    address public withdrawalManagerImplementation;

    /// @notice Role identifier for config managers who can update implementations and whitelist tokens
    bytes32 public constant ROLE_CONFIG_MANAGER = keccak256("ROLE_CONFIG_MANAGER");

    /// @notice Emitted when the pool implementation is updated
    /// @param _prevImpl The previous pool implementation address
    /// @param _newImpl The new pool implementation address
    event PoolImplementationUpdated(address _prevImpl, address _newImpl);
    
    /// @notice Emitted when the fund manager implementation is updated
    /// @param _prevImpl The previous fund manager implementation address
    /// @param _newImpl The new fund manager implementation address
    event FundManagerImplementationUpdated(address _prevImpl, address _newImpl);
    
    /// @notice Emitted when the withdrawal manager implementation is updated
    /// @param _prevImpl The previous withdrawal manager implementation address
    /// @param _newImpl The new withdrawal manager implementation address
    event WithdrawManagerImplementationUpdated(address _prevImpl, address _newImpl);
    
    /// @notice Emitted when a token is added to the whitelist
    /// @param _poolToken The address of the whitelisted token
    event PoolTokenAdded(address _poolToken);
    
    /// @notice Emitted when a token is removed from the whitelist
    /// @param _poolToken The address of the removed token
    event PoolTokenRemoved(address _poolToken);
    
    /// @notice Emitted when a pool manager is added to the factory
    /// @param _poolManagerId The pool manager ID from Diamond V1
    /// @param _poolManager The address of the pool manager
    event PoolManagerAdded(string _poolManagerId, address _poolManager);
    
    /// @notice Emitted when a pool manager is removed from the factory
    /// @param _poolManager The address of the removed pool manager
    event PoolManagerRemoved(address _poolManager);
    
    /// @notice Emitted when a new pool is created
    /// @param _pool The address of the created pool
    /// @param _poolManager The address of the pool manager
    /// @param _fundManager The address of the associated fund manager
    /// @param _poolToken The address of the pool's underlying token
    /// @param _oracleManager The address of the oracle manager
    /// @param _poolSize The maximum size of the pool
    event PoolCreated(
        address _pool,
        address indexed _poolManager,
        address _fundManager,
        address indexed _poolToken,
        address indexed _oracleManager,
        uint256 _poolSize
    );
    
    /// @notice Emitted when a withdrawal manager is created for a pool
    /// @param _withdrawalManager The address of the created withdrawal manager
    /// @param _pool The address of the pool
    event WithdrawalManagerCreated(address indexed _withdrawalManager, address indexed _pool);
    
    /// @notice Emitted when the admin role is transferred
    /// @param _oldOwner The address of the previous admin
    /// @param _newOwner The address of the new admin
    event AdminTransferred(address _oldOwner, address _newOwner);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the factory with the given parameters
    /// @param _admin The address of the admin
    /// @param _configManager The address of the config manager
    /// @param _fundManagerImpl The address of the fund manager implementation
    /// @param _poolImpl The address of the pool implementation
    /// @param _withdrawalManagerImpl The address of the withdrawal manager implementation
    /// @param _diamondV1 The address of the Diamond V1 contract
    function initialize(
        address _admin,
        address _configManager,
        address _fundManagerImpl,
        address _poolImpl,
        address _withdrawalManagerImpl,
        address _diamondV1
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ROLE_CONFIG_MANAGER, _configManager);
        fundManagerImplementation = _fundManagerImpl;
        poolImplementation = _poolImpl;
        withdrawalManagerImplementation = _withdrawalManagerImpl;
        diamondV1 = _diamondV1;
    }

    /// @notice Returns the total number of pools created
    function totalPools() external view returns (uint256) {
        return pools.length;
    }

    /// @notice Updates the pool implementation address
    /// @param _newImpl The address of the new pool implementation
    function updatePoolImplementation(address _newImpl) external onlyRole(ROLE_CONFIG_MANAGER) {
        if(_newImpl == address(0)) {
            revert InvalidAddress(_newImpl);
        }
        emit PoolImplementationUpdated(poolImplementation, _newImpl);
        poolImplementation = _newImpl;
    }

    /// @notice Updates the fund manager implementation address
    /// @param _newImpl The address of the new fund manager implementation
    function updateFundManagerImplementation(address _newImpl) external onlyRole(ROLE_CONFIG_MANAGER) {
        if(_newImpl == address(0)) {
            revert InvalidAddress(_newImpl);
        }
        emit FundManagerImplementationUpdated(fundManagerImplementation, _newImpl);
        fundManagerImplementation = _newImpl;
    }

    /// @notice Updates the withdrawal manager implementation address
    /// @param _newImpl The address of the new withdrawal manager implementation
    function updateWithdrawalManagerImplementation(address _newImpl) external onlyRole(ROLE_CONFIG_MANAGER) {
        if(_newImpl == address(0)) {
            revert InvalidAddress(_newImpl);
        }
        emit WithdrawManagerImplementationUpdated(withdrawalManagerImplementation, _newImpl);
        withdrawalManagerImplementation = _newImpl;
    }

    /// @notice Adds a token to the whitelist, allowing it to be used for pool creation
    /// @param _token The address of the token to whitelist
    function addTokenToWhitelist(address _token) external onlyRole(ROLE_CONFIG_MANAGER) {
        if(_token == address(0) || isWhitelistedToken[_token]) {
            revert InvalidAddress(_token);
        }
        isWhitelistedToken[_token] = true;
        emit PoolTokenAdded(_token);
    }

    /// @notice Removes a token from the whitelist, preventing it from being used for new pools
    /// @param _token The address of the token to remove from whitelist
    function removeTokenFromWhitelist(address _token) external onlyRole(ROLE_CONFIG_MANAGER) {
        if(!isWhitelistedToken[_token]) {
            revert InvalidAddress(_token);
        }
        isWhitelistedToken[_token] = false;
        emit PoolTokenRemoved(_token);
    }

    /// @notice Creates a new pool with associated fund manager
    /// @param _poolName The name of the pool
    /// @param _poolSymbol The symbol of the pool
    /// @param _fundManagerLenderId The lender ID of the fund manager in Diamond V1
    /// @param _poolToken The address of the pool's underlying token
    /// @param _oracleManager The address of the oracle manager
    /// @param _poolSize The maximum size of the pool
    function createPool(
        string calldata _poolName,
        string calldata _poolSymbol,
        string calldata _fundManagerLenderId,
        address _poolToken,
        address _oracleManager,
        uint256 _poolSize
    ) external returns (address _poolAddress, address _fundManager) {
        if(!isPoolManager[msg.sender]) {
            revert InvalidAddress(msg.sender);
        }
        if(!isWhitelistedToken[_poolToken]) {
            revert InvalidAddress(_poolToken);
        }
        if(isPoolNameUsed[_poolName]) {
            revert InvalidPoolName(_poolName);
        }
        _fundManager = address(new ERC1967Proxy(
                fundManagerImplementation,
                ""
            )
        );
        _poolAddress = address(new ERC1967Proxy(
                poolImplementation,
            abi.encodeWithSelector(
                CsigmaPermissionedPool.initialize.selector,
                _poolName,
                _poolSymbol,
                msg.sender,
                _fundManager,
                _poolToken,
                _oracleManager,
                _poolSize
            )));
        CsigmaPermissionedFundManager(_fundManager).initialize(_poolToken, diamondV1, _fundManagerLenderId, _poolAddress, msg.sender);
        pools.push(_poolAddress);
        isPoolNameUsed[_poolName] = true;
        emit PoolCreated(_poolAddress, msg.sender, _fundManager, _poolToken, _oracleManager, _poolSize);
    }

    /// @notice Creates a new withdrawal manager for an existing pool
    /// @param _pool The address of the pool
    /// @param _csigmaRouter The address of the cSigma router
    /// @return _withdrawalManager The address of the created withdrawal manager
    function createWithdrawalManager(address _pool, address _csigmaRouter) external returns (address _withdrawalManager) {
        if (msg.sender != CsigmaPermissionedPool(_pool).poolManager()) {
            revert InvalidAddress(msg.sender);
        }
        _withdrawalManager = address(new ERC1967Proxy(withdrawalManagerImplementation, abi.encodeWithSelector(CsigmaPermissionedWithdrawalManager.initialize.selector, CsigmaPermissionedPool(_pool).asset(), _pool, _csigmaRouter)));
        CsigmaPermissionedPool(_pool).setWithdrawalManager(_withdrawalManager);
        emit WithdrawalManagerCreated(_withdrawalManager, _pool);
    }

    /// @notice Adds a pool manager to the factory
    /// @param _poolManagerId Pool manager ID from Diamond V1 KYB system
    /// @param _poolManagerAddr The address of the pool manager to add
    function addPoolManager(string calldata _poolManagerId, address _poolManagerAddr) external onlyRole(ROLE_CONFIG_MANAGER) {
        if( _poolManagerAddr == address(0) || 
            isPoolManager[_poolManagerAddr]) {
            revert InvalidAddress(_poolManagerAddr);
        }

        if (ICsigmaV1(diamondV1).getPoolManagerKYBStatus(_poolManagerId) != ICsigmaV1.KYBStatus.VERIFIED) {
            revert PoolManagerNotVerified(_poolManagerId);
        }

        isPoolManager[_poolManagerAddr] = true;
        emit PoolManagerAdded(_poolManagerId, _poolManagerAddr);
    }

    /// @notice Removes a pool manager from the factory
    /// @param _poolManagerAddr The address of the pool manager to remove
    function removePoolManager(address _poolManagerAddr) external onlyRole(ROLE_CONFIG_MANAGER) {
        if(!isPoolManager[_poolManagerAddr]) {
            revert InvalidAddress(_poolManagerAddr);
        }
        isPoolManager[_poolManagerAddr] = false;
        emit PoolManagerRemoved(_poolManagerAddr);
    }

    /// @notice Activates a pool, changing its status from pending to active
    /// @param _pool The address of the pool to activate
    function activatePool(address _pool) external onlyRole(ROLE_CONFIG_MANAGER) {
        CsigmaPermissionedPool(_pool).activatePool();
    }

    /// @notice Transfers the default admin role to a new account
    /// @dev Grants the role to the new owner and revokes it from the caller
    /// @param _newOwner The address of the new admin
    function transferAdmin(address _newOwner) public {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }    

    /// @notice Grants a role to an account
    /// @param role The role identifier to grant
    /// @param _account The address of the account to which the role is to be added
    function grantRole(bytes32 role, address _account)
        public
        virtual
        override
        onlyRole(getRoleAdmin(role))
    {
        _grantRole(role, _account);
    }

    /// @notice Revokes a role from an account
    /// @param role The role identifier to revoke
    /// @param _account The address of the account from which the role is to be revoked
    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))
    {
        _revokeRole(role, _account);
    }

    /// @notice Upgrades the implementation of the contract
    /// @dev ensures that the caller is admin by using onlyRole modifier
    /// @param _newImplementation The address of the new implementation
    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}