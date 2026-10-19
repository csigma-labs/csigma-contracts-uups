// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "./CsigmaV2Factory.sol";

error PoolIsNotActive();
error InvalidPoolSize(uint256 _poolSize);
error InvalidStatusUpdate();
error AccessDenied(address _executor);
error WithdrawalPending();
error InvalidDepositAmount(uint256 _assets);
error AssetsFrozen(address _account);

/// @title SanctionList
/// @notice This interface is used to check if the user is sanctioned
interface SanctionsList {
    function isSanctioned(address addr) external view returns (bool);
}

/// @title FundManager
/// @notice This interface is used to get the total assets managed by the fund manager
interface FundManager {
    function totalAssets() external view returns (uint256);
}

interface WithdrawManager {
    function totalDueLPToken() external view returns (uint256);
    function repay(uint256 _queuePosition, uint256 _amount) external;
}

/// @title CsigmaV2Pool
/// @notice This contract is used to manage the pool
contract CsigmaV2Pool is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ERC4626Upgradeable
{
    bytes32 public constant ROLE_ORACLE_MANAGER = keccak256("ROLE_ORACLE_MANAGER");
    address public factory;
    address public poolManager;
    address public fundManager;
    address public poolToken;
    PoolStatus public status;
    uint256 public projectedAPY;
    uint256 public poolSize;
    uint256 public assetUnderManagement;
    uint64 public initialDepositTime;
    uint64 public nonReservePercentage;
    uint64 public pauseDuration;
    uint64 public pauseStartTime;
    uint256 public minimumInvestmentLimit;
    uint64 public AUMLastUpdatedAt;
    uint64 public AUMChangeThresholdPercentage;
    uint64 public AUMUpdateCooldownPeriod;
    address public withdrawalManager;
    uint256 public initialPrice;

    enum PoolStatus {PENDING, ACTIVE, CLOSE}

    bool public burnFromBlacklistActive;
    mapping(address => bool) public isBlacklisted;
    
    event OracleManagerAdded(address _account);
    event OracleManagerRemoved(address _account);
    event AdminTransferred(address _oldOwner, address _newOwner);
    event PoolStatusUpdated(address indexed _by, PoolStatus _prevStatus, PoolStatus _newStatus);
    event AssetUnderManagementUpdated(address indexed _by, uint256 _prevValue, uint256 _newValue);
    event SuppliedAPYUpdated(address indexed _by, uint256 _prevValue, uint256 _newValue);
    event MinimumInvestmentLimitUpdated(address indexed _by, uint256 _prevValue, uint256 _newValue);
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);
    event SendReserveToFundManager(address _fundManager, uint256 _amount);
    event AddedBlackList(address indexed _account);
    event RemovedBlackList(address indexed _account);
    event BurnFromBlacklistExecuted(address indexed _token, address indexed _account, uint256 _amount);

    modifier whenNotSanctioned(address _user) {
        if(SanctionsList(CsigmaV2Factory(factory).chainalysis()).isSanctioned(_user)) {
            revert AccessDenied(_user);
        }
        _;
    }

    modifier whenNotBlacklisted(address _account) {
        if(isBlacklisted[_account]) {
            revert AssetsFrozen(_account);
        }
        _;
    }

    modifier whenNotInDefaultPauseWindow() {
        _requireNotInDefaultPauseWindow();
        _;
    }
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice This function is used to initialize the contract
    /// @param _poolName The name of the pool
    /// @param _poolSymbol The symbol of the pool
    /// @param _poolManager The address of the pool manager
    /// @param _fundManager The address of the fund manager
    /// @param _poolToken The address of the pool token
    /// @param _oracleManager The address of the oracle manager
    /// @param _projectedAPY The projected APY
    /// @param _poolSize The size of the pool
    function initialize(
        string calldata _poolName,
        string calldata _poolSymbol,
        address _poolManager,
        address _fundManager,
        address _poolToken,
        address _oracleManager,
        uint256 _projectedAPY,
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

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ROLE_ORACLE_MANAGER, _oracleManager);
        _grantRole(ROLE_ORACLE_MANAGER, _fundManager);
        factory = _msgSender();
        poolManager = _poolManager;
        fundManager = _fundManager;
        poolToken = _poolToken;
        projectedAPY = _projectedAPY;
        AUMChangeThresholdPercentage = 10080;
        AUMUpdateCooldownPeriod = 45 minutes;
        poolSize = _poolSize;
        nonReservePercentage = 9500;
        pauseDuration = 1800;
        initialPrice = 10 ** decimals();
    }

    /// @notice This function is used to get the total amount of the underlying asset that is “managed” by Vault
    /// @return The total assets
    function totalAssets() public view virtual override returns (uint256) {
        return (IERC20Upgradeable(poolToken).balanceOf(address(this)) + FundManager(fundManager).totalAssets() + assetUnderManagement);
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
    function deposit(uint256 assets, address receiver) public virtual override whenNotSanctioned(_msgSender()) whenNotBlacklisted(_msgSender()) returns (uint256 shares) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        if(assets < minimumInvestmentLimit) revert InvalidDepositAmount(assets);
        shares = super.deposit(assets, receiver);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(poolToken), fundManager, (assets * nonReservePercentage) / 10000);
    }

    /// @notice This function is used to mint the shares
    /// @param shares The amount of shares to mint
    /// @param receiver The address of the receiver
    /// @return assets The amount of assets used to mint the shares
    function mint(uint256 shares, address receiver) public virtual override whenNotSanctioned(_msgSender()) whenNotBlacklisted(_msgSender()) returns (uint256 assets) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        assets = super.mint(shares, receiver);
        if(assets < minimumInvestmentLimit) revert InvalidDepositAmount(assets);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(poolToken), fundManager, (assets * nonReservePercentage) / 10000);
    }

    /// @notice This function is used to withdraw the assets
    /// @param assets The amount of assets to withdraw
    /// @param receiver The address of the receiver
    /// @param owner The address of the owner of the assets
    /// @return The amount of shares burned
    function withdraw(uint256 assets, address receiver, address owner) public virtual override whenNotSanctioned(_msgSender()) whenNotBlacklisted(_msgSender()) returns (uint256) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        return super.withdraw(assets, receiver, owner);
    }

    /// @notice This function is used to redeem the shares
    /// @param shares The amount of shares to redeem
    /// @param receiver The address of the receiver
    /// @param owner The address of the owner of the shares
    /// @return The amount of assets redeemed
    function redeem(uint256 shares, address receiver, address owner) public virtual override whenNotSanctioned(_msgSender()) whenNotBlacklisted(_msgSender()) returns (uint256) {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        return super.redeem(shares, receiver, owner);
    }

    /// @notice This function is used to update the pool manager
    /// @dev Only the admin can call this function
    /// @param _poolManager The address of the new pool manager
    function updatePoolManager(address _poolManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        poolManager = _poolManager;
    }

    /// @notice This function is used to update the size limit of the pool
    /// @dev Only the admin can call this function
    /// @param _poolSize The new size limit of the pool
    function updatePoolSize(uint256 _poolSize) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if(_poolSize < assetUnderManagement) revert InvalidPoolSize(_poolSize);
        poolSize = _poolSize;
    }

    /// @notice This function is used to update the minimum investment limit
    /// @dev Only the admin or pool manager can call this function
    /// @param _min The new minimum investment limit
    function updateMinimumInvestmentLimit(uint256 _min) external {
        require(_msgSender() == poolManager || hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "Access Denied");
        emit MinimumInvestmentLimitUpdated(_msgSender(), minimumInvestmentLimit, _min);
        minimumInvestmentLimit = _min;
    }

    /// @notice This function is used to update the status of the pool from pending to active
    /// @dev Only the pool manager can call this function
    function activatePool() external whenNotPaused whenNotInDefaultPauseWindow{
        if(status != PoolStatus.PENDING) revert InvalidStatusUpdate();
        if(_msgSender() != poolManager) revert AccessDenied(_msgSender());
        status = PoolStatus.ACTIVE;
        emit PoolStatusUpdated(_msgSender(), PoolStatus.PENDING, PoolStatus.ACTIVE);
    }

    /// @notice This function is used to update the status of the pool to close
    /// @dev Only the admin can call this function
    function closePool() external onlyRole(DEFAULT_ADMIN_ROLE) {
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

    /// @notice This function is used to update the initial deposit time
    /// @dev Only the oracle manager can call this function
    /// @param _time The new initial deposit time
    function updateInitialDepositTime(uint64 _time) external onlyRole(ROLE_ORACLE_MANAGER) {
        initialDepositTime = _time;
    }

    /// @notice This function is used to update the initial price
    /// @dev Only the oracle manager can call this function
    /// @param _initialPrice The new initial price
    function updateInitialPrice(uint256 _initialPrice) external onlyRole(ROLE_ORACLE_MANAGER) {
        initialPrice = _initialPrice;
    }

    /// This function is used to update the pause duration
    /// @dev Only the admin can call this function
    /// @param _duration The new pause duration
    function updatePauseDuration(uint64 _duration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pauseDuration = _duration;
    }

    /// @notice This function is used to update the pause start time
    /// @dev Only the admin can call this function
    /// @param _time The new pause start time
    function updatePauseStartTime(uint64 _time) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pauseStartTime = _time;
    }

    /// @notice This function is used to update the reserve percentage
    /// @dev Only the admin or pool manager can call this function
    /// @param _percentage The new reserve percentage
    function updateNonReservePercentage(uint64 _percentage) external {
        require(_msgSender() == poolManager || hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "Access Denied");
        nonReservePercentage = _percentage;
    }

    /// @notice This function is used to update the AUM update cooldown period
    /// @dev Only the admin can call this function
    /// @param _cooldownPeriod The new cooldown period
    function updateAUMUpdateCooldownPeriod(uint64 _cooldownPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AUMUpdateCooldownPeriod = _cooldownPeriod;
    }

    /// @notice This function is used to update the withdrawal queue manager
    /// @dev Only the admin can call this function
    /// @param _withdrawalManager The address of the withdrawal queue manager
    function setWithdrawalManager(address _withdrawalManager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(withdrawalManager == address(0), "Withdrawal manager already set");
        withdrawalManager = _withdrawalManager;
    }

    /// @notice This function is used to update the AUM change threshold percentage
    /// @dev Only the admin can call this function
    /// @param _thresholdPercentage The new threshold percentage
    function updateAUMChangeThresholdPercentage(uint64 _thresholdPercentage) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AUMChangeThresholdPercentage = 10000 + _thresholdPercentage;
    }

    /// @notice This function is used to check if the account is an oracle manager
    /// @param _account The address of the account
    function isOracleManager(address _account) public view returns (bool) {
        return hasRole(ROLE_ORACLE_MANAGER, _account);
    }

    function suppliedAPY() public view returns (int256 APY) {
        int256 amount = int256(convertToAssets(10 ** decimals()));
        int256 durationInDays = int256((block.timestamp - initialDepositTime) / 1 days);
        APY = ((amount - int256(initialPrice)) * 1e4 * 360) / (int256(initialPrice) * durationInDays);
    }

    /// @notice Blacklists an address at the pool level.
    /// @param _account The address to be blacklisted.
    function addBlackList(address _account) external {
        if(_msgSender() != poolManager) revert AccessDenied(_msgSender());
        isBlacklisted[_account] = true;
        emit AddedBlackList(_account);
    }

    /// @notice Removes an address from the pool-level blacklist.
    /// @param _account The address to be removed from the blacklist.
    function removeBlackList(address _account) external {
        if(_msgSender() != poolManager) revert AccessDenied(_msgSender());
        isBlacklisted[_account] = false;
        emit RemovedBlackList(_account);
    }

    /// @notice Burns LP tokens from a blacklisted address via a controlled Admin path.
    /// @param _account The blacklisted address whose LP tokens are being burned.
    /// @param _amount The amount of LP tokens to burn.
    function burnFromBlacklist(address _account, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) { 
        require(isBlacklisted[_account], "ASSETS_NOT_FROZEN"); 
        burnFromBlacklistActive = true; 
        _burn(_account, _amount); 
        burnFromBlacklistActive = false; 
        emit BurnFromBlacklistExecuted(address(this), _account, _amount);
    } 

    /// @notice Pauses the contract 
    /// @dev Only the admin can call this function
    function pause() external {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, _msgSender()) || 
            hasRole(ROLE_ORACLE_MANAGER, _msgSender()), 
            "Access Denied"
        );
        _pause();
    }

    /// @notice Unpauses the contract
    /// @dev Only the admin can call this function
    function unpause() external {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, _msgSender()) || 
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
        whenNotSanctioned(_from)
        whenNotSanctioned(_to)
    {
        // Allow ONLY protocol-driven emergency burns 
        if (!burnFromBlacklistActive) { 
            if (isBlacklisted[_from]) {
                revert AssetsFrozen(_from);
            }
            if (isBlacklisted[_to])  {
                revert AssetsFrozen(_to);
            } 
        } 

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

    function _requireNotInDefaultPauseWindow() internal view {
        uint64 currentSecond = uint64(block.timestamp % 86400);
        require(
            currentSecond < pauseStartTime || 
            currentSecond > pauseStartTime + pauseDuration,
            "Pausable: paused"
        );
    }

    /**
     * @dev Withdraw/redeem common workflow.
     */
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
