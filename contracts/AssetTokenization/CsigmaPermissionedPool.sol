// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "./CsigmaPermissionedFactory.sol";
import "../interfaces/ICsigmaV1.sol";

error PoolIsNotActive();
error InvalidPoolSize(uint256 _poolSize);
error InvalidStatusUpdate();
error AccessDenied(address _executor);
error WithdrawalPending();
error InvalidDepositAmount(uint256 _assets);
error LenderNotVerified(string _lenderId);

/// @notice Thrown when a lender has insufficient LP tokens for an operation
/// @param lender The lender's address
/// @param requested The amount of LP tokens requested
/// @param available The amount of LP tokens available
error InsufficientLPTokens(address lender, uint256 requested, uint256 available);

/// @notice Thrown when an operation is attempted with zero amount
error ZeroAmount();

/// @title FundManager
/// @notice Interface to get the total assets managed by the fund manager
interface FundManager {
    function totalAssets() external view returns (uint256);
}

/// @title WithdrawManager
/// @notice Interface for withdrawal queue management
interface WithdrawManager {
    function totalDueLPToken() external view returns (uint256);
    function repay(uint256 _queuePosition, uint256 _amount) external;
}

/// @title IFactory
/// @notice Interface to access factory configuration
interface IFactory {
    function diamondV1() external view returns (address);
}

/// @title CsigmaPermissionedPool
/// @notice ERC-4626 compliant vault for managing lender deposits with KYB verification
contract CsigmaPermissionedPool is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ERC4626Upgradeable
{
    /// @notice Role identifier for oracle managers who can update AUM
    bytes32 public constant ROLE_ORACLE_MANAGER = keccak256("ROLE_ORACLE_MANAGER");
    
    /// @notice Address of the factory that deployed this pool
    address public factory;
    
    /// @notice Address of the fund manager receiving deployed capital
    address public fundManager;
    
    /// @notice Current status of the pool (PENDING, ACTIVE, or CLOSE)
    PoolStatus public status;
    
    /// @notice Maximum size of the pool in underlying token units
    uint256 public poolSize;
    
    /// @notice Total assets currently under management (deployed to V1 pools)
    uint256 public assetUnderManagement;
    
    /// @notice Percentage of deposits sent to fund manager 
    uint64 public nonReservePercentage;
    
    /// @notice Duration of the daily pause window in seconds
    uint64 public pauseDuration;
    
    /// @notice Start time of the daily pause window (seconds from midnight)
    uint64 public pauseStartTime;
    
    /// @notice Minimum deposit amount required for investments
    uint256 public minimumInvestmentLimit;
    
    /// @notice Timestamp of the last AUM update by oracle managers
    uint64 public AUMLastUpdatedAt;
    
    /// @notice Maximum allowed AUM change percentage (in basis points above 10000, e.g., 10080 = 0.8% change)
    uint64 public AUMChangeThresholdPercentage;
    
    /// @notice Minimum time between AUM updates by oracle managers
    uint64 public AUMUpdateCooldownPeriod;
    
    /// @notice Address of the withdrawal manager for handling withdrawal queues
    address public withdrawalManager;

    /// @notice Pool status enumeration
    enum PoolStatus {PENDING, ACTIVE, CLOSE}
    
    /// @notice Mapping to track whitelisted lenders who can interact with the pool
    mapping (address => bool) public isLenderWhitelisted;

    /// @notice Address of the pool manager
    /// @dev Has administrative privileges for pool operations
    address public poolManager;
    
    /// @notice Emitted when an oracle manager is added
    /// @param _account The address of the oracle manager added
    event OracleManagerAdded(address _account);
    
    /// @notice Emitted when an oracle manager is removed
    /// @param _account The address of the oracle manager removed
    event OracleManagerRemoved(address _account);
    
    /// @notice Emitted when the admin role is transferred
    /// @param _oldOwner The address of the previous admin
    /// @param _newOwner The address of the new admin
    event AdminTransferred(address _oldOwner, address _newOwner);
    
    /// @notice Emitted when the pool status is updated
    /// @param _by The address that updated the status
    /// @param _prevStatus The previous pool status
    /// @param _newStatus The new pool status
    event PoolStatusUpdated(address indexed _by, PoolStatus _prevStatus, PoolStatus _newStatus);
    
    /// @notice Emitted when the asset under management is updated
    /// @param _by The address that updated the AUM
    /// @param _prevValue The previous AUM value
    /// @param _newValue The new AUM value
    event AssetUnderManagementUpdated(address indexed _by, uint256 _prevValue, uint256 _newValue);
    
    /// @notice Emitted when the minimum investment limit is updated
    /// @param _by The address that updated the limit
    /// @param _prevValue The previous minimum investment limit
    /// @param _newValue The new minimum investment limit
    event MinimumInvestmentLimitUpdated(address indexed _by, uint256 _prevValue, uint256 _newValue);
    
    /// @notice Emitted when an emergency withdrawal is executed
    /// @param _token The address of the token withdrawn
    /// @param _to The address receiving the withdrawn tokens
    /// @param _amount The amount withdrawn
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);
    
    /// @notice Emitted when reserve funds are sent to the fund manager
    /// @param _fundManager The address of the fund manager
    /// @param _amount The amount sent
    event SendReserveToFundManager(address _fundManager, uint256 _amount);
    
    /// @notice Emitted when a lender is added to the whitelist
    /// @param _lenderId The lender ID from Diamond V1
    /// @param _lenderAddr The address of the whitelisted lender
    event LenderAdded(string _lenderId, address _lenderAddr);
    
    /// @notice Emitted when a lender is removed from the whitelist
    /// @param _lenderAddr The address of the removed lender
    event LenderRemoved(address _lenderAddr);
    
    /// @notice Emitted when a lender is repaid by the pool manager
    /// @param lender The address of the lender repaid
    /// @param sharesBurned The amount of LP shares burned
    /// @param assetsRepaid The amount of assets repaid
    event PMRepayAndBurn(address indexed lender, uint256 sharesBurned, uint256 assetsRepaid);
    
    /// @notice Emitted when LP tokens are burned from a compromised address
    /// @param _token The address of the token contract
    /// @param _account The compromised address
    /// @param _amount The amount of tokens burned
    event BurnFromCompromissedExecuted(address indexed _token, address indexed _account, uint256 _amount);

    /// @notice Emitted when the operational pool manager is rotated
    /// @param _oldPM The previous pool manager address
    /// @param _newPM The new pool manager address
    event PoolManagerUpdated(address indexed _oldPM, address indexed _newPM);

    /// @notice Modifier to ensure the user is whitelisted
    /// @param _user The address to check
    modifier isWhitelisted(address _user) {
        if(_user != address(0) && _user != withdrawalManager && !isLenderWhitelisted[_user]) {
            revert AccessDenied(_user);
        }
        _;
    }

    /// @notice Modifier to ensure the current time is not within the daily pause window
    modifier whenNotInDefaultPauseWindow() {
        _requireNotInDefaultPauseWindow();
        _;
    }

    /// @notice Restricts a function to the operational pool manager
    modifier onlyPoolManager() {
        if (_msgSender() != poolManager) revert AccessDenied(_msgSender());
        _;
    }
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the pool with the required parameters
    /// @param _poolName The name of the pool
    /// @param _poolSymbol The symbol of the pool
    /// @param _poolManager The address of the pool manager who will have admin role
    /// @param _fundManager The address of the fund manager receiving deployed capital
    /// @param _poolToken The address of the underlying ERC20 token
    /// @param _oracleManager The address of the oracle manager for AUM updates
    /// @param _poolSize The maximum size of the pool
    function initialize(
        string calldata _poolName,
        string calldata _poolSymbol,
        address _poolManager,
        address _fundManager,
        address _poolToken,
        address _oracleManager,
        uint256 _poolSize
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();
        __ERC4626_init(IERC20Upgradeable(_poolToken));
        __ERC20_init(_poolName, _poolSymbol);

        _grantRole(DEFAULT_ADMIN_ROLE, _poolManager);
        _grantRole(ROLE_ORACLE_MANAGER, _oracleManager);
        _grantRole(ROLE_ORACLE_MANAGER, _fundManager);
        poolManager = _poolManager;
        factory = _msgSender();
        fundManager = _fundManager;
        AUMChangeThresholdPercentage = 10080;
        AUMUpdateCooldownPeriod = 45 minutes;
        poolSize = _poolSize;
        nonReservePercentage = 9500;
        pauseDuration = 1800;
    }

    /// @notice Returns the total amount of underlying assets managed by the vault
    /// @dev Includes pool reserve, fund manager balance, and assets under management
    /// @return The total assets under management
    function totalAssets() public view virtual override returns (uint256) {
        return (IERC20Upgradeable(asset()).balanceOf(address(this)) + FundManager(fundManager).totalAssets() + assetUnderManagement);
    }

    /// @notice This function returns the maximum deposit amount
    /// @return The maximum deposit amount
    function maxDeposit(address) public view virtual override returns (uint256) {
        return (poolSize - assetUnderManagement);
    }

    /// @notice This function returns the maximum amount of shares that can be minted
    /// @return The maximum amount of shares
    function maxMint(address) public view virtual override returns (uint256) {
        return previewDeposit(poolSize - assetUnderManagement);
    }

    /// @notice This function returns the maximum amount of assets that can be withdrawn
    /// @return The maximum amount of assets
    function maxWithdraw(address) public view virtual override returns (uint256) {
        return IERC20Upgradeable(asset()).balanceOf(address(this));
    }

    /// @notice This function returns the maximum amount of shares that can be redeemed
    /// @return The maximum amount of shares
    function maxRedeem(address) public view virtual override returns (uint256) {
        return _convertToShares(maxWithdraw(address(0)), MathUpgradeable.Rounding.Down);
    }

    /// @notice Deposits assets into the vault and mints shares to receiver
    /// @param assets The amount of underlying tokens to deposit
    /// @param receiver The address receiving the minted shares
    /// @return shares The amount of shares minted
    function deposit(uint256 assets, address receiver) public virtual override returns (uint256 shares) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        if(assets < minimumInvestmentLimit) revert InvalidDepositAmount(assets);
        shares = super.deposit(assets, receiver);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), fundManager, (assets * nonReservePercentage) / 10000);
    }

    /// @notice Mints exact shares to receiver by depositing required assets
    /// @param shares The amount of shares to mint
    /// @param receiver The address receiving the minted shares
    /// @return assets The amount of assets deposited to mint the shares
    function mint(uint256 shares, address receiver) public virtual override returns (uint256 assets) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        assets = super.mint(shares, receiver);
        if(assets < minimumInvestmentLimit) revert InvalidDepositAmount(assets);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), fundManager, (assets * nonReservePercentage) / 10000);
    }

    /// @notice Withdraws assets from the vault by burning shares
    /// @param assets The amount of underlying tokens to withdraw
    /// @param receiver The address receiving the withdrawn assets
    /// @param owner The address of the share owner
    /// @return The amount of shares burned
    function withdraw(uint256 assets, address receiver, address owner) public virtual override returns (uint256) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        return super.withdraw(assets, receiver, owner);
    }

    /// @notice Redeems shares for underlying assets
    /// @param shares The amount of shares to redeem
    /// @param receiver The address receiving the underlying assets
    /// @param owner The address of the share owner
    /// @return The amount of assets redeemed
    function redeem(uint256 shares, address receiver, address owner) public virtual override returns (uint256) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        return super.redeem(shares, receiver, owner);
    }

    /// @notice Updates the maximum size limit of the pool
    /// @dev Only the pool manager can call this function
    /// @param _poolSize The new maximum pool size
    function updatePoolSize(uint256 _poolSize) external onlyPoolManager {
        if(_poolSize < assetUnderManagement) revert InvalidPoolSize(_poolSize);
        poolSize = _poolSize;
    }

    /// @notice Updates the minimum investment limit
    /// @dev Only the pool manager can call this function
    /// @param _min The new minimum investment limit
    function updateMinimumInvestmentLimit(uint256 _min) external onlyPoolManager {
        emit MinimumInvestmentLimitUpdated(_msgSender(), minimumInvestmentLimit, _min);
        minimumInvestmentLimit = _min;
    }

    /// @notice Adds a lender to the whitelist
    /// @dev Only the pool manager can call this function
    /// @param _lenderId Lender ID from Diamond V1 KYB system
    /// @param _lenderAddr The address of the lender to whitelist
    function addWhitelistLender(string calldata _lenderId, address _lenderAddr) external onlyPoolManager {
        if( _lenderAddr == address(0) || 
            isLenderWhitelisted[_lenderAddr]) {
            revert InvalidAddress(_lenderAddr);
        }

        if (ICsigmaV1(IFactory(factory).diamondV1()).getLenderKYBStatus(_lenderId) != ICsigmaV1.KYBStatus.VERIFIED) {
            revert LenderNotVerified(_lenderId);
        }

        isLenderWhitelisted[_lenderAddr] = true;
        emit LenderAdded(_lenderId, _lenderAddr);
    }

    /// @notice Removes a lender from the whitelist
    /// @dev Only the pool manager can call this function
    /// @param _lenderAddr The address of the lender to remove from whitelist
    function removeWhitelistLender(address _lenderAddr) external onlyPoolManager {
        if(!isLenderWhitelisted[_lenderAddr]) {
            revert InvalidAddress(_lenderAddr);
        }
        isLenderWhitelisted[_lenderAddr] = false;
        emit LenderRemoved(_lenderAddr);
    }

    /// @notice Activates the pool, changing status from PENDING to ACTIVE
    /// @dev Only callable by factory. Pool must be in PENDING status
    function activatePool() external whenNotPaused whenNotInDefaultPauseWindow{
        if(status != PoolStatus.PENDING) revert InvalidStatusUpdate();
        if(_msgSender() != factory) revert AccessDenied(_msgSender());
        status = PoolStatus.ACTIVE;
        emit PoolStatusUpdated(_msgSender(), PoolStatus.PENDING, PoolStatus.ACTIVE);
    }

    /// @notice This function is used to update the status of the pool to close
    /// @dev Only the pool Manager can call this function
    function closePool() external onlyPoolManager {
        if(status == PoolStatus.CLOSE) revert InvalidStatusUpdate();
        if(totalAssets() != 0 && totalSupply() != 0)  revert WithdrawalPending();
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

    /// @notice Burns LP tokens from a compromissed address via a controlled Admin path.
    /// @dev The account must still be whitelisted. _burn passes through _beforeTokenTransfer, which reverts on a non-whitelisted _from.
    /// @dev Operational order: burn first, then removeWhitelistLender. De-whitelisting first makes the burn permanently impossible.
    /// @param _account The compromissed address whose LP tokens are being burned.
    /// @param _amount The amount of LP tokens to burn.
    function burnFromCompromissed(address _account, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) { 
        _burn(_account, _amount); 
        emit BurnFromCompromissedExecuted(address(this), _account, _amount);
    }

    /// @notice Updates the duration of the pause window
    /// @dev Only the pool manager can call this function
    /// @param _duration The new pause duration in seconds
    function updatePauseDuration(uint64 _duration) external onlyPoolManager {
        pauseDuration = _duration;
    }

    /// @notice Updates the start time of the pause window
    /// @dev Only the pool manager can call this function
    /// @param _time The new pause start time
    function updatePauseStartTime(uint64 _time) external onlyPoolManager {
        pauseStartTime = _time;
    }

    /// @notice This function is used to update the reserve percentage
    /// @dev Only the pool manager can call this function
    /// @param _percentage The new reserve percentage
    function updateNonReservePercentage(uint64 _percentage) external onlyPoolManager {
        nonReservePercentage = _percentage;
    }

    /// @notice This function is used to update the AUM update cooldown period
    /// @dev Only the pool manager can call this function
    /// @param _cooldownPeriod The new cooldown period
    function updateAUMUpdateCooldownPeriod(uint64 _cooldownPeriod) external onlyPoolManager {
        AUMUpdateCooldownPeriod = _cooldownPeriod;
    }

    /// @notice This function is used to update the withdrawal queue manager
    /// @dev Only the admin can call this function
    /// @param _withdrawalManager The address of the withdrawal queue manager
    function setWithdrawalManager(address _withdrawalManager) external {
        if(_msgSender() != factory) revert AccessDenied(_msgSender());
        require(withdrawalManager == address(0), "Withdrawal manager already set");
        withdrawalManager = _withdrawalManager;
    }

    /// @notice This function is used to update the AUM change threshold percentage
    /// @dev Only the pool manager can call this function
    /// @param _thresholdPercentage The new threshold percentage
    function updateAUMChangeThresholdPercentage(uint64 _thresholdPercentage) external onlyPoolManager {
        AUMChangeThresholdPercentage = 10000 + _thresholdPercentage;
    }

    /// @notice This function is used to check if the account is an oracle manager
    /// @param _account The address of the account
    function isOracleManager(address _account) public view returns (bool) {
        return hasRole(ROLE_ORACLE_MANAGER, _account);
    }

    /// @notice Pauses the contract
    /// @dev Pool manager or oracle manager can pause for ops/incidents
    function pause() external {
        require(
            _msgSender() == poolManager ||
            hasRole(ROLE_ORACLE_MANAGER, _msgSender()),
            "Access Denied"
        );
        _pause();
    }

    /// @notice Unpauses the contract
    /// @dev Pool manager or oracle manager can unpause
    function unpause() external {
        require(
            _msgSender() == poolManager ||
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
    function sendReserveToFundManager(uint256 _amount) external onlyPoolManager {
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset()), fundManager, _amount);
        emit SendReserveToFundManager(fundManager, _amount);
    }

    /// @notice Repays assets to lender and burns corresponding LP tokens
    /// @dev ERC-4626 correct: shares are derived via previewWithdraw
    /// @param lender Lender receiving assets
    /// @param shares Amount of shares to burn and replay equivallent asset
    /// @return assetsRepaid Amount of assets repayed
    function pmRepayAndBurn(
        address lender,
        uint256 shares
    ) external returns (uint256 assetsRepaid) {
        if (_msgSender() != fundManager) revert AccessDenied(_msgSender());
        if (shares == 0) revert ZeroAmount();
        if (!isLenderWhitelisted[lender]) revert AccessDenied(lender);

        uint256 balance = balanceOf(lender);
        if (shares > balance) {
            revert InsufficientLPTokens(lender, shares, balance);
        }

        assetsRepaid = convertToAssets(shares);
        if (assetsRepaid == 0) revert ZeroAmount();
        
        _burn(lender, shares);
        SafeERC20Upgradeable.safeTransfer(
            IERC20Upgradeable(asset()),
            lender,
            assetsRepaid
        );
        emit PMRepayAndBurn(lender, shares, assetsRepaid);
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

    /// @notice Rotates the operational pool manager
    /// @dev Only DEFAULT_ADMIN_ROLE can call. 
    /// @param _newPoolManager The address of the new pool manager
    function updatePoolManager(address _newPoolManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newPoolManager != address(0), "poolManager: zero address");
        if (!CsigmaPermissionedFactory(factory).isPoolManager(_newPoolManager)) {
            revert InvalidAddress(_newPoolManager);
        }
        emit PoolManagerUpdated(poolManager, _newPoolManager);
        poolManager = _newPoolManager;
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

    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 _amount
    )
        internal
        override
        whenNotPaused
        whenNotInDefaultPauseWindow
        isWhitelisted(_from)
        isWhitelisted(_to)
    {
        super._beforeTokenTransfer(_from, _to, _amount);
    }

    /// @notice Upgrades the contract to a new implementation
    /// @dev Only the admin can call this function
    /// @param _newImplementation The address of the new implementation
    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}

    /// @notice Internal function to check if current time is within the daily pause window
    /// @dev Reverts if within the pause window
    function _requireNotInDefaultPauseWindow() internal view {
        uint64 currentSecond = uint64(block.timestamp % 86400);
        require(
            currentSecond < pauseStartTime || 
            currentSecond > pauseStartTime + pauseDuration,
            "Pausable: paused"
        );
    }

    /// @notice Internal withdraw/redeem workflow override
    /// @dev Checks for pending withdrawals in withdrawal manager before allowing direct withdrawals
    /// @param caller The address initiating the withdrawal
    /// @param receiver The address receiving the assets
    /// @param owner The address owning the shares
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
}
