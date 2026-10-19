// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

/// @notice Migration contract to move capital from legacy ERC-4626 edge pools into new csUSD ERC-7575 vaults
/// @dev Supports voluntary per-user batch migration before sunset and an admin-run forced migration after sunset (owner migrates all users).

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/interfaces/IERC20Upgradeable.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract Migration is Initializable, AccessControlUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event VoluntaryMigrated(
        address indexed user,
        address indexed legacyVault,
        uint256 sharesRedeemed,
        uint256 assetsReceived,
        address newVault,
        bool depositedToNewVault
    );
    event ForcedMigrationExecuted(
        address indexed legacyVault,
        address indexed newVault,
        address indexed asset,
        uint256 totalLegacySupply,
        uint256 totalAssetsAvailable
    );
    event ForcedUserMigrated(
        address indexed user,
        address indexed legacyVault,
        uint256 legacyBalance,
        uint256 assetsSent
    );
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);

    // Global sunset timestamp for all legacy vaults
    uint256 public sunsetTimeStamp;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice This function is used to initialize the contract
    /// @param _admin The address of the admin
    /// @param _sunsetTimeStamp Global sunset timestamp for all legacy vaults
    function initialize(
        address _admin,
        uint256 _sunsetTimeStamp
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        sunsetTimeStamp = _sunsetTimeStamp;
    }

    /// @notice Role manager can update the global sunset timestamp
    function updateSunsetTime(uint256 _sunsetTimeStamp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        sunsetTimeStamp = _sunsetTimeStamp;
    }

    /// @notice Batch migrate LP tokens from multiple legacy vaults for the caller
    /// @dev Must be called before sunset. Redeems full balance of caller per vault.
    /// @param legacyVaults Array of legacy vault addresses (ERC-4626 vault contracts)
    /// @param depositToNewVault Array of bools: deposit into new csUSD vault (true) or return underlying (false)
    /// @param newVaults Array of corresponding new csUSD vaults (only used if depositToNewVault[i] == true)
    function migrateBatch(
        address[] calldata legacyVaults,
        bool[] calldata depositToNewVault,
        address[] calldata newVaults
    ) external nonReentrant {
        require(sunsetTimeStamp != 0 && block.timestamp < sunsetTimeStamp, "migration closed");

        uint256 len = legacyVaults.length;
        require(len == depositToNewVault.length && len == newVaults.length, "length mismatch");

        for (uint256 i = 0; i < len; ++i) {
            address legacy = legacyVaults[i];
            uint256 userBalance = IERC4626(legacy).balanceOf(msg.sender);
            uint256 maxRedeemable = IERC4626(legacy).maxRedeem(msg.sender);
            uint256 shares = userBalance > maxRedeemable ? maxRedeemable : userBalance;
            require(shares > 0, "no shares to migrate");

            // Transfer LP tokens from user -> this contract
            SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(legacy), msg.sender, address(this), shares);

            // Redeem underlying from legacy vault
            uint256 assetsReceived = IERC4626(legacy).redeem(shares, address(this), address(this));
            address asset = IERC4626(legacy).asset();

            if (depositToNewVault[i]) {
                require(newVaults[i] != address(0), "invalid new vault");
                require(IERC4626(newVaults[i]).asset() == asset, "asset mismatch");

                SafeERC20Upgradeable.forceApprove(IERC20Upgradeable(asset), newVaults[i], assetsReceived);

                IERC4626(newVaults[i]).deposit(assetsReceived, msg.sender);
                emit VoluntaryMigrated(msg.sender, legacy, shares, assetsReceived, newVaults[i], true);
            } else {
                SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(asset), msg.sender, assetsReceived);
                emit VoluntaryMigrated(msg.sender, legacy, shares, assetsReceived, address(0), false);
            }
        }
    }

    /// @notice Owner-only: after sunset, migrate all users from a legacy vault into the new csUSD vault
    /// @dev Owner must first call legacyVault.emergencyWithdraw(...) so this contract holds the underlying
    /// @param legacyVault The legacy ERC-4626 vault
    /// @param newVault The new csUSD vault
    /// @param users Array of user addresses to migrate
    /// @param finalize If true, disables further migration attempts for this vault
    function forceMigrate(
        address legacyVault,
        address newVault,
        address[] calldata users,
        bool finalize
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(sunsetTimeStamp != 0 && block.timestamp >= sunsetTimeStamp, "too early");
        require(legacyVault != address(0), "invalid legacy vault");
        require(newVault != address(0), "invalid new vault");

        uint256 supply = IERC4626(legacyVault).totalSupply();
        require(supply > 0, "legacy supply zero");

        address asset = IERC4626(legacyVault).asset();
        uint256 totalAssetsAvailable = IERC20Upgradeable(asset).balanceOf(address(this));
        require(totalAssetsAvailable > 0, "no assets available");
        require(IERC4626(newVault).asset() == asset, "asset mismatch");

        SafeERC20Upgradeable.forceApprove(IERC20Upgradeable(asset), newVault, totalAssetsAvailable);

        for (uint256 i = 0; i < users.length; ++i) {
            address u = users[i];
            uint256 userBalance = IERC4626(legacyVault).balanceOf(u);

            if (userBalance == 0) continue;

            uint256 amount = (userBalance * totalAssetsAvailable) / supply;
            if (amount == 0) continue;

            IERC4626(newVault).deposit(amount, u);

            emit ForcedUserMigrated(u, legacyVault, userBalance, amount);
        }

        if (finalize) {
            // Clear approvals as a safeguard
            SafeERC20Upgradeable.safeApprove(IERC20Upgradeable(asset), newVault, 0);
        }

        emit ForcedMigrationExecuted(legacyVault, newVault, asset, supply, totalAssetsAvailable);
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

    /// @dev UUPS upgrade authorization
    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}
