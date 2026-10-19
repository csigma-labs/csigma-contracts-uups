// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { Commands } from "@uniswap/universal-router/contracts/libraries/Commands.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { IV4Router } from "@uniswap/v4-periphery/src/interfaces/IV4Router.sol";
import { Actions } from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import { IPermit2 } from "@uniswap/permit2/src/interfaces/IPermit2.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StateLibrary } from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import { PoolKey } from '@uniswap/v4-core/src/types/PoolKey.sol';
import { IUniversalRouter } from '@uniswap/universal-router/contracts/interfaces/IUniversalRouter.sol';
import "../interfaces/ICsigmaInst.sol";
import "./CsigmaERC7575Vault.sol";

error V1PoolIsNotActive(string _poolId);
error InvalidV1Pool(string _poolId);
error InvalidAllocation(uint256 _allocation, address _token);
error InvalidV1Amount(uint256 _v1Amount);
error InvalidAmount(uint256 _v2Amount, uint256 _v1Amount);
error DuplicatePool(string _poolId);

/// @title CSUSDFundManager
/// @notice This contract manages the fund deployment and claim process for the cSigma V3 Pool Managers
/// @dev Implements role-based access control, pausability, and UUPS upgradeable pattern
/// @dev Manages allocation of funds between V1 and V3 pools with automatic rebalancing
/// @author cSigma Finance Inc.
contract CSUSDFundManager is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    using StateLibrary for IPoolManager;
    
    /// @notice Role identifier for managers who can perform administrative operations
    bytes32 public constant ROLE_MANAGER = keccak256("ROLE_MANAGER");
    
    /// @notice Address of the Uniswap V4 router for token swaps
    address public router;
    
    /// @notice Uniswap V4 pool manager interface
    IPoolManager public poolManager;
    
    /// @notice Permit2 contract for gasless token approvals
    IPermit2 public permit2;

    /// @notice Address of the V1 diamond contract
    address public diamondV1;
    
    /// @notice Unique identifier for this fund manager as a lender in V1
    string public fundManagerLenderId;
    
    /// @notice Maps token addresses to their corresponding V3 pool addresses
    mapping (address => address) public pool;
    
    /// @notice Maps token addresses to their total allocation percentage across all V1 pools
    mapping (address => uint16) public totalAllocation;
    
    /// @notice Maps token addresses to their whitelist status
    mapping (address => bool) public isWhitelistedToken;
    
    /// @notice Maps token addresses to arrays of their associated V1 pool information
    mapping (address => PoolInfo[]) public v1Pools;
    
    /// @notice Maps token addresses to their off-chain balance amounts
    mapping (address => uint256) public offChainBalance;
    
    /// @dev Maps V1 pool IDs to usage status to prevent duplicates
    mapping (string => bool) private _isUsed;
    
    /// @notice PoolInfo struct to store the V1 pool information
    /// @param v1PoolId The V1 pool ID
    /// @param allocation The allocation percentage of the pool
    struct PoolInfo {
        string v1PoolId;
        uint16 allocation;
    }

    /// @notice Claim struct to store the claim information
    /// @param request The V1 request
    /// @param sigR The R value of the signature
    /// @param sigS The S value of the signature
    /// @param sigV The V value of the signature
    struct Claim {
        ICsigmaV1.Request request;
        bytes32 sigR;
        bytes32 sigS;
        uint8 sigV;
    }

    /// @notice Disburse struct to store the disburse information
    /// @param v1PoolIndex The index of the V1 pool
    /// @param amount The amount to disburse
    struct Disburse {
        uint256 v1PoolIndex;
        uint256 amount;
    }

    /// @notice Emitted when admin role is transferred to a new address
    /// @param _oldOwner The previous admin address
    /// @param _newOwner The new admin address
    event AdminTransferred(address _oldOwner, address _newOwner);
    
    /// @notice Emitted when a pool token is added to the whitelist
    /// @param _poolToken The address of the added pool token
    event PoolTokenAdded(address _poolToken);
    
    /// @notice Emitted when a pool token is removed from the whitelist
    /// @param _poolToken The address of the removed pool token
    event PoolTokenRemoved(address _poolToken);
    
    /// @notice Emitted when a V1 pool is added to the fund manager
    /// @param _executor The address that executed the operation
    /// @param _token The underlying token address
    /// @param _allocation The allocation percentage assigned to the pool
    /// @param _v1PoolId The ID of the added V1 pool
    event V1PoolAdded(address indexed _executor, address _token, uint16 _allocation, string _v1PoolId);
    
    /// @notice Emitted when a V1 pool is removed from the fund manager
    /// @param _executor The address that executed the operation
    /// @param _token The underlying token address
    /// @param _allocation The allocation percentage that was removed
    /// @param _v1PoolId The ID of the removed V1 pool
    event V1PoolRemoved(address indexed _executor, address _token, uint16 _allocation, string _v1PoolId);
    
    /// @notice Emitted when a V1 pool's allocation is updated
    /// @param _executor The address that executed the operation
    /// @param _token The underlying token address
    /// @param _prevAllocation The previous allocation percentage
    /// @param _newAllocation The new allocation percentage
    /// @param _v1PoolId The ID of the V1 pool with updated allocation
    event V1PoolAllocationUpdated(
        address indexed _executor,
        address _token,
        uint16 _prevAllocation,
        uint16 _newAllocation,
        string _v1PoolId
    );
    
    /// @notice Emitted when funds are deployed to V1 pools
    /// @param _executor The address that executed the deployment
    /// @param _token The token address of deployed funds
    /// @param _amount The total amount deployed
    event FundDeployed(address indexed _executor, address _token, uint256 _amount);
    
    /// @notice Emitted when funds are claimed from V1 pools
    /// @param _executor The address that executed the claim
    /// @param _token The token address of claimed funds
    /// @param _amount The total amount claimed
    event FundClaimed(address indexed _executor, address _token, uint256 _amount);
    
    /// @notice Emitted when emergency withdrawal is performed
    /// @param _token The token address being withdrawn
    /// @param _to The recipient address
    /// @param _amount The amount withdrawn
    event EmergencyWithdraw(address _token, address _to, uint256 _amount);
    
    /// @notice Emitted when tokens are manually swapped out (sent off-chain)
    /// @param _executor The address that executed the swap
    /// @param _to The recipient address
    /// @param _tokenOut The token being sent out
    /// @param _amountOut The amount sent out
    event SwapOut(
        address indexed _executor,
        address indexed _to,
        address indexed _tokenOut,
        uint256 _amountOut
    );

    /// @notice Emitted when tokens are manually swapped in (received from off-chain)
    /// @param _executor The address that executed the swap
    /// @param _tokenIn The token being received
    /// @param _amountIn The amount received
    /// @param _tokenOut The token being decremented from off-chain balance
    /// @param _amountOut The amount decremented
    event SwapIn(
        address indexed _executor,
        address indexed _tokenIn,
        uint256 _amountIn,
        address indexed _tokenOut,
        uint256 _amountOut
    );

    /// @notice Emitted when a Uniswap V4 swap is executed
    /// @param _executor The address that executed the swap
    /// @param key The pool key used for the swap
    /// @param zeroForOne The direction of swap
    /// @param amountIn The input amount
    /// @param amountOut The output amount received
    event Swap(address indexed _executor, PoolKey key, bool zeroForOne, uint128 amountIn, uint256 amountOut);

    /// @notice Ensures the provided address is not the zero address
    /// @param _account The address to validate
    modifier notZeroAddress(address _account) {
        require(_account != address(0), "address cannot be zero");
        _;
    }

    /// @notice Ensures the caller is the pool manager for the specified token
    /// @param _token The token address to check pool manager for
    modifier onlyPoolManager(address _token) {
        if(_msgSender() != CsigmaV3Pool(pool[_token]).poolManager()) {
            revert AccessDenied(_msgSender());
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract with the required parameters
    /// @param _diamondV1 The address of the V1 diamond
    /// @param _lenderId The lender ID of the fund manager
    /// @param _manager The address of manager multisig
    /// @param _router The address of the Uniswap V4 router
    /// @param _poolManager The address of the Uniswap V4 pool manager
    /// @param _permit2 The address of the Permit2 contract
    function initialize(
        address _diamondV1,
        string calldata _lenderId,
        address _manager,
        address _router,
        address _poolManager,
        address _permit2
    )
        public
        initializer
    {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(ROLE_MANAGER, _manager);
        diamondV1 = _diamondV1;
        fundManagerLenderId = _lenderId;

        router = payable(_router);
        poolManager = IPoolManager(_poolManager);
        permit2 = IPermit2(_permit2);
    }

    /// @notice Returns the total number of V1 pools to which the funds are deployed
    /// @param _token The address of underlying token
    function totalV1Pools(address _token) external view returns (uint256) {
        return v1Pools[_token].length;
    }

    /// @notice Returns the total assets under management
    /// @param _token The address of underlying token
    function totalAssets(address _token) public view virtual returns (uint256) {
        return (IERC20Upgradeable(_token).balanceOf(address(this)) 
                + ICsigmaV1(diamondV1).getTokenBalance(fundManagerLenderId, _token)
                + offChainBalance[_token]
                );
    }

    /// @notice Adds an underlying token of given pool to the whitelist
    /// @param _pool The address of the pool
    function addTokenToWhitelist(address _pool) external onlyRole(ROLE_MANAGER) {
        address _token = CsigmaV3Pool(_pool).poolToken();
        if(_token == address(0) || isWhitelistedToken[_token]) {
            revert InvalidAddress(_token);
        }
        isWhitelistedToken[_token] = true;
        pool[_token] = _pool;
        SafeERC20Upgradeable.forceApprove(IERC20Upgradeable(_token), diamondV1, type(uint256).max);
        emit PoolTokenAdded(_token);
    }

    /// @notice Removes an underlying token of given pool from the whitelist
    /// @param _pool The address of the pool
    function removeTokenFromWhitelist(address _pool) external onlyRole(ROLE_MANAGER) {
        address _token = CsigmaV3Pool(_pool).poolToken();
        if(!isWhitelistedToken[_token]) {
            revert InvalidAddress(_token);
        }
        isWhitelistedToken[_token] = false;
        delete pool[_token];
        emit PoolTokenRemoved(_token);
    }

    /// @notice Adds a new V1 pool to the fund manager
    /// @dev Only the pool manager can call this function
    /// @param _token The address of underlying token
    /// @param _v1PoolId The V1 pool ID
    /// @param _allocation The allocation percentage of the pool
    function addPool(address _token, string calldata _v1PoolId, uint16 _allocation) external onlyPoolManager(_token) whenNotPaused {
        if(!isWhitelistedToken[_token]) revert InvalidAddress(_token);
        if(_isUsed[_v1PoolId]) revert DuplicatePool(_v1PoolId);
        if(ICsigmaV1(diamondV1).getCreditPoolStatus(_v1PoolId) != ICsigmaV1.CreditPoolStatus.ACTIVE) {
            revert V1PoolIsNotActive(_v1PoolId);
        }
        if(ICsigmaV1(diamondV1).getPoolToken(_v1PoolId) != _token) {
            revert InvalidV1Pool(_v1PoolId);
        }
        if(_allocation + totalAllocation[_token] > 10000) {
            revert InvalidAllocation(_allocation, _token);
        }
        v1Pools[_token].push(PoolInfo(_v1PoolId, _allocation));
        totalAllocation[_token] += _allocation;
        _isUsed[_v1PoolId] = true;
        emit V1PoolAdded(_msgSender(), _token, _allocation, _v1PoolId); 
    }

    /// @notice Removes a V1 pool from the fund manager
    /// @dev Only the pool manager can call this function
    /// @param _token The address of underlying token
    /// @param _index The index of the V1 pool
    function removePool(address _token, uint256 _index) external onlyPoolManager(_token) whenNotPaused {
        if(!isWhitelistedToken[_token]) revert InvalidAddress(_token);
        uint256 _lastIndex = v1Pools[_token].length - 1;
        PoolInfo memory _pool = v1Pools[_token][_index];
        if(_index != _lastIndex) {
            v1Pools[_token][_index] = v1Pools[_token][_lastIndex];
        }
        v1Pools[_token].pop();
        _isUsed[_pool.v1PoolId] = false;
        totalAllocation[_token] -= _pool.allocation;
        emit V1PoolRemoved(_msgSender(), _token, _pool.allocation, _pool.v1PoolId);
    }

    /// @notice Updates the allocation of a V1 pool
    /// @dev Only the pool manager can call this function
    /// @param _token The address of underlying token
    /// @param _index The index of the V1 pool
    /// @param _allocation The new allocation percentage of the pool
    function updatePoolAllocation(address _token, uint256 _index, uint16 _allocation) external onlyPoolManager(_token) whenNotPaused {
        if(!isWhitelistedToken[_token]) revert InvalidAddress(_token);
        PoolInfo memory _pool = v1Pools[_token][_index];
        if(((_allocation + totalAllocation[_token]) - _pool.allocation) > 10000) {
            revert InvalidAllocation(_allocation, _token);
        }
        v1Pools[_token][_index].allocation = _allocation; 
        totalAllocation[_token] = (_allocation + totalAllocation[_token]) - _pool.allocation;
        emit V1PoolAllocationUpdated(_msgSender(), _token, _pool.allocation, _allocation, _pool.v1PoolId);
    }

    /// @notice Deploys the funds to the V1 pools
    /// @param _token The address of underlying token
    /// @dev Only the pool manager can call this function
    function deployFunds(address _token) external onlyPoolManager(_token) whenNotPaused {
        if(!isWhitelistedToken[_token]) revert InvalidAddress(_token);
        if(totalAllocation[_token] != 10000) revert InvalidAllocation(totalAllocation[_token], _token);
        uint256 _bal = IERC20Upgradeable(_token).balanceOf(address(this));
        ICsigmaV1(diamondV1).deposit(fundManagerLenderId, _token, _bal);
        uint256 _amount;
        uint256 _deployed;
        for(uint i; i < v1Pools[_token].length; i++) {
            _amount = (_bal * v1Pools[_token][i].allocation) / 10000;
            _deployed += _amount;
            ICsigmaV1(diamondV1).invest(fundManagerLenderId, v1Pools[_token][i].v1PoolId, _amount);
        }
        CsigmaV3Pool(pool[_token]).updateAssetUnderManagement(CsigmaV3Pool(pool[_token]).assetUnderManagement() + _deployed);
        emit FundDeployed(_msgSender(), _token, _bal);
    }

    /// @notice Deploys the funds to the V1 pools partially from available balance
    /// @param _token The address of underlying token
    /// @param _bal Token amount to deploy 
    /// @dev Only the pool manager can call this function
    function deployFundsPartially(address _token, uint256 _bal) external onlyPoolManager(_token) whenNotPaused {
        if(!isWhitelistedToken[_token]) revert InvalidAddress(_token);
        if(totalAllocation[_token] != 10000) revert InvalidAllocation(totalAllocation[_token], _token);
        ICsigmaV1(diamondV1).deposit(fundManagerLenderId, _token, _bal);
        uint256 _amount;
        uint256 _deployed;
        for(uint i; i < v1Pools[_token].length; i++) {
            _amount = (_bal * v1Pools[_token][i].allocation) / 10000;
            _deployed += _amount;
            ICsigmaV1(diamondV1).invest(fundManagerLenderId, v1Pools[_token][i].v1PoolId, _amount);
        }
        CsigmaV3Pool(pool[_token]).updateAssetUnderManagement(CsigmaV3Pool(pool[_token]).assetUnderManagement() + _deployed);
        emit FundDeployed(_msgSender(), _token, _bal);
    }

    /// @notice Claims the funds from the V1 pools
    /// @dev Only the pool manager can call this function
    /// @param _token The address of underlying token
    /// @param _claim The claim information
    function claimFunds(address _token, Claim[] calldata _claim) external onlyPoolManager(_token) whenNotPaused {
        if(!isWhitelistedToken[_token]) revert InvalidAddress(_token);
        uint256 _initial = ICsigmaV1(diamondV1).getTokenBalance(fundManagerLenderId, _token);
        for(uint i; i < _claim.length; i++) {
            ICsigmaV1(diamondV1).withdrawPoolPaymentIntoVault(
                _claim[i].request,
                _claim[i].sigR,
                _claim[i].sigS,
                _claim[i].sigV
            );
        }
        uint256 _recouped = ICsigmaV1(diamondV1).getTokenBalance(fundManagerLenderId, _token);
        CsigmaV3Pool(pool[_token]).updateAssetUnderManagement(CsigmaV3Pool(pool[_token]).assetUnderManagement() - (_recouped - _initial));
        ICsigmaV1(diamondV1).withdrawRequest(fundManagerLenderId, _token, _recouped);
        emit FundClaimed(_msgSender(), _token, _recouped);
    }
    
    /// @notice Sends the funds to the V2 pool reserve and repays the pending queue
    /// @dev Only the pool manager can call this function
    /// @param _token The address of underlying token
    /// @param _v2Amount The amount to send to the V2 pool reserve
    function sendToV2Reserve(address _token, uint256 _v2Amount, uint256 uptoQueuePosition) external onlyPoolManager(_token) whenNotPaused {
        if(!isWhitelistedToken[_token]) revert InvalidAddress(_token);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_token), pool[_token], _v2Amount);
        address withdrawManager = CsigmaV3Pool(pool[_token]).withdrawalManager();
        if(withdrawManager == address(0)) return;
        WithdrawManager(withdrawManager).repay(uptoQueuePosition, _v2Amount);
    }

    /// @notice Manually swaps tokens out to an external address (for off-chain operations)
    /// @dev Only the pool manager can call this function
    /// @dev Increases the off-chain balance tracking for the token
    /// @param _tokenOut The address of the token being sent out
    /// @param _to The recipient address
    /// @param _amountOut The amount being sent out
    function manualSwapOut(address _tokenOut, address _to, uint256 _amountOut) external onlyPoolManager(_tokenOut) whenNotPaused {
        if(!isWhitelistedToken[_tokenOut]) revert InvalidAddress(_tokenOut);
        SafeERC20Upgradeable.safeTransfer(IERC20Upgradeable(_tokenOut), _to, _amountOut);
        offChainBalance[_tokenOut] += _amountOut;
        emit SwapOut(_msgSender(), _to, _tokenOut, _amountOut);
    }

    /// @notice Manually swaps tokens in from an external source (from off-chain operations)
    /// @dev Only the pool manager can call this function
    /// @dev Decreases the off-chain balance tracking for the output token
    /// @param _tokenIn The address of the token being received
    /// @param _amountIn The amount being received
    /// @param _tokenOut The address of the token being decremented from off-chain balance
    /// @param _amountOut The amount being decremented from off-chain balance
    function manualSwapIn(
        address _tokenIn,
        uint256 _amountIn,
        address _tokenOut,
        uint256 _amountOut
    ) external onlyPoolManager(_tokenOut) whenNotPaused {
        if(!isWhitelistedToken[_tokenIn]) revert InvalidAddress(_tokenIn);
        SafeERC20Upgradeable.safeTransferFrom(IERC20Upgradeable(_tokenIn), _msgSender(), address(this), _amountIn);
        offChainBalance[_tokenOut] -= _amountOut;
        emit SwapIn(_msgSender(), _tokenIn, _amountIn, _tokenOut, _amountOut);
    }

    /// @notice Executes a single exact input swap on Uniswap V4
    /// @dev Only the pool manager can call this function
    /// @dev Uses Universal Router with Permit2 for gasless approvals
    /// @param key The pool key containing currency pair and fee information
    /// @param zeroForOne The direction of swap
    /// @param amountIn The exact amount of input tokens to swap
    /// @param minAmountOut The minimum amount of output tokens expected
    /// @param inputToken The address of the input token
    /// @param outputToken The address of the output token
    /// @return amountOut The actual amount of output tokens received
    function swapExactInputSingle(
        PoolKey calldata key,
        bool zeroForOne,
        uint128 amountIn,
        uint128 minAmountOut,
        address inputToken,
        address outputToken
    ) external onlyPoolManager(inputToken) whenNotPaused returns (uint256 amountOut) {
        if(!isWhitelistedToken[inputToken]) revert InvalidAddress(inputToken);
        if(!isWhitelistedToken[outputToken]) revert InvalidAddress(outputToken);
        IERC20(inputToken).approve(address(permit2), amountIn);
        permit2.approve(inputToken, address(router), amountIn, type(uint48).max);

        // Encode the Universal Router command
        bytes memory commands = abi.encodePacked(uint8(Commands.V4_SWAP));
        bytes[] memory inputs = new bytes[](1);

        // Encode V4Router actions
        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE),
            uint8(Actions.SETTLE_ALL),
            uint8(Actions.TAKE_ALL)
        );

        // Prepare parameters for each action
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                hookData: bytes("")
            })
        );
        params[1] = abi.encode(inputToken, amountIn);
        params[2] = abi.encode(outputToken, minAmountOut);

        // Combine actions and params into inputs
        inputs[0] = abi.encode(actions, params);

        // Execute the swap
        uint256 deadline = block.timestamp + 20;
        uint256 balanceBefore = IERC20Upgradeable(outputToken).balanceOf(address(this));
        IUniversalRouter(router).execute(commands, inputs, deadline);

        // Verify and return the amount received from this swap, excluding any pre-existing balance
        amountOut = IERC20Upgradeable(outputToken).balanceOf(address(this)) - balanceBefore;
        require(amountOut >= minAmountOut, "Insufficient output amount");
        emit Swap(_msgSender(), key, zeroForOne, amountIn, amountOut);
        return amountOut;
    }

    /// @notice Pauses the contract
    /// @dev Only the admin can call this function
    function pause() external onlyRole(ROLE_MANAGER) {
        _pause();
    }

    /// @notice Unpauses the contract
    /// @dev Only the admin can call this function
    function unpause() external onlyRole(ROLE_MANAGER) {
        _unpause();
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

    /// @notice Transfers the admin role to a new address
    /// @param _newOwner The address of the new admin
    function transferAdmin(address _newOwner) public
    {
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
        notZeroAddress(_account)
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