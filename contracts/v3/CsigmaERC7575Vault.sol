// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./CsigmaERC4626.sol";
import "./CsigmaV3WithdrawalManager.sol";

error PoolIsNotActive();
error InvalidPoolSize(uint256 _poolSize);
error InvalidStatusUpdate();
error AccessDenied(address _executor);
error WithdrawalPending();
error InvalidDepositAmount(uint256 _assets);
error InvalidAddress(address _newImpl);
error AssetsFrozen(address _account);

/// @title FundManager
/// @notice This interface is used to get the total assets managed by the fund manager
interface FundManager {
    function totalAssets(address _token) external view returns (uint256);
}

/// @title WithdrawManager Interface
/// @notice Interface for withdrawal manager contracts that handle LP token withdrawal queues
interface WithdrawManager {
    function totalDueLPToken() external view returns (uint256);
    function repay(uint256 _queuePosition, uint256 _amount) external;
    function updateCsigmaRouter(address _csigmaRouter) external;
}

/// @title AccessControl
/// @notice Interface to interact with the AccessControl functionalities of a contract
interface AccessControl {
    function grantRole(bytes32 role, address _account) external;
    function revokeRole(bytes32 role, address _account) external;
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external;
}

/// @title CsigmaV3Pool
/// @notice ERC-4626 compliant vault for managing tokenized real-world credit pools
/// @dev Implements upgradeable proxy pattern with access control, pausability, and withdrawal management
contract CsigmaV3Pool is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ERC4626Upgradeable
{
    /// @notice Role identifier for oracle managers who can update AUM values
    bytes32 public constant ROLE_ORACLE_MANAGER = keccak256("ROLE_ORACLE_MANAGER");
    
    /// @notice Role identifier for pool managers who can perform operational functions
    bytes32 public constant ROLE_MANAGER = keccak256("ROLE_MANAGER");    
    
    /// @notice Address of the share token contract (csUSD)
    /// @dev Used for ERC-20 operations on vault shares
    address public share;
    
    /// @notice Percentage of deposits not held in reserve (sent to fund manager)
    /// @dev Expressed in basis points (e.g., 9500 = 95%)
    uint64 public nonReservePercentage;
    
    /// @notice Address of the pool manager
    /// @dev Has administrative privileges for pool operations
    address public poolManager;
    
    /// @notice Duration of daily pause window in seconds
    /// @dev During this window, certain operations are restricted
    uint64 public pauseDuration;
    
    /// @notice Address of the fund manager contract
    /// @dev Manages assets deployed outside the vault
    address public fundManager;
    
    /// @notice Start time of daily pause window (seconds from midnight)
    /// @dev Used to calculate when pause window is active
    uint64 public pauseStartTime;
    
    /// @notice Address of the underlying pool token (asset)
    /// @dev The ERC-20 token that the vault accepts as deposits
    address public poolToken;
    
    /// @notice Current status of the pool
    /// @dev Can be PENDING, ACTIVE, or CLOSE
    PoolStatus public status;
    
    /// @notice Timestamp when AUM was last updated
    /// @dev Used to enforce cooldown periods between AUM updates
    uint64 public AUMLastUpdatedAt;
    
    /// @notice Address of the withdrawal manager contract
    /// @dev Handles queued withdrawals when liquidity is insufficient
    address public withdrawalManager;
    
    /// @notice Threshold percentage for AUM changes
    /// @dev Expressed as basis points above 10000 (e.g., 10008 = 0.08% threshold)
    uint64 public AUMChangeThresholdPercentage;
    
    /// @notice Implementation address for withdrawal manager proxy
    /// @dev Used when creating new withdrawal manager instances
    address public withdrawalManagerImplementation;
    
    /// @notice Cooldown period between AUM updates in seconds
    /// @dev Prevents frequent AUM updates that could be manipulated
    uint64 public AUMUpdateCooldownPeriod;
    
    /// @notice Current assets under management by institutional vaults
    /// @dev Added to vault balance and fund manager balance for total assets
    uint256 public assetUnderManagement;

    /// @notice Possible states of the pool lifecycle
    /// @dev PENDING: Pool created but not active for deposits
    /// @dev ACTIVE: Pool accepting deposits and withdrawals
    /// @dev CLOSE: Pool closed, no new operations allowed
    enum PoolStatus {PENDING, ACTIVE, CLOSE}
    
    /// @notice Emitted when an oracle manager is added
    /// @param _account The address that was granted oracle manager role
    event OracleManagerAdded(address _account);
    
    /// @notice Emitted when an oracle manager is removed
    /// @param _account The address that lost oracle manager role
    event OracleManagerRemoved(address _account);
    
    /// @notice Emitted when admin role is transferred
    /// @param _oldOwner The previous admin address
    /// @param _newOwner The new admin address
    event AdminTransferred(address _oldOwner, address _newOwner);
    
    /// @notice Emitted when pool status changes
    /// @param _by The address that initiated the status change
    /// @param _prevStatus The previous pool status
    /// @param _newStatus The new pool status
    event PoolStatusUpdated(address indexed _by, PoolStatus _prevStatus, PoolStatus _newStatus);
    
    /// @notice Emitted when assets under management value is updated
    /// @param _by The address that updated the AUM
    /// @param _prevValue The previous AUM value
    /// @param _newValue The new AUM value
    event AssetUnderManagementUpdated(address indexed _by, uint256 _prevValue, uint256 _newValue);
    
    /// @notice Emitted when emergency withdrawal is performed
    /// @param _token The token that was withdrawn
    /// @param _to The recipient of the withdrawal
    /// @param _amount The amount withdrawn
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);
    
    /// @notice Emitted when reserve funds are sent to fund manager
    /// @param _fundManager The fund manager receiving the funds
    /// @param _amount The amount sent
    event SendReserveToFundManager(address _fundManager, uint256 _amount);
    
    /// @notice Emitted when a new withdrawal manager is created
    /// @param _withdrawalManager The address of the created withdrawal manager
    /// @param _pool The pool associated with the withdrawal manager
    event WithdrawalManagerCreated(address indexed _withdrawalManager, address indexed _pool);

    /// @notice Ensures function is not called during the default pause window
    /// @dev Checks current time against pause start time and duration
    modifier whenNotInDefaultPauseWindow() {
        _requireNotInDefaultPauseWindow();
        _;
    }

    /// @notice Reverts if the given address is blacklisted
    /// @param _account The address to check against the blacklist
    modifier whenNotBlacklisted(address _account) {
        if(IShareToken(share).isBlacklisted(_account)) {
            revert AssetsFrozen(_account);
        }
        _;
    }
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice This function is used to initialize the contract
    /// @param _share The address of the share token contract (csUSD)
    /// @param _poolManager The address of the pool manager
    /// @param _fundManager The address of the fund manager
    /// @param _manager The address of the ops manager multisig 
    /// @param _poolToken The address of the pool token
    /// @param _assetOracle The address of the asset oracle contract 
    /// @param _oracleManager The address of the oracle manager
    /// @param _withdrawalManagerImplementation The address of the _withdrawalManager Implementation
    function initialize(
        address _share,
        address _poolManager,
        address _fundManager,
        address _manager,
        address _poolToken,
        address _assetOracle,
        address _oracleManager,
        address _withdrawalManagerImplementation
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ERC4626_init(IERC20Upgradeable(_poolToken), IERC20Upgradeable(_share), _assetOracle);
        
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ROLE_ORACLE_MANAGER, _oracleManager);
        _grantRole(ROLE_ORACLE_MANAGER, _fundManager);
        _grantRole(ROLE_MANAGER, _manager);
        share = _share;
        poolManager = _poolManager;
        fundManager = _fundManager;
        poolToken = _poolToken;
        withdrawalManagerImplementation = _withdrawalManagerImplementation;
        AUMChangeThresholdPercentage = 10050;
        AUMUpdateCooldownPeriod = 45 minutes;
        nonReservePercentage = 9500;
        pauseDuration = 1800;
    }

    /// @notice Returns true if the contract supports a given interface
    /// @param interfaceId Interface identifier (ERC-165, ERC-7575)
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return interfaceId == 0x2f0a18c5 || interfaceId == 0x01ffc9a7;
	}

    /// @notice This function is used to get the total amount of the underlying asset that is “managed” by Vault
    /// @return The total assets
    function totalAssets() public view virtual override returns (uint256) {
        return (IERC20Upgradeable(poolToken).balanceOf(address(this)) + FundManager(fundManager).totalAssets(poolToken) + assetUnderManagement);
    }

    /// @notice This function returns the maximum amount of assets that can be withdrawn
    /// @return The maximum amount of assets
    function maxWithdraw(address) public view virtual override returns (uint256) {
        return IERC20Upgradeable(poolToken).balanceOf(address(this));
    }

    /// @notice This function returns the maximum amount of shares that can be redeemed
    /// @return The maximum amount of shares
    function maxRedeem(address) public view virtual override returns (uint256) {
        return _convertToShares(maxWithdraw(address(0)), MathUpgradeable.Rounding.Down);
    }

    /// @notice This function is used to deposit the assets
    /// @param assets The amount of assets to deposit
    /// @param receiver The address of the receiver
    /// @return shares The amount of shares minted
    function deposit(uint256 assets, address receiver) public virtual override whenNotPaused whenNotInDefaultPauseWindow whenNotBlacklisted(_msgSender()) returns (uint256 shares) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        shares = super.deposit(assets, receiver);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(poolToken), fundManager, (assets * nonReservePercentage) / 10000);
    }

    /// @notice This function is used to mint the shares
    /// @param shares The amount of shares to mint
    /// @param receiver The address of the receiver
    /// @return assets The amount of assets used to mint the shares
    function mint(uint256 shares, address receiver) public virtual override whenNotPaused whenNotInDefaultPauseWindow whenNotBlacklisted(_msgSender()) returns (uint256 assets) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        assets = super.mint(shares, receiver);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(poolToken), fundManager, (assets * nonReservePercentage) / 10000);
    }

    /// @notice This function is used to withdraw the assets
    /// @param assets The amount of assets to withdraw
    /// @param receiver The address of the receiver
    /// @param owner The address of the owner of the assets
    /// @return The amount of shares burned
    function withdraw(uint256 assets, address receiver, address owner) public virtual override whenNotPaused whenNotInDefaultPauseWindow whenNotBlacklisted(_msgSender()) returns (uint256) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        return super.withdraw(assets, receiver, owner);
    }

    /// @notice This function is used to redeem the shares
    /// @param shares The amount of shares to redeem
    /// @param receiver The address of the receiver
    /// @param owner The address of the owner of the shares
    /// @return The amount of assets redeemed
    function redeem(uint256 shares, address receiver, address owner) public virtual override whenNotPaused whenNotInDefaultPauseWindow whenNotBlacklisted(_msgSender()) returns (uint256) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        return super.redeem(shares, receiver, owner);
    }

    /// @notice This function is used to update the pool manager
    /// @dev Only the admin can call this function
    /// @param _poolManager The address of the new pool manager
    function updatePoolManager(address _poolManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        poolManager = _poolManager;
    }

    /// @notice This function is used to update the status of the pool from pending to active
    /// @dev Only the pool manager can call this function
    function activatePool() external whenNotPaused whenNotInDefaultPauseWindow onlyRole(ROLE_MANAGER) {
        if(status != PoolStatus.PENDING) revert InvalidStatusUpdate();
        status = PoolStatus.ACTIVE;
        emit PoolStatusUpdated(_msgSender(), PoolStatus.PENDING, PoolStatus.ACTIVE);
    }

    /// @notice This function is used to update the status of the pool to close
    /// @dev Only the admin can call this function
    function closePool() external onlyRole(ROLE_MANAGER) {
        if(status == PoolStatus.CLOSE) revert InvalidStatusUpdate();
        if(totalAssets() != 0)  revert WithdrawalPending();
        emit PoolStatusUpdated(_msgSender(), status, PoolStatus.CLOSE);
        status = PoolStatus.CLOSE;
    }

    /// @notice This function is used to update the AUM of the pool
    /// @dev Only the oracle manager can call this function
    /// @param _assetUnderManagement The new AUM
    function updateAssetUnderManagement(uint256 _assetUnderManagement) external onlyRole(ROLE_ORACLE_MANAGER) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        if (msg.sender != fundManager) {
            if (block.timestamp - AUMLastUpdatedAt < AUMUpdateCooldownPeriod) revert("Cooldown period not elapsed");

            uint256 delta = assetUnderManagement * (AUMChangeThresholdPercentage - 10000) / 10000;
            uint256 lowerBound = assetUnderManagement > delta ? assetUnderManagement - delta : 0;
            uint256 upperBound = assetUnderManagement + delta;

            if (_assetUnderManagement < lowerBound || _assetUnderManagement > upperBound) {
                revert("Threshold not met");
            }
            AUMLastUpdatedAt = uint64(block.timestamp);
        }
        emit AssetUnderManagementUpdated(_msgSender(), assetUnderManagement, _assetUnderManagement);
        assetUnderManagement = _assetUnderManagement;
    }

    /// This function is used to update the pause duration
    /// @dev Only the admin can call this function
    /// @param _duration The new pause duration
    function updatePauseDuration(uint64 _duration) external onlyRole(ROLE_MANAGER) {
        pauseDuration = _duration;
    }

    /// @notice This function is used to update the pause start time
    /// @dev Only the admin can call this function
    /// @param _time The new pause start time
    function updatePauseStartTime(uint64 _time) external onlyRole(ROLE_MANAGER) {
        pauseStartTime = _time;
    }

    /// @notice This function is used to update the reserve percentage
    /// @dev Only the admin or pool manager can call this function
    /// @param _percentage The new reserve percentage
    function updateNonReservePercentage(uint64 _percentage) external onlyRole(ROLE_MANAGER) {
        nonReservePercentage = _percentage;
    }

    /// @notice This function is used to update the AUM update cooldown period
    /// @dev Only the admin can call this function
    /// @param _cooldownPeriod The new cooldown period
    function updateAUMUpdateCooldownPeriod(uint64 _cooldownPeriod) external onlyRole(ROLE_MANAGER) {
        AUMUpdateCooldownPeriod = _cooldownPeriod;
    }

    /// @notice This function is used to update the AUM change threshold percentage
    /// @dev Only the admin can call this function
    /// @param _thresholdPercentage The new threshold percentage
    function updateAUMChangeThresholdPercentage(uint64 _thresholdPercentage) external onlyRole(ROLE_MANAGER) {
        AUMChangeThresholdPercentage = 10000 + _thresholdPercentage;
    }

    /// @notice Creates a new withdrawal manager
    /// @param _csigmaRouter The address of the cSigma router
    /// @return _withdrawalManager The address of the withdrawal manager
    function createWithdrawalManager(address _csigmaRouter) external onlyRole(ROLE_MANAGER) returns (address _withdrawalManager) {
        require(withdrawalManager == address(0), "Withdrawal manager already created");
        _withdrawalManager = address(new ERC1967Proxy(withdrawalManagerImplementation, abi.encodeWithSelector(CsigmaV3WithdrawalManager.initialize.selector, asset(), address(this), _csigmaRouter)));
        withdrawalManager = _withdrawalManager;
        emit WithdrawalManagerCreated(_withdrawalManager, address(this));
    }

    /// @notice Updates the implementation of a withdrawalManager proxy
    /// @param _newImplementation The address of the new implementation
    function upgradeWithdrawalManager(address _newImplementation) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if(_newImplementation == address(0)) {
            revert InvalidAddress(_newImplementation);
        }
        withdrawalManagerImplementation = _newImplementation;
        UUPSUpgradeable(withdrawalManager).upgradeTo(_newImplementation);
    }

    /// @notice This function is used to check if the account is an oracle manager
    /// @param _account The address of the account
    function isOracleManager(address _account) public view returns (bool) {
        return hasRole(ROLE_ORACLE_MANAGER, _account);
    }

    /// @notice update router address in withdrawal Manager 
    /// @param _csigmaRouter The address of the new csigmaRouter
    function updateCsigmaRouter(address _csigmaRouter) external onlyRole(ROLE_MANAGER) {
        WithdrawManager(withdrawalManager).updateCsigmaRouter(_csigmaRouter);
    } 

    /// @notice Withdraws tokens from a target contract
    /// @param _target The address of the target contract
    function emergencyWithdrawTarget(address _target, address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AccessControl(_target).emergencyWithdraw(_token, _to, _amount);
    } 

    /// @notice Pauses the contract 
    /// @dev Only the admin can call this function
    function pause() external {
        require(
            hasRole(ROLE_MANAGER, _msgSender()) || 
            hasRole(ROLE_ORACLE_MANAGER, _msgSender()), 
            "Access Denied"
        );
        _pause();
    }

    /// @notice Unpauses the contract
    /// @dev Only the admin can call this function
    function unpause() external {
        require(
            hasRole(ROLE_MANAGER, _msgSender()) || 
            hasRole(ROLE_ORACLE_MANAGER, _msgSender()), 
            "Access Denied"
        );
        _unpause();
    }

    /// @notice Adds an oracle manager
    /// @dev Only the admin can call this function
    /// @param _account The address of the oracle manager
    function addOracleManager(address _account) public onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(ROLE_ORACLE_MANAGER, _account);
        emit OracleManagerAdded(_account);
    }

    /// @notice Removes an oracle manager
    /// @dev Only the admin can call this function
    /// @param _account The address of the oracle manager
    function removeOracleManager(address _account) public onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(ROLE_ORACLE_MANAGER, _account);
        emit OracleManagerRemoved(_account);
    }

    /// @notice This function is used to send funds from reserve to fund manager
    /// @dev Only the pool manager can call this function
    /// @param _amount The amount to send 
    function sendReserveToFundManager(uint256 _amount) external {
        if(_msgSender() != poolManager) revert AccessDenied(_msgSender());
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(poolToken), fundManager, _amount);
        emit SendReserveToFundManager(fundManager, _amount);
    }

    /// @notice Withdraws the funds from the contract
    /// @dev Only the admin can call this function
    /// @param _token The address of the token
    /// @param _to The address to which the funds are withdrawn
    /// @param _amount The amount to withdraw
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_token), _to, _amount);
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    /// @notice Updates the AUM of the pool
    /// @param _assetUnderManagement The new AUM
    function emergencyUpdateAUM(uint256 _assetUnderManagement) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit AssetUnderManagementUpdated(_msgSender(), assetUnderManagement, _assetUnderManagement);
        assetUnderManagement = _assetUnderManagement;
    }

    /// @notice Transfers the admin role to a new address
    /// @param _newOwner The address of the new admin
    function transferAdmin(address _newOwner) public {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }  

    /// @notice Grants a role to an account in a target contract
    /// @param _target The address of the target contract
    /// @param role The role to be granted
    /// @param _account The address of the account to which the role is to be granted
    function grantRoleTarget(address _target, bytes32 role, address _account) external onlyRole(getRoleAdmin(role)) whenNotPaused {
        AccessControl(_target).grantRole(role, _account);
    }

    /// @notice Revokes a role from an account in a target contract
    /// @param _target The address of the target contract
    /// @param role The role to be revoked
    /// @param _account The address of the account from which the role is to be revoked
    function revokeRoleTarget(address _target, bytes32 role, address _account) external onlyRole(getRoleAdmin(role)) whenNotPaused {
        AccessControl(_target).revokeRole(role, _account);
    }

    /// @notice Grants the given role to the account
    /// @param role The role to grant
    /// @param _account The address to which the role is granted
    function grantRole(bytes32 role, address _account)
        public
        virtual
        override
        onlyRole(getRoleAdmin(role))
        whenNotPaused
    {
        _grantRole(role, _account);
    }

    /// @notice Revokes the given role from the account
    /// @param role The role to revoke
    /// @param _account The address from which the role is revoked
    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))        
        whenNotPaused
    {
        _revokeRole(role, _account);
    }

    /// @notice Upgrades the contract to a new implementation
    /// @dev Only the admin can call this function
    /// @param _newImplementation The address of the new implementation
    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}

    /// @notice Checks if current time is within the default pause window
    /// @dev Reverts if within pause window based on daily timing
    function _requireNotInDefaultPauseWindow() internal view {
        uint64 currentSecond = uint64(block.timestamp % 86400);
        require(
            currentSecond < pauseStartTime || 
            currentSecond > pauseStartTime + pauseDuration,
            "Pausable: paused"
        );
    }

    /// @notice Internal withdraw function with withdrawal manager integration
    /// @dev Checks for pending withdrawals before allowing direct withdrawals
    /// @param caller The address initiating the withdrawal
    /// @param receiver The address receiving the assets
    /// @param owner The owner of the shares being redeemed
    /// @param assets The amount of assets being withdrawn
    /// @param shares The amount of shares being burned
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        if (caller != withdrawalManager)
            if (withdrawalManager != address(0))
                require(WithdrawManager(withdrawalManager).totalDueLPToken() == 0, "Withdrawal pending");
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /// @notice Returns the allowance of spender for owner's tokens
    /// @dev Delegates to the share token contract
    /// @param owner The token owner address
    /// @param spender The address authorized to spend
    /// @return The current allowance amount
    function allowance(address owner, address spender) external view returns (uint256) {
        return IERC20MetadataUpgradeable(share).allowance(owner, spender);
    }
    
    /// @notice Approves spender to spend amount of caller's tokens
    /// @dev Delegates to the share token contract
    /// @param spender The address to approve
    /// @param amount The amount to approve
    /// @return bool True if approval was successful
    function approve(address spender, uint256 amount) external returns (bool) {
        return IShareToken(share).nativeApprove(_msgSender(), spender, amount);
    }
    
    /// @notice Transfers amount of tokens to recipient
    /// @dev Delegates to the share token contract
    /// @param to The recipient address
    /// @param amount The amount to transfer
    /// @return bool True if transfer was successful
    function transfer(address to, uint256 amount) external returns (bool) {
        return IShareToken(share).nativeTransfer(_msgSender(), to, amount);
    }
    
    /// @notice Transfers amount of tokens from one address to another
    /// @dev Delegates to the share token contract
    /// @param from The sender address
    /// @param to The recipient address
    /// @param amount The amount to transfer
    /// @return bool True if transfer was successful
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        return IShareToken(share).nativeTransferFrom(_msgSender(), from, to, amount);
    }
    
    /// @notice Returns the token balance of an account
    /// @dev Delegates to the share token contract
    /// @param account The account to query
    /// @return The token balance
    function balanceOf(address account) external view returns (uint256) {
        return IERC20MetadataUpgradeable(share).balanceOf(account);
    }
    
    /// @notice Returns the name of the token
    /// @dev Delegates to the share token contract
    /// @return The token name
    function name() external view returns (string memory) {
        return IERC20MetadataUpgradeable(share).name();
    }
    
    /// @notice Returns the symbol of the token
    /// @dev Delegates to the share token contract
    /// @return The token symbol
    function symbol() external view returns (string memory) {
        return IERC20MetadataUpgradeable(share).symbol();
    }
    
    /// @notice Returns the total supply of tokens
    /// @dev Delegates to the share token contract
    /// @return The total token supply
    function totalSupply() external view returns (uint256) {
        return IERC20MetadataUpgradeable(share).totalSupply();
    }
}