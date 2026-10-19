// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

error AssetsFrozen(address _account);

contract Sigma is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    ERC20PermitUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant BLACKLIST_MANAGER_ROLE = keccak256("BLACKLIST_MANAGER_ROLE");

    /// @notice Flag indicating whether protocol-controlled emergency burn is active
    bool public burnActive;

    /// @notice Mapping of blacklisted addresses
    mapping(address => bool) public isBlacklisted;
    
    event MinterAdded(address _account);
    event MinterRemoved(address _account);
    event UpgraderAdded(address _account);
    event UpgraderRemoved(address _account);
    event AdminTransferred(address _oldOwner, address _newOwner);
    event AddedBlackList(address indexed _account);
    event RemovedBlackList(address indexed _account);

    modifier notZeroAddress(address _account) {
        require(_account != address(0), "address cannot be zero");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _minter,
        address _upgrader
    )
        public
        initializer
        notZeroAddress(_minter)
        notZeroAddress(_upgrader)
    {
        __ERC20_init(_name, _symbol);
        __AccessControl_init();
        __ERC20Permit_init(_name);
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(MINTER_ROLE, _minter);
        _grantRole(UPGRADER_ROLE, _upgrader);
    }

    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
		return interfaceId == type(ERC165Upgradeable).interfaceId || interfaceId == type(IERC20Upgradeable).interfaceId;
	}

    function mint(address _to, uint256 _amount) external onlyRole(MINTER_ROLE) {
        require(_amount > 0, "amount must be greater than 0");
        _mint(_to, _amount);
    }

    /// @notice Burns tokens from a specified address
    /// @dev Only callable by addresses with DEFAULT_ADMIN_ROLE
    /// @param _from Address to burn tokens from
    /// @param _amount Amount of tokens to burn
    function burn(address _from, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_amount > 0, "amount must be greater than 0");
        burnActive = true;
        _burn(_from, _amount);
        burnActive = false;
    }

    function approve(address _spender, uint256 _value)
        public
        override
        whenNotPaused
        returns (bool)
    {
        return super.approve(_spender, _value);
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 _amount
    )
        internal
        override
        whenNotPaused
    {
        // Allow ONLY protocol-driven emergency burns
        if (!burnActive) {
            if (isBlacklisted[_from]) {
                revert AssetsFrozen(_from);
            }
            if (isBlacklisted[_to]) {
                revert AssetsFrozen(_to);
            }
        }

        super._beforeTokenTransfer(_from, _to, _amount);
    }

    function increaseAllowance(address _spender, uint256 _increment)
        public
        override
        whenNotPaused
        returns (bool)
    {
        return super.increaseAllowance(_spender, _increment);
    }

    function decreaseAllowance(address _spender, uint256 _decrement)
        public
        override
        whenNotPaused
        returns (bool)
    {
        return super.decreaseAllowance(_spender, _decrement);
    }

    function permit(
        address _owner,
        address _spender,
        uint256 _value,
        uint256 _deadline,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    )
        public
        override
        whenNotPaused
    {
        super.permit(_owner, _spender, _value, _deadline, _v, _r, _s);
    }

    function isMinter(address _account) public view returns (bool) {
        return hasRole(MINTER_ROLE, _account);
    }

    function isUpgrader(address _account) public view returns (bool) {
        return hasRole(UPGRADER_ROLE, _account);
    }

    function isBlacklistManager(address _account) public view returns (bool) {
        return hasRole(BLACKLIST_MANAGER_ROLE, _account);
    }

    function addBlackList(address _account) external onlyRole(BLACKLIST_MANAGER_ROLE) {
        isBlacklisted[_account] = true;
        emit AddedBlackList(_account);
    }

    function removeBlackList(address _account) external onlyRole(BLACKLIST_MANAGER_ROLE) {
        isBlacklisted[_account] = false;
        emit RemovedBlackList(_account);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function addMinter(address _account) public           
    {
        grantRole(MINTER_ROLE, _account);
        emit MinterAdded(_account);
    }

    function removeMinter(address _account) public {
        revokeRole(MINTER_ROLE, _account);
        emit MinterRemoved(_account);
    }

    function addUpgrader(address _account) public         
    {
        grantRole(UPGRADER_ROLE, _account);
        emit UpgraderAdded(_account);
    }

    function removeUpgrader(address _account) public        
    {
        revokeRole(UPGRADER_ROLE, _account);
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
        notZeroAddress(_account)
        whenNotPaused
    {
        _grantRole(role, _account);
    }

    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))        
        notZeroAddress(_account)        
        whenNotPaused
    {
        _revokeRole(role, _account);
    }

    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(UPGRADER_ROLE)
    {}
}