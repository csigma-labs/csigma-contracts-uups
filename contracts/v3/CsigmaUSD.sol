// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/draft-ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";

error AccessDenied(address _executor);
error AssetsFrozen(address _account);

/// @title SanctionList
/// @notice This interface is used to check if the user is sanctioned
interface SanctionsList {
    function isSanctioned(address addr) external view returns (bool);
}

/// @title CsigmaUSD
/// @notice A yield bearing token contract with role-based access control, sanctions compliance, and pausability
/// @dev This contract implements an upgradeable ERC20 token with additional features:
//      - Role-based access control (Controller, Manager, Admin roles)
//      - Sanctions compliance through Chainalysis integration
//      - Pausability for emergency situations
//      - EIP-2612 permit functionality
//      - Vault management for underlying assets
/// @author cSigma Finance Inc.
contract CsigmaUSD is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    ERC20PermitUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    /// @notice Role that can mint and burn tokens
    bytes32 public constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    
    /// @notice Role that can manage administrative functions
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @notice Mapping of underlying asset addresses to their associated vault addresses
    mapping (address => address) public vault;
    
    /// @notice Address of the Chainalysis sanctions list contract
    address public chainalysis;

    /// @notice Role that can manage blacklisting functions
    bytes32 public constant BLACKLIST_MANAGER_ROLE = keccak256("BLACKLIST_MANAGER_ROLE");

    /// @notice Flag indicating whether protocol-controlled emergency burn is active
    bool public burnFromBlacklistActive;

    /// @notice Mapping of pool-level blacklisted addresses
    mapping(address => bool) public isBlacklisted;

    /// @notice Emitted when a new controller is added
    /// @param _account Address of the new controller
    event ControllerAdded(address _account);
    
    /// @notice Emitted when a controller is removed
    /// @param _account Address of the removed controller
    event ControllerRemoved(address _account);
    
    /// @notice Emitted when a new manager is added
    /// @param _account Address of the new manager
    event ManagerAdded(address _account);
    
    /// @notice Emitted when a manager is removed
    /// @param _account Address of the removed manager
    event ManagerRemoved(address _account);
    
    /// @notice Emitted when admin role is transferred
    /// @param _oldOwner Address of the previous admin
    /// @param _newOwner Address of the new admin
    event AdminTransferred(address _oldOwner, address _newOwner);
    
    /// @notice Emitted when a vault address is updated for an asset
    /// @param _asset Address of the underlying asset
    /// @param _vault Address of the associated vault
    event UpdateVault(address _asset, address _vault);

    /// @notice Emitted when an address is added to the share-token level blacklist
    /// @param _account The address that has been blacklisted
    event AddedBlackList(address indexed _account);

    /// @notice Emitted when an address is removed from the share-token level blacklist
    /// @param _account The address that has been unblacklisted
    event RemovedBlackList(address indexed _account);
    
    /// @notice Emitted when share tokens are burned from a blacklisted address
    /// @param _token The share token Address
    /// @param _account The blacklisted address whose share tokens were burned.
    /// @param _amount The amount of share tokens burned.
    event BurnFromBlacklistExecuted(address indexed _token, address indexed _account, uint256 _amount);

    /// @notice Ensures the provided address is not the zero address
    /// @param _account The address to validate
    modifier notZeroAddress(address _account) {
        require(_account != address(0), "address cannot be zero");
        _;
    }

    /// @notice Ensures the user is not on the sanctions list
    /// @param _user The address to check against the sanctions list
    modifier whenNotSanctioned(address _user) {
        if(SanctionsList(chainalysis).isSanctioned(_user)) {
            revert AccessDenied(_user);
        }
        _;
    }

    /// @notice Reverts if the given address is blacklisted
    /// @param _account The address to check against the blacklist
    modifier whenNotBlacklisted(address _account) {
        if(isBlacklisted[_account]) {
            revert AssetsFrozen(_account);
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract with the given parameters
    /// @dev This function replaces the constructor for upgradeable contracts
    /// @param _name Name of the token
    /// @param _symbol Symbol of the token
    /// @param _controller Address to be granted the CONTROLLER_ROLE
    /// @param _manager Address to be granted the MANAGER_ROLE
    /// @param _chainalysis Address of the Chainalysis sanctions list contract
    function initialize(
        string calldata _name,
        string calldata _symbol,
        address _controller,
        address _manager,
        address _chainalysis
    )
        public
        initializer
        notZeroAddress(_controller)
        notZeroAddress(_manager)
    {
        // Initializes underlying contracts
        __ERC20_init(_name, _symbol);
        __AccessControl_init();
        __ERC20Permit_init(_name);
        __UUPSUpgradeable_init();
        __Pausable_init();

        // Grants roles to given addresses
        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(CONTROLLER_ROLE, _controller);
        _grantRole(MANAGER_ROLE, _manager);

        // Records chainalysis address
        chainalysis = _chainalysis;
    }

    /// @notice Returns true if the contract supports a given interface
    /// @param interfaceId Interface identifier (ERC-165, ERC-7575, IERC20)
    /// @return bool True if the interface is supported
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
        interfaceId == 0xf815c03d ||
        interfaceId == type(ERC165Upgradeable).interfaceId ||
        interfaceId == type(IERC20Upgradeable).interfaceId;
	}

    /// @notice Mints new tokens to a specified address
    /// @dev Only callable by addresses with CONTROLLER_ROLE
    /// @param _to Address to mint tokens to
    /// @param _amount Amount of tokens to mint
    function mint(address _to, uint256 _amount) external whenNotPaused onlyRole(CONTROLLER_ROLE) {
        require(_amount > 0, "amount must be greater than 0");
        _mint(_to, _amount);
    }

    /// @notice Burns tokens from a specified address
    /// @dev Only callable by addresses with CONTROLLER_ROLE
    /// @param _from Address to burn tokens from
    /// @param _amount Amount of tokens to burn
    function burn(address _from, uint256 _amount) external whenNotPaused onlyRole(CONTROLLER_ROLE) {
        require(_amount > 0, "amount must be greater than 0");
        _burn(_from, _amount);
    }

    /// @notice Spends allowance on behalf of an owner
    /// @dev Only callable by addresses with CONTROLLER_ROLE when not paused
    /// @param owner Address of the token owner
    /// @param caller Address spending the allowance
    /// @param shares Amount of allowance to spend
    function spendAllowance(address owner, address caller, uint256 shares) external whenNotPaused onlyRole(CONTROLLER_ROLE) {
        _spendAllowance(owner, caller, shares);
    }

    /// @notice Sets approval for a spender on behalf of an owner
    /// @dev Only callable by addresses with CONTROLLER_ROLE when not paused
    /// @param owner Address of the token owner
    /// @param spender Address to approve
    /// @param amount Amount to approve
    /// @return bool True if successful
    function nativeApprove(address owner, address spender, uint256 amount) external whenNotPaused onlyRole(CONTROLLER_ROLE) returns(bool) {
        _approve(owner, spender, amount);
        return true;
    }

    /// @notice Transfers tokens on behalf of an owner
    /// @dev Only callable by addresses with CONTROLLER_ROLE
    /// @param owner Address of the token owner
    /// @param to Address to transfer tokens to
    /// @param amount Amount of tokens to transfer
    /// @return bool True if successful
    function nativeTransfer(address owner, address to, uint256 amount) external whenNotPaused onlyRole(CONTROLLER_ROLE) returns (bool) {
        _transfer(owner, to, amount);
        return true;
    }

    /// @notice Transfers tokens from one address to another using allowance
    /// @dev Only callable by addresses with CONTROLLER_ROLE
    /// @param spender Address spending the allowance
    /// @param from Address to transfer tokens from
    /// @param to Address to transfer tokens to
    /// @param amount Amount of tokens to transfer
    /// @return bool True if successful
    function nativeTransferFrom(address spender, address from, address to, uint256 amount) external whenNotPaused onlyRole(CONTROLLER_ROLE) returns (bool) {
        _spendAllowance(from, spender, amount);
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Approves a spender to use tokens on behalf of the caller
    /// @dev Overrides the standard approve function to include pause and sanctions checks
    /// @param _spender Address to approve
    /// @param _value Amount to approve
    /// @return bool True if successful
    function approve(address _spender, uint256 _value)
        public
        override
        whenNotSanctioned(_spender)
        returns (bool)
    {
        return super.approve(_spender, _value);
    }

    /// @notice Returns the number of decimals used by the token
    /// @dev Overrides the default 18 decimals to use 6 decimals
    /// @return uint8 The number of decimals (6)
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Hook that is called before any token transfer
    /// @dev Includes pause and sanctions checks for both sender and receiver
    /// @param _from Address tokens are being transferred from
    /// @param _to Address tokens are being transferred to
    /// @param _amount Amount of tokens being transferred
    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 _amount
    )
        internal
        override
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

    /// @notice Increases the allowance granted to a spender
    /// @dev Overrides the standard function to include pause and sanctions checks
    /// @param _spender Address to increase allowance for
    /// @param _increment Amount to increase allowance by
    /// @return bool True if successful
    function increaseAllowance(address _spender, uint256 _increment)
        public
        override
        whenNotSanctioned(_spender)
        returns (bool)
    {
        return super.increaseAllowance(_spender, _increment);
    }

    /// @notice Decreases the allowance granted to a spender
    /// @dev Overrides the standard function to include pause and sanctions checks
    /// @param _spender Address to decrease allowance for
    /// @param _decrement Amount to decrease allowance by
    /// @return bool True if successful
    function decreaseAllowance(address _spender, uint256 _decrement)
        public
        override
        whenNotSanctioned(_spender)
        returns (bool)
    {
        return super.decreaseAllowance(_spender, _decrement);
    }

    /// @notice Allows approval via signature (EIP-2612)
    /// @dev Overrides the standard permit function to include pause and sanctions checks
    /// @param _owner Address of the token owner
    /// @param _spender Address to approve
    /// @param _value Amount to approve
    /// @param _deadline Expiration time of the permit
    /// @param _v Recovery parameter of the signature
    /// @param _r First 32 bytes of the signature
    /// @param _s Second 32 bytes of the signature
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
        whenNotSanctioned(_spender)
    {
        super.permit(_owner, _spender, _value, _deadline, _v, _r, _s);
    }

    /// @notice Checks if an address has the CONTROLLER_ROLE
    /// @param _account Address to check
    /// @return bool True if the address has the CONTROLLER_ROLE
    function isController(address _account) public view returns (bool) {
        return hasRole(CONTROLLER_ROLE, _account);
    }

    /// @notice Checks if an address has the MANAGER_ROLE
    /// @param _account Address to check
    /// @return bool True if the address has the MANAGER_ROLE
    function isManager(address _account) public view returns (bool) {
        return hasRole(MANAGER_ROLE, _account);
    }

    /// @notice Checks if an address has the BLACKLIST_MANAGER_ROLE
    /// @param _account Address to check
    /// @return bool True if the address has the BLACKLIST_MANAGER_ROLE
    function isBlacklistManager(address _account) public view returns (bool) {
        return hasRole(BLACKLIST_MANAGER_ROLE, _account);
    }

    /// @notice Pauses all token operations
    /// @dev Only callable by addresses with MANAGER_ROLE
    function pause() external onlyRole(MANAGER_ROLE) {
        _pause();
    }

    /// @notice Unpauses all token operations
    /// @dev Only callable by addresses with MANAGER_ROLE
    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    /// @notice Updates the vault address associated with an underlying asset
    /// @param _asset Address of the underlying asset
    /// @param _vault Address of the associated vault
    function updateVault(address _asset, address _vault) public onlyRole(MANAGER_ROLE) {
        vault[_asset] = _vault;
        emit UpdateVault(_asset, _vault);
    }

    /// @notice Blacklists an address at the share level.
    /// @param _account The address to be blacklisted.
    function addBlackList(address _account) external onlyRole(BLACKLIST_MANAGER_ROLE) {
        isBlacklisted[_account] = true;
        emit AddedBlackList(_account);
    }

    /// @notice Removes an address from the share level blacklist.
    /// @param _account The address to be removed from the blacklist.
    function removeBlackList(address _account) external onlyRole(BLACKLIST_MANAGER_ROLE) {
        isBlacklisted[_account] = false;
        emit RemovedBlackList(_account);
    }

    /// @notice Burns Share tokens from a blacklisted address via a controlled Admin path.
    /// @param _account The blacklisted address whose share tokens are being burned.
    /// @param _amount The amount of share tokens to burn.
    function burnFromBlacklist(address _account, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) { 
        require(isBlacklisted[_account], "ASSETS_NOT_FROZEN"); 
        burnFromBlacklistActive = true; 
        _burn(_account, _amount);
        burnFromBlacklistActive = false; 
        emit BurnFromBlacklistExecuted(address(this), _account, _amount);
    }

    /// @notice Adds a new controller to the system
    /// @dev Grants CONTROLLER_ROLE to the specified account
    /// @param _account Address to grant controller role to
    function addController(address _account) public           
    {
        grantRole(CONTROLLER_ROLE, _account);
        emit ControllerAdded(_account);
    }

    /// @notice Removes a controller from the system
    /// @dev Revokes CONTROLLER_ROLE from the specified account
    /// @param _account Address to revoke controller role from
    function removeController(address _account) public {
        revokeRole(CONTROLLER_ROLE, _account);
        emit ControllerRemoved(_account);
    }

    /// @notice Adds a new manager to the system
    /// @dev Grants MANAGER_ROLE to the specified account
    /// @param _account Address to grant manager role to
    function addManager(address _account) public         
    {
        grantRole(MANAGER_ROLE, _account);
        emit ManagerAdded(_account);
    }

    /// @notice Removes a manager from the system
    /// @dev Revokes MANAGER_ROLE from the specified account
    /// @param _account Address to revoke manager role from
    function removeManager(address _account) public        
    {
        revokeRole(MANAGER_ROLE, _account);
        emit ManagerRemoved(_account);
    }

    /// @notice Transfers admin role to a new address
    /// @dev Grants DEFAULT_ADMIN_ROLE to new owner and revokes it from current admin
    /// @param _newOwner Address of the new admin
    function transferAdmin(address _newOwner) public
    {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }    

    /// @notice Grants a role to an account
    /// @dev Overrides the standard function to include additional checks
    /// @param role The role to grant
    /// @param _account Address to grant the role to
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

    /// @notice Revokes a role from an account
    /// @dev Overrides the standard function to include additional checks
    /// @param role The role to revoke
    /// @param _account Address to revoke the role from
    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))        
        notZeroAddress(_account)        
        whenNotPaused
    {
        _revokeRole(role, _account);
    }

    /// @notice Authorizes contract upgrades
    /// @dev Only callable by addresses with DEFAULT_ADMIN_ROLE (admin)
    /// @param _newImplementation Address of the new implementation contract
    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}