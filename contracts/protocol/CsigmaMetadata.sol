// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

error EmptyId(string _id);

/// @title CsigmaMetadata
/// @notice Stores configurable, protocol-owned metadata and human-readable name tags against a
/// Pool, Lender, or Pool Manager id, so white-labeled pool managers can carry attributes that
/// are not common across the wider cSigma pdn.
/// @dev The contract is agnostic to what an id represents (Pool, Lender, or Pool Manager) and to
/// the meaning of each generic Metadata field - the caller-supplied name tags define that meaning
/// per id.
contract CsigmaMetadata is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    /// @notice Generic metadata structure used to store configurable attributes for a Pool,
    /// Pool Manager, or Lender. The meaning of each field is defined per id through the
    /// corresponding name tags (see `updateNameTag`/`getNameTag`).
    struct Metadata {
        address metadata0;
        uint32  metadata1;
        uint32  metadata2;
        int32   metadata3;
        uint64  metadata4;
        uint64  metadata5;
        int64   metadata6;
        int64   metadata7;
        bytes32 metadata8;
        string  metadata9;
    }

    /// @notice Role identifier for accounts allowed to create/update metadata and name tags.
    bytes32 public constant ROLE_MANAGER = keccak256("ROLE_MANAGER");

    /// @notice Maps a unique entity id (Pool id, Lender id, or Pool Manager id) to its metadata.
    mapping (string => Metadata) private metadata;

    /// @notice Maps an entity id and metadata field index to that field's human-readable caption.
    mapping (string => mapping (uint8 => string)) private nameTagOf;

    /// @notice Emitted when metadata is created or updated for an id.
    /// @param _id The entity id.
    /// @param _metadata The metadata stored against the id.
    event MetadataUpdated(string indexed _id, Metadata _metadata);

    /// @notice Emitted when the name tag (caption) of a metadata field is created or updated.
    /// @param _id The entity id.
    /// @param _index The Metadata struct field index the caption applies to.
    /// @param _oldName The previous caption.
    /// @param _newName The new caption.
    event NameTagUpdated(string indexed _id, uint8 indexed _index, string _oldName, string _newName);

    /// @notice Emitted when the admin role is transferred.
    /// @param _oldOwner The address of the previous admin.
    /// @param _newOwner The address of the new admin.
    event AdminTransferred(address _oldOwner, address _newOwner);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract with the given admin and manager addresses.
    /// @param _admin The address to receive DEFAULT_ADMIN_ROLE.
    /// @param _manager The address to receive ROLE_MANAGER.
    function initialize(address _admin, address _manager) public initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ROLE_MANAGER, _manager);
    }

    /// @notice Creates or updates metadata for a given entity (Pool, Lender, or Pool Manager id).
    /// @param _id The entity id.
    /// @param _metadata The metadata to store.
    function updateMetadata(
        string calldata _id,
        Metadata calldata _metadata
    ) external onlyRole(ROLE_MANAGER) {
        if (bytes(_id).length == 0) revert EmptyId(_id);
        metadata[_id] = _metadata;
        emit MetadataUpdated(_id, _metadata);
    }

    /// @notice Creates or updates the display name (caption) of a metadata field for an entity.
    /// @param _id The entity id.
    /// @param _index The Metadata struct field index (0-9) the caption applies to.
    /// @param _name The caption to assign, e.g. "Reserve Wallet".
    function updateNameTag(
        string calldata _id,
        uint8 _index,
        string calldata _name
    ) external onlyRole(ROLE_MANAGER) {
        if (bytes(_id).length == 0) revert EmptyId(_id);
        emit NameTagUpdated(_id, _index, nameTagOf[_id][_index], _name);
        nameTagOf[_id][_index] = _name;
    }

    /// @notice Returns all metadata associated with the given entity id.
    /// @param _id The entity id.
    function getMetadata(string calldata _id) external view returns (Metadata memory) {
        return metadata[_id];
    }

    /// @notice Returns the display name (caption) of a specific metadata field for an entity id.
    /// @param _id The entity id.
    /// @param _index The Metadata struct field index.
    function getNameTag(string calldata _id, uint8 _index) external view returns (string memory) {
        return nameTagOf[_id][_index];
    }

    /// @notice Transfers DEFAULT_ADMIN_ROLE to a new address.
    /// @param _newOwner The address of the new admin.
    function transferAdmin(address _newOwner) public {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }

    /// @notice Grants a role to an account
    function grantRole(bytes32 role, address _account)
        public
        virtual
        override
        onlyRole(getRoleAdmin(role))
    {
        _grantRole(role, _account);
    }

    /// @notice Revokes a role from an account
    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))
    {
        _revokeRole(role, _account);
    }

    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}
