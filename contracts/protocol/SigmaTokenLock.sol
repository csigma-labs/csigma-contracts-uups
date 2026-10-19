// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

error TooEarly(uint32 requestTime, uint32 unlockTime);
error TokenAlreadyLockedForGivenAddress(address user);
error NoTokenLockedForGivenAddress(address user);

contract SigmaTokenLock is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    struct Lock {
        uint256 amount;
        uint32 startTime;
        uint32 lockingDurationInSeconds;
    }

    address public sigma;
    mapping (address => Lock) public lockInfo;
    bytes32 public constant ROLE_WITHDRAW_MANAGER = keccak256("ROLE_WITHDRAW_MANAGER");
    bytes32 public constant ROLE_UPGRADE_MANAGER = keccak256("ROLE_UPGRADE_MANAGER");

    event TokenLocked(
        address indexed _user,
        uint32 _startTime,
        uint32 _lockingDurationInSeconds,
        uint256 _amount
    );
    event TokenUnlocked(
        address indexed _user,
        uint32 _startTime,
        uint32 _lockingDurationInSeconds,
        uint256 _amount
    );
    event TokenLockedUpdated(
        address indexed _user,
        uint32 _startTime,
        uint32 _lockingDurationInSeconds,
        uint256 _amount
    );
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);
    event WithdrawManagerAdded(address _account);
    event WithdrawManagerRemoved(address _account);
    event UpgraderAdded(address _account);
    event UpgraderRemoved(address _account);
    event AdminTransferred(address _oldOwner, address _newOwner);
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _sigma,
        address _withdrawManager,
        address _upgradeManager
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ROLE_WITHDRAW_MANAGER, _withdrawManager);
        _grantRole(ROLE_UPGRADE_MANAGER, _upgradeManager);

        sigma = _sigma;
    }

    function isWithdrawManager(address _account) public view returns (bool) {
        return hasRole(ROLE_WITHDRAW_MANAGER, _account);
    }

    function isUpgradeManager(address _account) public view returns (bool) {
        return hasRole(ROLE_UPGRADE_MANAGER, _account);
    }

    function lockToken(uint256 _amount, uint32 _durationInSeconds) external whenNotPaused {
        Lock memory _lockInfo = lockInfo[msg.sender];
        if(_lockInfo.amount != 0) {
            revert TokenAlreadyLockedForGivenAddress(msg.sender);
        }
        IERC20Upgradeable(sigma).transferFrom(msg.sender, address(this), _amount);
        lockInfo[msg.sender] = Lock(_amount, uint32(block.timestamp), _durationInSeconds);
        emit TokenLocked(msg.sender, uint32(block.timestamp), _durationInSeconds, _amount);
    }

    function unlockToken() external whenNotPaused {
        Lock memory _lockInfo = lockInfo[msg.sender];
        if(_lockInfo.amount == 0) {
            revert NoTokenLockedForGivenAddress(msg.sender);
        }
        if(block.timestamp < _lockInfo.startTime + _lockInfo.lockingDurationInSeconds) {
            revert TooEarly(uint32(block.timestamp), _lockInfo.startTime + _lockInfo.lockingDurationInSeconds);
        }
        delete lockInfo[msg.sender];
        IERC20Upgradeable(sigma).transfer(msg.sender, _lockInfo.amount);
        emit TokenUnlocked(msg.sender, uint32(block.timestamp), _lockInfo.lockingDurationInSeconds, _lockInfo.amount);
    }

    function increaseLockingAmount(uint256 _amount) external whenNotPaused {
        Lock memory _lockInfo = lockInfo[msg.sender];
        if(_lockInfo.amount == 0) {
            revert NoTokenLockedForGivenAddress(msg.sender);
        }
        IERC20Upgradeable(sigma).transferFrom(msg.sender, address(this), _amount);
        lockInfo[msg.sender].amount += _amount;
        emit TokenLockedUpdated(msg.sender, _lockInfo.startTime, _lockInfo.lockingDurationInSeconds, _amount);
    }

    function increaseLockingDuration(uint32 _durationInSeconds) external whenNotPaused {
        Lock memory _lockInfo = lockInfo[msg.sender];
        if(_lockInfo.amount == 0) {
            revert NoTokenLockedForGivenAddress(msg.sender);
        }
        lockInfo[msg.sender].lockingDurationInSeconds += _durationInSeconds;
        emit TokenLockedUpdated(msg.sender, _lockInfo.startTime, _durationInSeconds, _lockInfo.amount);
    }

    function emergencyWithdraw(address _token, address _to, uint256 _amount) external whenNotPaused onlyRole(ROLE_WITHDRAW_MANAGER) {
        IERC20Upgradeable(_token).transfer(_to, _amount);
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function addWithdrawManager(address _account) public           
    {
        grantRole(ROLE_WITHDRAW_MANAGER, _account);
        emit WithdrawManagerAdded(_account);
    }

    function removeWithdrawManager(address _account) public {
        revokeRole(ROLE_WITHDRAW_MANAGER, _account);
        emit WithdrawManagerRemoved(_account);
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