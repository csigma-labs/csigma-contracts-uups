// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "./CsigmaV2Pool.sol";

error InvalidInputs(uint256 _amount, uint32 _lockingPeriodInSeconds);
error AlreadyStaked(address _staker);
error NotStaked(address _staker);
error NotUnlocked(address _staker);
error AlreadyClaimed(address _staker, uint256 _index);

/// @title CsigmaV2StakingPoolExtension
/// @notice This contract is used to stake assets in the pool and earn rewards
///
/// @dev This contract is intended to be deployed behind its OWN proxy. It is NOT an
///      upgrade of `CsigmaV2StakingPool`, despite the similar name and overlapping API.
///
///      The two contracts have INCOMPATIBLE storage layouts:
///        - `CsigmaV2StakingPool`:          `mapping(address => StakeInfo)  public stakes;`  (scalar)
///        - `CsigmaV2StakingPoolExtension`: `mapping(address => StakeInfo[]) public stakes;` (dynamic array)
///      and the `StakeInfo` struct itself differs (Extension adds a trailing `bool isClaimed`).
///
///      Pointing a deployed `CsigmaV2StakingPool` proxy at this implementation via
///      `upgradeToAndCall` will silently re-interpret every `stakes[user]` slot as the
///      length of a dynamic array (currently holding `amount`, a large number), causing
///      reads and writes to land on arbitrary storage slots. The result is irrecoverable
///      corruption of all staker balances.
///
///      Deployers MUST create a fresh proxy for this contract — never reuse a
///      `CsigmaV2StakingPool` proxy address.
contract CsigmaV2StakingPoolExtension is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    address public factory;
    address public stakingToken;
    address public rewardToken;
    uint32 public slice;
    uint32 public maxStakeDurationAllowed;
    uint32 public minStakeDurationAllowed;
    PoolStatus public status;
    uint256 public rewardRate;
    uint256 public totalRewards;
    mapping(address => StakeInfo[]) public stakes;
    mapping(uint256 => uint256) public payableRewards;

    /// @notice This struct is used to store the stake information
    /// @param amount The amount of staking token staked
    /// @param rewards The rewards earned by the staker
    /// @param unlockTime The time when the staker can unstake the assets
    struct StakeInfo {
        uint256 amount;
        uint256 rewards;
        uint32 unlockTime;
        bool isClaimed;        
    }
    
    enum PoolStatus {PENDING, ACTIVE, CLOSE}

    event AdminTransferred(address _oldOwner, address _newOwner);
    event RewardRateUpdated(uint256 _prevRate, uint256 _newRate);
    event SlicePeriodUpdated(uint32 _prevValue, uint256 _newValue);
    event PoolStatusUpdated(PoolStatus _prevStatus, PoolStatus _newStatus);
    event Staked(address indexed _staker, uint256 _amount, uint256 _assetAmount, uint256 _rewardAmount, uint32 _lockingPeriodInSeconds);
    event Unstaked(address indexed _staker, uint256 _amount, uint256 _rewardAmount);
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);
    event MinMaxStakeDurationUpdated(uint32 _min, uint32 _max, uint32 _newMin, uint32 _newMax);

    modifier notZeroAddress(address _account) {
        require(_account != address(0), "address cannot be zero");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice This function is used to initialize the contract
    /// @param _admin The address of the admin
    /// @param _stakingToken The address of the staking token
    /// @param _rewardToken The address of the reward token
    function initialize(
        address _admin,
        address _stakingToken,
        address _rewardToken
    )
        public
        initializer
        notZeroAddress(_rewardToken)
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        factory = _msgSender();
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
        slice = 30 days;
        minStakeDurationAllowed = 60 days;
        maxStakeDurationAllowed = 365 days;
    }

    function unlockDay(uint32 _unlockTime) public pure returns(uint32) {
        return (_unlockTime / 86400);
    }

    function numberOfStakes(address _staker) external view returns(uint256) {
        return stakes[_staker].length;
    }

    function allStakes(address _staker) external view returns(StakeInfo[] memory) {
        return stakes[_staker];
    }

    /// @notice This function is used to update the reward rate
    /// @dev Only admin can call this function
    /// @param _rate The new reward rate
    function updateRewardRate(uint256 _rate) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit RewardRateUpdated(rewardRate, _rate);
        rewardRate = _rate;
    }

    /// @notice This function is used to update the slice period
    /// @dev Only admin can call this function
    /// @param _slice The new slice period
    function updateSlicePeriod(uint32 _slice) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit SlicePeriodUpdated(slice, _slice);
        slice = _slice;
    }

    /// @notice This function is used to update the reward rate and slice period
    /// @dev Only admin can call this function
    /// @param _rate The new reward rate
    /// @param _slice The new slice period
    function updateRewardInfo(uint256 _rate, uint32 _slice) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit RewardRateUpdated(rewardRate, _rate);
        rewardRate = _rate;
        emit SlicePeriodUpdated(slice, _slice);
        slice = _slice;
    }

    /// @notice This function is used to update the pool status
    /// @dev Only admin can call this function
    /// @param _status The new pool status
    function updatePoolStatus(PoolStatus _status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit PoolStatusUpdated(status, _status);
        status = _status;
    }

    /// @notice This function is used to update the min and max stake duration allowed
    /// @dev Only admin can call this function
    /// @param _min The new min stake duration allowed
    /// @param _max The new max stake duration allowed
    function updateMinMaxDurationAllowed(uint32 _min, uint32 _max) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit MinMaxStakeDurationUpdated(minStakeDurationAllowed, maxStakeDurationAllowed, _min, _max);
        minStakeDurationAllowed = _min;
        maxStakeDurationAllowed = _max;
    }

    function deposit(uint256 _amount, uint32 _lockingPeriodInSeconds) external {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        if((_lockingPeriodInSeconds % slice != 0) || (_lockingPeriodInSeconds < minStakeDurationAllowed) || (_lockingPeriodInSeconds > maxStakeDurationAllowed)) {
            revert InvalidInputs(_amount, _lockingPeriodInSeconds);
        }
        IERC20Upgradeable asset = IERC20Upgradeable(CsigmaV2Pool(stakingToken).asset());
        SafeERC20Upgradeable.safeTransferFrom(asset, _msgSender(), address(this), _amount);
        SafeERC20Upgradeable.forceApprove(asset, stakingToken, _amount);
        uint256 _shares = CsigmaV2Pool(stakingToken).deposit(_amount, address(this));
        if(_shares == 0) revert InvalidInputs(_shares, _lockingPeriodInSeconds);
        uint32 _unlockTime = uint32(block.timestamp) + _lockingPeriodInSeconds;
        uint256 _reward = (_amount * rewardRate) / (10**IERC20MetadataUpgradeable(CsigmaV2Pool(stakingToken).asset()).decimals());
        uint256 _rewardAmount = (_reward * _lockingPeriodInSeconds) / slice;
        stakes[_msgSender()].push(StakeInfo(_shares, _rewardAmount, _unlockTime, false));
        totalRewards += _rewardAmount;
        payableRewards[unlockDay(_unlockTime)] += _rewardAmount;
        emit Staked(_msgSender(), _shares, _amount, _rewardAmount, _lockingPeriodInSeconds);
    }
    
    /// @notice This function is used to stake the assets in the pool
    /// @param _amount The amount of staking token to stake
    /// @param _lockingPeriodInSeconds The locking period in seconds
    function stake(uint256 _amount, uint32 _lockingPeriodInSeconds) external {
        if(_amount == 0 || (_lockingPeriodInSeconds % slice != 0) || (_lockingPeriodInSeconds < minStakeDurationAllowed) || (_lockingPeriodInSeconds > maxStakeDurationAllowed)) {
            revert InvalidInputs(_amount, _lockingPeriodInSeconds);
        }
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(stakingToken), _msgSender(), address(this), _amount);
        uint32 _unlockTime = uint32(block.timestamp) + _lockingPeriodInSeconds;
        uint256 _asset = CsigmaV2Pool(stakingToken).convertToAssets(_amount);
        uint256 _reward = (_asset * rewardRate) / (10**IERC20MetadataUpgradeable(CsigmaV2Pool(stakingToken).asset()).decimals());
        uint256 _rewardAmount = (_reward * _lockingPeriodInSeconds) / slice;
        stakes[_msgSender()].push(StakeInfo(_amount, _rewardAmount, _unlockTime, false));
        totalRewards += _rewardAmount;
        payableRewards[unlockDay(_unlockTime)] += _rewardAmount;
        emit Staked(_msgSender(), _amount, _asset, _rewardAmount, _lockingPeriodInSeconds);
    }

    function withdrawBatch(uint256[] calldata _index) external {
        for(uint i; i < _index.length; i++) {
            withdraw(_index[i]);
        }
    }
    
    function withdraw(uint256 _index) public {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        StakeInfo memory _stake = stakes[_msgSender()][_index];
        if(_stake.isClaimed) revert AlreadyClaimed(_msgSender(), _index);
        if(block.timestamp < _stake.unlockTime) revert NotUnlocked(_msgSender());
        stakes[_msgSender()][_index].isClaimed = true;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(rewardToken), _msgSender(), _stake.rewards);
        emit Unstaked(_msgSender(), _stake.amount, _stake.rewards);
        CsigmaV2Pool(stakingToken).redeem(_stake.amount, _msgSender(), address(this));
    }
    
    /// @notice This function is used to unstake the enitre staked position from the pool and claim the rewards
    /// @dev Users can unstake only when the assets are unlocked
    function unStake(uint256 _index) external {
        if(status != PoolStatus.ACTIVE) revert PoolIsNotActive();
        StakeInfo memory _stake = stakes[_msgSender()][_index];
        if(_stake.isClaimed) revert AlreadyClaimed(_msgSender(), _index);
        if(block.timestamp < _stake.unlockTime) revert NotUnlocked(_msgSender());
        stakes[_msgSender()][_index].isClaimed = true;
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(stakingToken), _msgSender(), _stake.amount);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(rewardToken), _msgSender(), _stake.rewards);
        emit Unstaked(_msgSender(), _stake.amount, _stake.rewards);
    }

    /// @notice This function is used to withdraw the assets from the pool in case of emergency
    /// @dev Only admin can call this function
    /// @param _token The address of the token to withdraw
    /// @param _to The address to which the assets should be transferred
    /// @param _amount The amount of assets to withdraw
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_token), _to, _amount);
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    /// @notice This function is used to transfer the admin role to the new address
    /// @param _newOwner The address of the new admin
    function transferAdmin(address _newOwner) public {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }

    /// @notice This function is used to grant a role to the account
    /// @param role The role to grant
    /// @param _account The address to which the role should be granted
    function grantRole(bytes32 role, address _account)
        public
        virtual
        override
        onlyRole(getRoleAdmin(role))
        notZeroAddress(_account)
    {
        _grantRole(role, _account);
    }

    /// @notice This function is used to revoke a role from the account
    /// @param role The role to revoke
    /// @param _account The address from which the role should be revoked
    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))        
        notZeroAddress(_account)
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
}