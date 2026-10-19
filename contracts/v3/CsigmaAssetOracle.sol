// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import "../interfaces/IPoolV3.sol";

/// @title CsigmaAssetOracle
/// @author cSigma Finance Inc.
/// @notice Oracle contract for managing asset pricing and conversion for the cSigma USD
/// @dev Upgradeable contract that provides price feeds for supported assets using Chainlink oracles
//      and handles conversions between assets and share tokens (csUSD)
contract CsigmaAssetOracle is Initializable, AccessControlUpgradeable, UUPSUpgradeable {

    /// @notice Structure containing information about a supported asset
    struct AssetInfo {
        bool allowed;
        address priceFeed;               // Primary oracle address
        address pool;                    // Pool address where asset is used as underlying token       
        uint8 tokenDecimals;             // Asset token decimals (e.g., 6 for USDC, 18 for DAI)
        uint8 priceFeedDecimals;         // Primary oracle decimals (e.g., 8 for many Chainlink feeds)
        uint256 lowerBound;              // e.g., 0.99e18 for 1% below peg
        uint256 upperBound;              // e.g., 1.01e18 for 1% above peg
        uint256 validityPeriod;          // Validity period in seconds
    }

    /// @notice Role identifier for users who can manage roles and assets
    bytes32 public constant ROLE_MANAGER = keccak256("ROLE_MANAGER");
    
    /// @notice Address of the share token (csUSD)
    address public shareToken;
    
    /// @notice Standard decimals used for price normalization (18 decimals)
    uint256 public constant DECIMALS = 1e18;
    
    /// @notice Supported asset list and lookup
    address[] public supportedAssets;
    
    /// @notice Mapping from asset address to its configuration information
    mapping(address => AssetInfo) public assetInfo;

    /// @notice Emitted when a new asset is added to the protocol
    /// @param pool Address of the pool associated with the asset
    /// @param token Address of the asset token
    /// @param priceFeed Address of the Chainlink price feed
    /// @param tokenDecimals Number of decimals for the token
    /// @param priceFeedDecimals Number of decimals for the price feed
    /// @param lowerBound Minimum acceptable price
    /// @param upperBound Maximum acceptable price
    /// @param validityPeriod Maximum age of price data in seconds
    event AssetAdded(
        address pool,
        address indexed token,
        address priceFeed,
        uint8 tokenDecimals,
        uint8 priceFeedDecimals,
        uint256 lowerBound,
        uint256 upperBound,
        uint256 validityPeriod
    );

    /// @notice Emitted when an asset is removed from the protocol
    /// @param token Address of the removed asset token
    event AssetRemoved(address indexed token);
    
    /// @notice Emitted when a new role manager is added
    /// @param _account Address of the added role manager
    event RoleManagerAdded(address _account);
    
    /// @notice Emitted when a role manager is removed
    /// @param _account Address of the removed role manager
    event RoleManagerRemoved(address _account);
    
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract
    /// @param _admin The address of the admin
    /// @param _roleManager The address of the role manager
    /// @param _shareToken The address of the csUSD token
    function initialize(
        address _admin,
        address _roleManager,
        address _shareToken
    ) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ROLE_MANAGER, _roleManager);
        shareToken = _shareToken;
    }

    /// @notice Adds a new supported token and its Chainlink USD price feed
    /// @param _token The asset token address.
    /// @param _priceFeed The primary oracle address.
    /// @param _validityPeriod The validity period for the oracle price (in seconds).
    function addSupportedAsset(address _pool, address _token, address _priceFeed, uint256 _validityPeriod, uint256 _lowerBound, uint256 _upperBound) external onlyRole(ROLE_MANAGER) {
        require(_pool != address(0) && _token != address(0) && _priceFeed != address(0), "invalid input");
        _addAsset(_pool, _token, _priceFeed, _validityPeriod, _lowerBound, _upperBound);
    }

    /// @notice Disable asset for minting
    /// @param _token The asset token address to remove.
    function removeAsset(address _token) external onlyRole(ROLE_MANAGER) {
        AssetInfo storage info = assetInfo[_token];
        require(info.allowed, "unsupported asset");
        info.allowed = false;
        emit AssetRemoved(_token);
    }

    /// @notice Updates the acceptable price range for an asset
    /// @dev Only callable by addresses with ROLE_MANAGER role
    /// @param _token Address of the asset token to update
    /// @param _lowerBound New minimum acceptable price (18 decimals)
    /// @param _upperBound New maximum acceptable price (18 decimals)
    function updateAssetPriceRange(address _token, uint256 _lowerBound, uint256 _upperBound) external onlyRole(ROLE_MANAGER) {
        require(assetInfo[_token].allowed, "unsupported asset");
        assetInfo[_token].lowerBound = _lowerBound;
        assetInfo[_token].upperBound = _upperBound;
    }

    /// @notice Adds an role manager
    /// @dev Only the admin can call this function
    /// @param _account The address of the role manager
    function addRoleManager(address _account) public onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(ROLE_MANAGER, _account);
        emit RoleManagerAdded(_account);
    }

    /// @notice Removes an role manager
    /// @dev Only the admin can call this function
    /// @param _account The address of the role manager
    function removeRoleManager(address _account) public onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(ROLE_MANAGER, _account);
        emit RoleManagerRemoved(_account);
    }

    /// @notice Retrieves the latest USD price of a supported token
    /// @dev Normalizes price to 18 decimals and validates against bounds and staleness
    /// @param _token Address of the token to get price for
    /// @param strict Whether to enforce price bounds (true) or allow any price (false)
    /// @return normalizedPrice Latest price normalized to 18 decimals
    function getPrice(address _token, bool strict) public view returns (uint256) {
        AssetInfo memory info = assetInfo[_token];
        // fetch latest round data from the oracle
        (,int256 answer,,uint256 updatedAt,) = AggregatorV3Interface(info.priceFeed).latestRoundData();

        // reject non-positive answers before the unsigned cast, which would otherwise wrap
        require(answer > 0, "invalid oracle price");

        // scale the value to 18 decimals
        uint256 normalizedPrice = uint256(answer) * (10 ** (18 - info.priceFeedDecimals));
        // enforce the upper and the lower bounds
        require(!strict || (normalizedPrice >= info.lowerBound && normalizedPrice <= info.upperBound), "price out-of-range");
        
        // check if the price is updated within the validity period
        require(info.validityPeriod == 0 || updatedAt >= (block.timestamp - info.validityPeriod), "stale oracle price");
        
        return normalizedPrice;

    }

    /// @notice Calculates the total USD value of all assets in the protocol
    /// @dev Sums up the USD value of all assets held in their respective pools
    /// @return totalValue Total USD value of all assets (18 decimals)
    function totalAssetsUSD() public view returns (uint256 totalValue) {
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            address token = supportedAssets[i];
            AssetInfo memory info = assetInfo[token];

            // Skip if no pool is assigned
            if (info.pool == address(0)) continue;

            uint256 amount = IPoolV3(info.pool).totalAssets();
            uint256 adjusted = amount * (10 ** (18 - info.tokenDecimals));
            uint256 value = (adjusted * getPrice(token, false)) / DECIMALS;
            totalValue += value;
        }
    }

    /// @notice Checks if a token is supported by the protocol
    /// @param token Address of the token to check
    /// @return True if the token is supported and allowed, false otherwise
    function isSupported(address token) public view returns (bool) {
        return assetInfo[token].allowed;
    }

    /// @notice Computes the current exchange rate of share tokens
    /// @dev Calculates totalAssetsUSD / totalSupply to determine share token value
    /// @return Exchange rate as totalAssetsUSD per share token (18 decimals)
    function exchangeRate() external view returns (uint256) {
        uint256 supply = IERC20Metadata(shareToken).totalSupply();
        if (supply == 0) return DECIMALS;
        uint256 normalizedSupply = supply * 1e12; // convert 6 decimals to 18
        return (totalAssetsUSD() * DECIMALS) / normalizedSupply;
    }

    /// @notice Estimates how many share tokens (e.g., csUSD) a user would receive for depositing `assets` of `token`
    /// @param token The address of the asset token being deposited (e.g., USDC, USDT)
    /// @param assets The amount of token being deposited (in token's native decimals)
    /// @return shares The amount of share tokens that would be minted (in share token decimals)
    function convertToShares(address token, uint256 assets) external view returns (uint256) {
        return _convertToShares(token, assets, MathUpgradeable.Rounding.Down);
    }

    /// @notice Estimates the amount of `token` a user would receive by burning `shares` of the share token
    /// @dev Rounds DOWN — backward-compatible default. Use the 3-arg overload to choose direction.
    /// @param token The address of the underlying asset token (e.g., USDC, USDT)
    /// @param shares The amount of share tokens to redeem (in share token decimals)
    /// @return assets The estimated amount of `token` that will be returned (in token's native decimals)
    function convertToAssets(address token, uint256 shares) external view returns (uint256) {
        return _convertToAssets(token, shares, MathUpgradeable.Rounding.Down);
    }

    /// @notice convertToShares with explicit rounding direction (EIP-4626 preview helpers)
    /// @dev Use Rounding.Down for previewDeposit, Rounding.Up for previewWithdraw.
    function convertToShares(address token, uint256 assets, MathUpgradeable.Rounding rounding) external view returns (uint256) {
        return _convertToShares(token, assets, rounding);
    }

    /// @notice convertToAssets with explicit rounding direction (EIP-4626 preview helpers)
    /// @dev Use Rounding.Down for previewRedeem, Rounding.Up for previewMint.
    function convertToAssets(address token, uint256 shares, MathUpgradeable.Rounding rounding) external view returns (uint256) {
        return _convertToAssets(token, shares, rounding);
    }

    /// @dev Internal shares conversion. Uses mulDiv with the requested rounding at every per-call division.
    ///      totalAssetsUSD() is intentionally NOT parameterised on rounding — it stays at its Down default,
    ///      because its position flips between numerator and denominator across the two flows and its dust
    ///      contribution (≤ 1 wei per supported asset) is negligible compared to the per-call dust.
    function _convertToShares(address token, uint256 assets, MathUpgradeable.Rounding rounding) internal view returns (uint256) {
        AssetInfo memory info = assetInfo[token];
        require(info.allowed && info.pool != address(0), "Unsupported token");

        uint256 adjusted = assets * (10 ** (18 - info.tokenDecimals));
        uint256 usdValue = MathUpgradeable.mulDiv(adjusted, getPrice(token, true), DECIMALS, rounding);

        uint256 totalUSD = totalAssetsUSD(); // in 1e18
        uint256 supply = IERC20Metadata(shareToken).totalSupply();

        if (supply == 0 || totalUSD == 0) {
            // Initial deposit case (1:1 mapping)
            return MathUpgradeable.mulDiv(
                usdValue,
                1,
                10 ** (18 - IERC20Metadata(shareToken).decimals()),
                rounding
            );
        }

        // shares = (usdValue * supply) / totalAssetsUSD
        return MathUpgradeable.mulDiv(usdValue, supply, totalUSD, rounding);
    }

    /// @dev Internal assets conversion. Step-wise mulDiv with the requested rounding direction at each
    ///      division site (3 division steps total in the regular path). Step-wise rounding-up can over-
    ///      estimate by at most a few wei vs. a single combined division — that direction favours the
    ///      vault, which is the EIP-4626 intent for previewMint.
    function _convertToAssets(address token, uint256 shares, MathUpgradeable.Rounding rounding) internal view returns (uint256) {
        AssetInfo memory info = assetInfo[token];
        require(info.allowed && info.pool != address(0), "Unsupported token");

        uint256 totalUSD = totalAssetsUSD(); // in 1e18
        uint256 supply = IERC20Metadata(shareToken).totalSupply();

        uint256 usdValue;
        if (supply == 0 || totalUSD == 0) {
            // Initial redemption case: 1 share = 1 USD (pure multiplication, no rounding needed)
            usdValue = shares * (10 ** (18 - IERC20Metadata(shareToken).decimals()));
        } else {
            usdValue = MathUpgradeable.mulDiv(shares, totalUSD, supply, rounding);
        }

        // USD value (1e18) -> token amount in 18 decimals
        uint256 amountIn18Dec = MathUpgradeable.mulDiv(usdValue, DECIMALS, getPrice(token, true), rounding);

        // Scale down to the token's native decimals
        return MathUpgradeable.mulDiv(amountIn18Dec, 1, 10 ** (18 - info.tokenDecimals), rounding);
    }

    /// @notice Retrieve the list of supported tokens.
    /// @return The list of supportedAssets addresses.
    function getSupportedAssets() external view returns (address[] memory) {
        return supportedAssets;
    }

    /// @notice Internal function to add an asset to the protocol
    /// @dev Updates or creates asset configuration and adds to supported assets list if new
    /// @param _pool Address of the pool for this asset
    /// @param _token Address of the asset token
    /// @param _priceFeed Address of the Chainlink price feed
    /// @param _validityPeriod Maximum age of price data in seconds
    /// @param _lowerBound Minimum acceptable price (18 decimals)
    /// @param _upperBound Maximum acceptable price (18 decimals)
    function _addAsset(address _pool, address _token, address _priceFeed, uint256 _validityPeriod, uint256 _lowerBound, uint256 _upperBound) internal {
        // check if the token is already added
        bool isOverwriting = assetInfo[_token].pool != address(0);
        uint8 tokenDecimals = IERC20Metadata(_token).decimals();
        uint8 priceFeedDecimals = AggregatorV3Interface(_priceFeed).decimals();
        assetInfo[_token] = AssetInfo({
            allowed: true,
            priceFeed: _priceFeed,
            pool: _pool,
            tokenDecimals: tokenDecimals,
            priceFeedDecimals: priceFeedDecimals,
            lowerBound: _lowerBound,
            upperBound: _upperBound,
            validityPeriod: _validityPeriod
        });
        // add the asset to the list of collaterals
        if (!isOverwriting) {
            supportedAssets.push(_token);
        } 
        emit AssetAdded(_pool, _token, _priceFeed, tokenDecimals, priceFeedDecimals, _lowerBound, _upperBound, _validityPeriod);
    }

    /// @dev UUPS upgrade authorization
    function _authorizeUpgrade(address _newImplementation)
        internal
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {}
}