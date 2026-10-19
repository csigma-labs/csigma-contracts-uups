// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../interfaces/ICsigmaV1.sol";
import "./CsigmaPermissionedPool.sol";

error V1PoolIsNotActive(string _poolId);
error InvalidV1Pool(string _poolId);
error InvalidAllocation(uint256 _allocation);
error InvalidAmount(uint256 _amount);
error DuplicatePool(string _poolId);
error InvalidAccount(address _account);

/// @title CsigmaPermissionedFundManager
/// @notice Fund manager that deploys capital directly to whitelisted child pool wallets
contract CsigmaPermissionedFundManager is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    /// @notice Address of the factory contract that deployed this fund manager
    address public factory;
    
    /// @notice Address of the permissioned pool contract
    address public pool;
    
    /// @notice Address of the underlying pool token
    address public poolToken;
    
    /// @notice Address of the Diamond V1 contract for pool verification
    address public diamondV1;
    
    /// @notice Total allocation percentage across all V1 pools (must equal 10000 for 100%)
    uint16 public totalAllocation;
    
    /// @notice Lender ID of the fund manager in Diamond V1
    string public fundManagerLenderId;
    
    /// @notice Array of V1 pool information
    PoolInfo[] public v1Pools;
    
    /// @notice Mapping to track which V1 pool IDs are already in use
    mapping (string => bool) private _isUsed;
    
    /// @notice Mapping from V1 pool ID to dedicated wallet address
    mapping (string => address) public dedicatedWallet;

    /// @notice PoolInfo struct to store the V1 pool information
    /// @param v1PoolId The V1 pool ID from Diamond V1
    /// @param allocation The allocation percentage of the pool (in basis points, max 10000)
    struct PoolInfo {
        string v1PoolId;
        uint16 allocation;
    }

    /// @notice Emitted when the admin role is transferred
    /// @param _oldOwner The address of the previous admin
    /// @param _newOwner The address of the new admin
    event AdminTransferred(address _oldOwner, address _newOwner);
    
    /// @notice Emitted when a V1 pool is added to the fund manager
    /// @param _executor The address that executed the addition
    /// @param _allocation The allocation percentage assigned to the pool
    /// @param _v1PoolId The V1 pool ID
    /// @param wallet The dedicated wallet address for the pool
    event V1PoolAdded(address indexed _executor, uint16 _allocation, string _v1PoolId, address wallet);
    
    /// @notice Emitted when a V1 pool is removed from the fund manager
    /// @param _executor The address that executed the removal
    /// @param _allocation The allocation percentage that was freed up
    /// @param _v1PoolId The V1 pool ID
    event V1PoolRemoved(address indexed _executor, uint16 _allocation, string _v1PoolId);
    
    /// @notice Emitted when a V1 pool's allocation is updated
    /// @param _executor The address that executed the update
    /// @param _prevAllocation The previous allocation percentage
    /// @param _newAllocation The new allocation percentage
    /// @param _v1PoolId The V1 pool ID
    event V1PoolAllocationUpdated(
        address indexed _executor,
        uint16 _prevAllocation,
        uint16 _newAllocation,
        string _v1PoolId
    );
    
    /// @notice Emitted when a pool's dedicated wallet is updated
    /// @param executor The address that executed the update
    /// @param _prevWallet The previous wallet address
    /// @param _newWallet The new wallet address
    /// @param _v1PoolId The V1 pool ID
    event PoolWalletUpdated(address indexed executor,  address _prevWallet,  address _newWallet, string _v1PoolId);
    
    /// @notice Emitted when funds are deployed from fund manager to child pools
    /// @param _executor The address that executed the deployment
    /// @param _amount The total amount deployed
    event FundDeployed(address indexed _executor, uint256 _amount);
    
    /// @notice Emitted when funds are deployed to a specific child pool
    /// @param _to The dedicated wallet address that received the funds
    /// @param _poolId The V1 pool ID
    /// @param _amount The amount deployed to this specific pool
    event FundDeployedToChildPool(address indexed _to, string _poolId, uint256 _amount);
    
    /// @notice Emitted when a dedicated wallet repays funds to the fund manager
    /// @param payer The address of the dedicated wallet making the payment
    /// @param _poolId The V1 pool ID
    /// @param amount The amount repaid
    event FundsPaid(address indexed payer, string _poolId, uint256 amount);

    /// @notice Emitted when a dedicated wallet repays fee to the diamond owner
    /// @param payer The address of the dedicated wallet making the payment
    /// @param _poolId The V1 pool ID
    /// @param fee The fee to be paid
    /// @param recipient The address of the fee recipient
    event FeePaidToDiamond(address indexed payer, string _poolId, uint256 fee, address recipient);
    
    /// @notice Emitted when an emergency withdrawal is executed
    /// @param _token The address of the token withdrawn
    /// @param _to The address receiving the withdrawn tokens
    /// @param _amount The amount withdrawn
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);
    
    /// @notice Emitted when a lender is repaid by the pool manager
    /// @param lender The address of the lender repaid
    /// @param assets The amount of assets repaid
    /// @param sharesBurned The amount of LP shares burned
    event PMLenderRepaid(address indexed lender, uint256 assets, uint256 sharesBurned);
    
    /// @notice Emitted when proportional repayment is executed across multiple lenders
    /// @param totalAssets The total amount of assets repaid
    /// @param lpAmountToSettle Total amount of LP tokens to be settled
    /// @param totalSharesBurned The total amount of LP shares burned
    event PMProportionalRepayExecuted(uint256 totalAssets, uint256 lpAmountToSettle, uint256 totalSharesBurned);

    /// @notice Modifier to ensure the provided address is not zero
    /// @param _account The address to check
    modifier notZeroAddress(address _account) {
        require(_account != address(0), "address cannot be zero");
        _;
    }

    /// @notice Restricts a function to the operational pool manager
    /// @dev Reads the current pool manager from the Pool — single source of truth.
    ///      Auto-follows Pool's {updatePoolManager} rotations.
    modifier onlyPoolManager() {
        if (_msgSender() != CsigmaPermissionedPool(pool).poolManager()) {
            revert InvalidAccount(_msgSender());
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract with the required parameters
    /// @param _poolToken The address of the underlying pool token
    /// @param _diamondV1 The address of the Diamond V1 contract
    /// @param _lenderId The lender ID of the fund manager in Diamond V1
    /// @param _pool The address of the pool
    /// @param _poolManager The address of the pool manager who will have admin role
    function initialize(
        address _poolToken,
        address _diamondV1,
        string calldata _lenderId,
        address _pool,
        address _poolManager
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _poolManager);
        factory = _msgSender();
        poolToken = _poolToken;
        diamondV1 = _diamondV1;
        fundManagerLenderId = _lenderId;
        pool = _pool;
    }

    /// @notice Returns the total number of V1 pools to which the funds are deployed
    function totalV1Pools() external view returns (uint256) {
        return v1Pools.length;
    }

    /// @notice Returns the total assets under management in the fund manager
    function totalAssets() public view virtual returns (uint256) {
        return IERC20Upgradeable(poolToken).balanceOf(address(this));
    }

    /// @notice Adds a new V1 pool to the fund manager
    /// @dev Only the pool manager can call this function. Verifies pool status and token match in Diamond V1
    /// @param _v1PoolId The V1 pool ID from Diamond V1
    /// @param _allocation The allocation percentage for this pool (in basis points, max 10000 total)
    /// @param _dedicatedWallet Institutional wallet address for this child pool
    function addPool(string calldata _v1PoolId, uint16 _allocation, address _dedicatedWallet) external onlyPoolManager whenNotPaused notZeroAddress(_dedicatedWallet) {
        if(_isUsed[_v1PoolId]) revert DuplicatePool(_v1PoolId);
        if(ICsigmaV1(diamondV1).getCreditPoolStatus(_v1PoolId) != ICsigmaV1.CreditPoolStatus.ACTIVE) {
            revert V1PoolIsNotActive(_v1PoolId);
        }
        if(ICsigmaV1(diamondV1).getPoolToken(_v1PoolId) != poolToken) {
            revert InvalidV1Pool(_v1PoolId);
        }
        if(_allocation + totalAllocation > 10000) {
            revert InvalidAllocation(_allocation);
        }
        v1Pools.push(PoolInfo(_v1PoolId, _allocation));
        dedicatedWallet[_v1PoolId] = _dedicatedWallet;
        totalAllocation += _allocation;
        _isUsed[_v1PoolId] = true;
        emit V1PoolAdded(_msgSender(), _allocation, _v1PoolId, _dedicatedWallet); 
    }

    /// @notice Removes a V1 pool from the fund manager
    /// @dev Only the pool manager can call this function
    /// @param _index The index of the V1 pool in the v1Pools array
    function removePool(uint256 _index) external onlyPoolManager whenNotPaused {
        uint256 _lastIndex = v1Pools.length - 1;
        PoolInfo memory _pool = v1Pools[_index];
        if(_index != _lastIndex) {
            v1Pools[_index] = v1Pools[_lastIndex];
        }
        v1Pools.pop();
        _isUsed[_pool.v1PoolId] = false;
        totalAllocation -= _pool.allocation;
        emit V1PoolRemoved(_msgSender(), _pool.allocation, _pool.v1PoolId);
    }

    /// @notice Updates the allocation percentage of a V1 pool
    /// @dev Only the pool manager can call this function. Total allocation across all pools must not exceed 10000
    /// @param _index The index of the V1 pool in the v1Pools array
    /// @param _allocation The new allocation percentage for the pool
    function updatePoolAllocation(uint256 _index, uint16 _allocation) external onlyPoolManager whenNotPaused {
        PoolInfo memory _pool = v1Pools[_index];
        if(((_allocation + totalAllocation) - _pool.allocation) > 10000) {
            revert InvalidAllocation(_allocation);
        }
        v1Pools[_index].allocation = _allocation; 
        totalAllocation = (_allocation + totalAllocation) - _pool.allocation;
        emit V1PoolAllocationUpdated(_msgSender(), _pool.allocation, _allocation, _pool.v1PoolId);
    }

    /// @notice Updates the dedicated wallet address for a V1 pool
    /// @dev Only the pool manager can call this function
    /// @param _v1PoolId The V1 pool ID
    /// @param _wallet The new dedicated wallet address for the pool
    function updatePoolWallet(string calldata _v1PoolId, address _wallet) external onlyPoolManager whenNotPaused notZeroAddress(_wallet) {
        if(!_isUsed[_v1PoolId]) revert InvalidV1Pool(_v1PoolId);

        emit PoolWalletUpdated(_msgSender(), dedicatedWallet[_v1PoolId], _wallet, _v1PoolId);
        dedicatedWallet[_v1PoolId] = _wallet;
    }

    /// @notice Deploys funds to all V1 pools based on their allocation percentages
    /// @dev Only the pool manager can call this function
    function deployFunds() external onlyPoolManager whenNotPaused {
        if(totalAllocation != 10000) revert InvalidAllocation(totalAllocation);
        uint256 _bal = IERC20Upgradeable(poolToken).balanceOf(address(this));
        uint256 _amount;
        uint256 _deployed;
        for(uint i; i < v1Pools.length; i++) {
            if(ICsigmaV1(diamondV1).getCreditPoolStatus(v1Pools[i].v1PoolId) != ICsigmaV1.CreditPoolStatus.ACTIVE) {
                revert V1PoolIsNotActive(v1Pools[i].v1PoolId);
            }
            if(ICsigmaV1(diamondV1).getPoolToken(v1Pools[i].v1PoolId) != poolToken) {
                revert InvalidV1Pool(v1Pools[i].v1PoolId);
            }
            address wallet = dedicatedWallet[v1Pools[i].v1PoolId];
            if(wallet == address(0)) {
                revert InvalidAccount(address(0));           
            }
            _amount = (_bal * v1Pools[i].allocation) / 10000;
            _deployed += _amount;
            SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(poolToken), wallet, _amount);
            emit FundDeployedToChildPool(wallet, v1Pools[i].v1PoolId, _amount);
        }
        CsigmaPermissionedPool(pool).updateAssetUnderManagement(CsigmaPermissionedPool(pool).assetUnderManagement() + _deployed);
        emit FundDeployed(_msgSender(), _bal);
    }

    /// @notice Allows a whitelisted V1 pool dedicated wallet to repay funds to the fund manager
    /// @dev Caller must be the dedicated wallet associated with the given pool index. Updates AUM accordingly
    /// @param _v1PoolId The V1 pool ID
    /// @param _amount Amount of underlying pool token being repaid
    /// @param _fee Fee amount to be sent to Diamond V1 owner
    function pay(string calldata _v1PoolId, uint256 _amount, uint256 _fee) external whenNotPaused {
        if(ICsigmaV1(diamondV1).getCreditPoolStatus(_v1PoolId) != ICsigmaV1.CreditPoolStatus.ACTIVE) {
            revert V1PoolIsNotActive(_v1PoolId);
        }
        if (dedicatedWallet[_v1PoolId] != _msgSender()) {
            revert InvalidAccount(_msgSender());
        }

        uint256 netAmount = _amount - _fee;
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(poolToken), _msgSender(), address(this), _amount);
        CsigmaPermissionedPool(pool).updateAssetUnderManagement(CsigmaPermissionedPool(pool).assetUnderManagement() - netAmount);
        emit FundsPaid(_msgSender(), _v1PoolId, netAmount);
        if (_fee > 0) {
            address diamondOwner = ICsigmaV1(diamondV1).owner();
            SafeERC20Upgradeable.safeTransfer(
                IERC20Upgradeable(poolToken), 
                diamondOwner, 
                _fee
            );
            emit FeePaidToDiamond(_msgSender(), _v1PoolId, _fee, diamondOwner);
        }
    }
    
    /// @notice Sends funds to the permissioned pool reserve and repays the pending withdrawal queue
    /// @dev Only the pool manager can call this function. Triggers withdrawal manager repayment if available
    /// @param _v2Amount The amount to send to the permissioned pool reserve
    /// @param uptoQueuePosition The queue position up to which withdrawals should be fulfilled
    function sendToV2Reserve(uint256 _v2Amount, uint256 uptoQueuePosition) external onlyPoolManager whenNotPaused {
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(poolToken), pool, _v2Amount);
        address withdrawManager = CsigmaPermissionedPool(pool).withdrawalManager();
        if(withdrawManager == address(0)) return;
        WithdrawManager(withdrawManager).repay(uptoQueuePosition, _v2Amount);
    }

    /// @notice Repays a specific lender by burning LP shares equivalent to given assets
    /// @dev Only the pool manager can call this function
    /// @param lender Address of the lender to repay
    /// @param assets Amount of underlying assets to repay
    function pmRepayLender(address lender, uint256 assets) external onlyPoolManager whenNotPaused {
        if(assets == 0) {
            revert InvalidAmount(assets);
        }
        uint256 shares = CsigmaPermissionedPool(pool).convertToShares(assets);
        if(shares == 0) {
            revert InvalidAmount(shares);
        }

        // ensure liquidity is moved to pool first
        SafeERC20Upgradeable.safeTransfer(
            IERC20Upgradeable(poolToken),
            pool,
            assets
        );

        CsigmaPermissionedPool(pool).pmRepayAndBurn(
            lender,
            shares
        );
        emit PMLenderRepaid(lender, assets, shares);
    }

    /// @notice Repays multiple lenders proportionally based on their LP ownership percentage
    /// @dev Only the pool manager can call this function. Distributes assets proportionally to lender share ownership
    /// @param lenders List of lender addresses to include in proportional repayment
    /// @param assets Total amount of underlying assets to be repaid 
    /// @param lpAmountToSettle Total amount of LP tokens to be settled
    function pmProportionalRepayAndBurn(
        address[] calldata lenders,
        uint256 assets,
        uint256 lpAmountToSettle  
    ) external onlyPoolManager whenNotPaused {
        require(lenders.length > 0, "No lenders");
        if(assets == 0) {
            revert InvalidAmount(assets);
        }
        if(lpAmountToSettle == 0) {
            revert InvalidAmount(lpAmountToSettle);
        }

        // 1. Move funds to pool first
        SafeERC20Upgradeable.safeTransfer(
            IERC20Upgradeable(poolToken),
            pool,
            assets
        );

        uint256 totalSharesToBurn = CsigmaPermissionedPool(pool).convertToShares(assets);
        if(totalSharesToBurn == 0) {
            revert InvalidAmount(totalSharesToBurn);
        }

        uint256 remainingShares = totalSharesToBurn;
        uint256 actualLpSum = 0;  

        for (uint256 i = 0; i < lenders.length; i++) {
            address lender = lenders[i];

            uint256 lenderLP = IERC20Upgradeable(pool).balanceOf(lender);
            
            // Accumulate while processing
            actualLpSum += lenderLP;
            if (lenderLP == 0) continue;

            // proportional share = totalSharesToBurn * lenderLP / lpAmountToSettle
            uint256 lenderShares = (totalSharesToBurn * lenderLP) / lpAmountToSettle;

            if (lenderShares == 0) continue;

            // Cap last iteration to avoid dust loss
            if (lenderShares > remainingShares) {
                lenderShares = remainingShares;
            }

            CsigmaPermissionedPool(pool).pmRepayAndBurn(
                lender,
                lenderShares
            );

            remainingShares -= lenderShares;
            if (remainingShares == 0) break;
        }

        if(actualLpSum != lpAmountToSettle) {
            revert InvalidAmount(actualLpSum); 
        }
        
        emit PMProportionalRepayExecuted(assets, lpAmountToSettle, totalSharesToBurn);
    }

    /// @notice Pauses the contract
    /// @dev Only the pool manager can call this function
    function pause() external onlyPoolManager {
        _pause();
    }

    /// @notice Unpauses the contract
    /// @dev Only the pool manager can call this function
    function unpause() external onlyPoolManager {
        _unpause();
    }

    /// @notice Emergency withdrawal function to recover tokens from the contract
    /// @dev Only the admin can call this function. Use with caution
    /// @param _token The address of the token to withdraw
    /// @param _to The address receiving the withdrawn tokens
    /// @param _amount The amount of tokens to withdraw
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_token), _to, _amount);
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    /// @notice Transfers the default admin role to a new address
    /// @dev Grants the role to the new owner and revokes it from the caller
    /// @param _newOwner The address of the new admin
    function transferAdmin(address _newOwner) public
    {
        grantRole(DEFAULT_ADMIN_ROLE, _newOwner);
        revokeRole(DEFAULT_ADMIN_ROLE, _msgSender());
        emit AdminTransferred(_msgSender(), _newOwner);
    }    

    /// @notice Grants a role to an account
    /// @param role The role identifier to grant
    /// @param _account The address to which the role is granted
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
    /// @param role The role identifier to revoke
    /// @param _account The address from which the role is revoked
    function revokeRole(bytes32 role, address _account)
        public
        override
        onlyRole(getRoleAdmin(role))        
        notZeroAddress(_account)        
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
}