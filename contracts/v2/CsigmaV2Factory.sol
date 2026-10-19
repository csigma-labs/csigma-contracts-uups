// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./CsigmaV2Pool.sol";
import "./CsigmaV2FundManager.sol";
import "./CsigmaV2StakingPool.sol";
import "./CsigmaV2WithdrawalManager.sol";

error InvalidAddress(address _poolManager);
error InvalidPoolName(string _poolName);
error StakingPoolExist(address _pool);
/// @title AccessControl
/// @notice Interface to interact with the AccessControl functionalities of a contract
interface AccessControl {
    function pause() external;
    function unpause() external;
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external;
    function grantRole(bytes32 role, address _account) external;
    function revokeRole(bytes32 role, address _account) external;
}
/// @title CsigmaV2Factory
/// @notice Contract to create and manage cSigma V2 pools
contract CsigmaV2Factory is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    address public poolImplementation;
    address public fundManagerImplementation;
    address public stakingPoolImplementation;
    address public diamondV1;
    address public sigmaToken;
    address public chainalysis;
    mapping (address => bool) public isPoolManager;
    mapping (address => bool) public isWhitelistedToken;
    mapping (address => bool) public isStakingPoolCreated;
    mapping (string => bool) private isPoolNameUsed;
    address[] public pools;
    address public withdrawalManagerImplementation;

    bytes32 public constant ROLE_MANAGER = keccak256("ROLE_MANAGER");

    event PoolImplementationUpdated(address _prevImpl, address _newImpl);
    event FundManagerImplementationUpdated(address _prevImpl, address _newImpl);
    event StakingPoolImplementationUpdated(address _prevImpl, address _newImpl);
    event ChainalysisAddressUpdated(address _prevAddress, address _newAddress);
    event SigmaTokenAddressUpdated(address _prevAddress, address _newAddress); 
    event PoolTokenAdded(address _poolToken);
    event PoolTokenRemoved(address _poolToken);
    event PoolManagerAdded(address _poolManager);
    event PoolManagerRemoved(address _poolManager);
    event PoolCreated(
        address _pool,
        address indexed _poolManager,
        address _fundManager,
        address indexed _poolToken,
        address indexed _oracleManager,
        uint256 _poolAPY,
        uint256 _poolSize
    );
    event StakingPoolCreated(address indexed _stakingPool, address indexed _pool);
    event WithdrawalManagerCreated(address indexed _withdrawalManager, address indexed _pool);
    event PoolManagerUpdated(address indexed _pool, address indexed _oldManager, address indexed _newManager);
    event PoolSizeUpdated(address indexed _pool, uint256 _oldValue, uint256 _newValue);
    event AdminTransferred(address _oldOwner, address _newOwner);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the factory with the given parameters
    /// @param _admin The address of the admin
    /// @param _fundManagerImpl The address of the fund manager implementation
    /// @param _stakingPoolImpl The address of the staking pool implementation
    /// @param _poolImpl The address of the pool implementation
    /// @param _diamondV1 The address of the diamond V1 contract
    /// @param _sigmaToken The address of the sigma token
    /// @param _chainalysis The address of the chainalysis contract
    function initialize(
        address _admin,
        address _fundManagerImpl,
        address _stakingPoolImpl,
        address _poolImpl,
        address _diamondV1,
        address _sigmaToken,
        address _chainalysis
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        fundManagerImplementation = _fundManagerImpl;
        poolImplementation = _poolImpl;
        stakingPoolImplementation = _stakingPoolImpl;
        diamondV1 = _diamondV1;
        sigmaToken = _sigmaToken;
        chainalysis = _chainalysis;
    }

    /// @notice Returns the total number of pools created
    function totalPools() external view returns (uint256) {
        return pools.length;
    }

    /// @notice Updates the pool implementation address
    /// @param _newImpl The address of the new pool implementation
    function updatePoolImplementation(address _newImpl) external onlyRole(ROLE_MANAGER) {
        if(_newImpl == address(0)) {
            revert InvalidAddress(_newImpl);
        }
        emit PoolImplementationUpdated(poolImplementation, _newImpl);
        poolImplementation = _newImpl;
    }

    /// @notice Updates the fund manager implementation address
    /// @param _newImpl The address of the new fund manager implementation
    function updateFundManagerImplementation(address _newImpl) external onlyRole(ROLE_MANAGER) {
        if(_newImpl == address(0)) {
            revert InvalidAddress(_newImpl);
        }
        emit FundManagerImplementationUpdated(fundManagerImplementation, _newImpl);
        fundManagerImplementation = _newImpl;
    }

    /// @notice Updates the withdrawal manager implementation address
    /// @param _newImpl The address of the new withdrawal manager implementation
    function updateWithdrawalManagerImplementation(address _newImpl) external onlyRole(ROLE_MANAGER) {
        if(_newImpl == address(0)) {
            revert InvalidAddress(_newImpl);
        }
        emit FundManagerImplementationUpdated(withdrawalManagerImplementation, _newImpl);
        withdrawalManagerImplementation = _newImpl;
    }

    /// @notice Updates the staking pool implementation address
    /// @param _newImpl The address of the new staking pool implementation
    function updateStakingPoolImplementation(address _newImpl) external onlyRole(ROLE_MANAGER) {
        if(_newImpl == address(0)) {
            revert InvalidAddress(_newImpl);
        }
        emit StakingPoolImplementationUpdated(stakingPoolImplementation, _newImpl);
        stakingPoolImplementation = _newImpl;
    }

    /// @notice Updates the chainalysis contract address
    /// @param _newAddr The address of the new chainalysis contract
    function updateChainalysisAddress(address _newAddr) external onlyRole(ROLE_MANAGER) {
        if(_newAddr == address(0)) {
            revert InvalidAddress(_newAddr);
        }
        emit ChainalysisAddressUpdated(chainalysis, _newAddr);
        chainalysis = _newAddr;
    }

    /// @notice Updates the sigma token address
    function updateSigmaTokenAddress(address _newAddr) external onlyRole(ROLE_MANAGER) {
        if(_newAddr == address(0)) {
            revert InvalidAddress(_newAddr);
        }
        emit SigmaTokenAddressUpdated(sigmaToken, _newAddr);
        sigmaToken = _newAddr;
    }

    /// @notice Adds a pool manager to the factory
    /// @param _poolManager The address of the pool manager
    function addPoolManager(address _poolManager) external onlyRole(ROLE_MANAGER) {
        if(_poolManager == address(0) || isPoolManager[_poolManager]) {
            revert InvalidAddress(_poolManager);
        }
        isPoolManager[_poolManager] = true;
        emit PoolManagerAdded(_poolManager);
    }

    /// @notice Removes a pool manager from the factory
    /// @param _poolManager The address of the pool manager
    function removePoolManager(address _poolManager) external onlyRole(ROLE_MANAGER) {
        if(!isPoolManager[_poolManager]) {
            revert InvalidAddress(_poolManager);
        }
        isPoolManager[_poolManager] = false;
        emit PoolManagerRemoved(_poolManager);
    }

    /// @notice Adds a token to the whitelist
    /// @param _token The address of the token
    function addTokenToWhitelist(address _token) external onlyRole(ROLE_MANAGER) {
        if(_token == address(0) || isWhitelistedToken[_token]) {
            revert InvalidAddress(_token);
        }
        isWhitelistedToken[_token] = true;
        emit PoolTokenAdded(_token);
    }

    /// @notice Removes a token from the whitelist
    /// @param _token The address of the token
    function removeTokenFromWhitelist(address _token) external onlyRole(ROLE_MANAGER) {
        if(!isWhitelistedToken[_token]) {
            revert InvalidAddress(_token);
        }
        isWhitelistedToken[_token] = false;
        emit PoolTokenRemoved(_token);
    }

    /// @notice Creates a new pool
    /// @param _poolName The name of the pool
    /// @param _poolSymbol The symbol of the pool
    /// @param _fundManagerLenderId The lender id of the fund manager
    /// @param _poolManager The address of the pool manager
    /// @param _poolToken The address of the pool token
    /// @param _oracleManager The address of the oracle manager
    /// @param _projectedAPY The projected APY of the pool
    /// @param _poolSize The size of the pool
    function createPool(
        string calldata _poolName,
        string calldata _poolSymbol,
        string calldata _fundManagerLenderId,
        address _poolManager,
        address _poolToken,
        address _oracleManager,
        uint256 _projectedAPY,
        uint256 _poolSize
    ) external onlyRole(ROLE_MANAGER) returns (address _poolAddress, address _fundManager) {
        if(!isPoolManager[_poolManager]) {
            revert InvalidAddress(_poolManager);
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
                CsigmaV2Pool.initialize.selector,
                string(abi.encodePacked("c", _poolName)),
                string(abi.encodePacked("c", _poolSymbol)),
                _poolManager,
                _fundManager,
                _poolToken,
                _oracleManager,
                _projectedAPY,
                _poolSize
            )));
        CsigmaV2FundManager(_fundManager).initialize(_poolToken, diamondV1, _fundManagerLenderId, _poolAddress);
        pools.push(_poolAddress);
        isPoolNameUsed[_poolName] = true;
        emit PoolCreated(_poolAddress, _poolManager, _fundManager, _poolToken, _oracleManager, _projectedAPY, _poolSize);
    }

    /// @notice Creates a new withdrawal manager
    /// @param _pool The address of the pool
    /// @param _csigmaRouter The address of the cSigma router
    /// @return _withdrawalManager The address of the withdrawal manager
    function createWithdrawalManager(address _pool, address _csigmaRouter) external onlyRole(ROLE_MANAGER) returns (address _withdrawalManager) {
        _withdrawalManager = address(new ERC1967Proxy(withdrawalManagerImplementation, abi.encodeWithSelector(CsigmaV2WithdrawalManager.initialize.selector, CsigmaV2Pool(_pool).asset(), _pool, _csigmaRouter)));
        CsigmaV2Pool(_pool).setWithdrawalManager(_withdrawalManager);
        emit WithdrawalManagerCreated(_withdrawalManager, _pool);
    }

    /// @notice Creates a new staking pool
    /// @param _pool The address of the pool for which the staking pool is to be created
    function createStakingPool(address _pool, address timelock) external onlyRole(ROLE_MANAGER) returns (address _stakingPool) {
        if(isStakingPoolCreated[_pool]) {
            revert StakingPoolExist(_pool);
        }
        _stakingPool = address(new ERC1967Proxy(stakingPoolImplementation, abi.encodeWithSelector(CsigmaV2StakingPool.initialize.selector, timelock, _pool, sigmaToken)));
        isStakingPoolCreated[_pool] = true;
        emit StakingPoolCreated(_stakingPool, _pool);
    }

    /// @notice Updates the pool manager of a pool
    /// @param _pool The address of the pool whose pool manager is to be updated
    function updatePoolManager(address _pool, address _poolManager) external onlyRole(ROLE_MANAGER) {
        if(!isPoolManager[_poolManager]) {
            revert InvalidAddress(_poolManager);
        }
        emit PoolManagerUpdated(_pool, CsigmaV2Pool(_pool).poolManager(), _poolManager);
        CsigmaV2Pool(_pool).updatePoolManager(_poolManager);
    }

    /// @notice Updates the pool size of a pool
    /// @param _pool The address of the pool whose pool size is to be updated
    function updatePoolSize(address _pool, uint256 _poolSize) external onlyRole(ROLE_MANAGER) {
        emit PoolSizeUpdated(_pool, CsigmaV2Pool(_pool).poolSize(), _poolSize);
        CsigmaV2Pool(_pool).updatePoolSize(_poolSize);
    }

    /// @notice Updates the pool investment limit
    /// @param _pool The address of the pool whose investment limit is to be updated
    function updatePoolInvestmentLimit(address _pool, uint256 _limit) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).updateMinimumInvestmentLimit(_limit);
    }

    /// @notice Updates the status of the pool to closed
    /// @param _pool The address of the pool whose status is to be updated to closed
    function closePool(address _pool) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).closePool();
    }

    /// @notice Adds a new oracle manager to a pool
    /// @param _pool The address of the pool to which the oracle manager is to be added
    function addOracleManager(address _pool, address _manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        CsigmaV2Pool(_pool).addOracleManager(_manager);
    }

    /// @notice Removes an oracle manager from a pool
    /// @param _pool The address of the pool from which the oracle manager is to be removed
    function removeOracleManager(address _pool, address _manager) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).removeOracleManager(_manager);
    }

    /// @notice Updates the pause start time of a pool
    /// @param _pool The address of the pool whose pause start time is to be updated
    /// @param _pauseStartTime The new pause start time
    function updatePauseStartTime(address _pool, uint64 _pauseStartTime) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).updatePauseStartTime(_pauseStartTime);
    }

    /// @notice Updates the pause duration of a pool
    /// @param _pool The address of the pool whose pause duration is to be updated
    /// @param _pauseDuration The new pause duration
    function updatePauseDuration(address _pool, uint64 _pauseDuration) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).updatePauseDuration(_pauseDuration);
    }

    /// @notice Updates the reserve percentage of a pool
    /// @param _pool The address of the pool whose reserve percentage is to be updated
    /// @param _percentage The new reserve percentage
    function updateNonReservePercentage(address _pool, uint64 _percentage) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).updateNonReservePercentage(_percentage);
    }

    /// @notice This function is used to update the AUM update cooldown period
    /// @dev Only the admin can call this function
    /// @param _pool The address of the pool
    /// @param _cooldownPeriod The new cooldown period
    function updateAUMUpdateCooldownPeriod(address _pool, uint64 _cooldownPeriod) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).updateAUMUpdateCooldownPeriod(_cooldownPeriod);
    }

    /// @notice This function is used to update the AUM change threshold percentage
    /// @dev Only the admin can call this function
    /// @param _pool The address of the pool
    /// @param _thresholdPercentage The new threshold percentage
    function updateAUMChangeThresholdPercentage(address _pool, uint64 _thresholdPercentage) external onlyRole(ROLE_MANAGER) {
        CsigmaV2Pool(_pool).updateAUMChangeThresholdPercentage(_thresholdPercentage);
    }

    /// @notice Updates the cSigma router address of a pool
    /// @dev Only the admin can call this function
    /// @param _withdrawManager The address of the WithdrawManager
    /// @param _csigmaRouter The address of the new cSigma router
    function updateCsigmaRouter(address _withdrawManager, address _csigmaRouter) external onlyRole(ROLE_MANAGER) {
        CsigmaV2WithdrawalManager(_withdrawManager).updateCsigmaRouter(_csigmaRouter);
    }

    /// @notice Updates the implementation of a proxy which maybe a pool,staking pool or fund manager
    /// @param _target The address of the proxy
    /// @param _implementation The address of the new implementation
    function upgradeTarget(address _target, address _implementation) external onlyRole(DEFAULT_ADMIN_ROLE) {
        UUPSUpgradeable(_target).upgradeTo(_implementation);
    }
    
    /// @notice Pauses a target contract
    /// @param _target The address of the target contract
    function pauseTarget(address _target) external onlyRole(ROLE_MANAGER) {
        AccessControl(_target).pause();
    }

    /// @notice Unpauses a target contract
    /// @param _target The address of the target contract
    function unpauseTarget(address _target) external onlyRole(ROLE_MANAGER) {
        AccessControl(_target).unpause();
    }

    /// @notice Burns LP tokens from a blacklisted address via a controlled Admin path
    /// @param _pool The address of the pool
    /// @param _account The blacklisted address whose LP tokens are being burned
    /// @param _amount The amount of LP tokens to burn
    function burnFromBlacklist(address _pool, address _account, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        CsigmaV2Pool(_pool).burnFromBlacklist(_account, _amount);
    }

    /// @notice Withdraws tokens from a target contract
    /// @param _target The address of the target contract
    function emergencyWithdraw(address _target, address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AccessControl(_target).emergencyWithdraw(_token, _to, _amount);
    }

    /// @notice Updates the AUM of a pool
    /// @param _pool The address of the pool
    /// @param _assetUnderManagement The new AUM
    function emergencyUpdateAUM(address _pool, uint256 _assetUnderManagement) external onlyRole(DEFAULT_ADMIN_ROLE) {
        CsigmaV2Pool(_pool).emergencyUpdateAUM(_assetUnderManagement);
    }

    /// @notice Grants a role to an account in a target contract
    /// @param _target The address of the target contract
    /// @param role The role to be granted
    /// @param _account The address of the account to which the role is to be granted
    function grantRoleTarget(address _target, bytes32 role, address _account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AccessControl(_target).grantRole(role, _account);
    }

    /// @notice Revokes a role from an account in a target contract
    /// @param _target The address of the target contract
    /// @param role The role to be revoked
    /// @param _account The address of the account from which the role is to be revoked
    function revokeRoleTarget(address _target, bytes32 role, address _account) external onlyRole(ROLE_MANAGER) {
        AccessControl(_target).revokeRole(role, _account);
    }

    /// @notice Transfers the admin role to a new account
    /// @param _newOwner The address of the new admin
    function transferAdmin(address _newOwner) public {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }    

    /// @notice Adds a particular role on the current contract
    /// @param role The role to be added
    /// @param _account The address of the account to which the role is to be added
    function grantRole(bytes32 role, address _account)
        public
        virtual
        override
        onlyRole(getRoleAdmin(role))
    {
        _grantRole(role, _account);
    }

    /// @notice Revokes a particular role on the current contract
    /// @param role The role to be revoked
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