# Solidity API

## CsigmaV2Factory

Contract to create and manage cSigma V2 pools

### InvalidAddress

```solidity
error InvalidAddress(address _poolManager)
```

Error messages when  pool manager address is invalid

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolManager | address | The address provided is invalid |

### InvalidPoolName

```solidity
error InvalidPoolName(string _poolName)
```

Error message when the pool name is already in use

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolName | string | The address provided is invalid |

### StakingPoolExist

```solidity
error StakingPoolExist(address _pool)
```

Error message when a staking pool already exists for a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool for which the staking pool already exists |

### poolImplementation

```solidity
address poolImplementation
```

Address of the pool implementation contract

### fundManagerImplementation

```solidity
address fundManagerImplementation
```

Address of the fund manager implementation contract

### stakingPoolImplementation

```solidity
address stakingPoolImplementation
```

Address of the staking pool implementation contract

### diamondV1

```solidity
address diamondV1
```

Address of the Diamond V1 contract

### sigmaToken

```solidity
address sigmaToken
```

Address of the Sigma token

### chainalysis

```solidity
address chainalysis
```

Address of the Chainalysis contract

### isPoolManager

```solidity
mapping(address => bool) isPoolManager
```

Mapping of pool manager addresses to validate if they are authorized pool managers

### isWhitelistedToken

```solidity
mapping(address => bool) isWhitelistedToken
```

Mapping of token addresses to validate if they are whitelisted for pools

### isStakingPoolCreated

```solidity
mapping(address => bool) isStakingPoolCreated
```

Mapping to track if staking pool has been created for a specific pool

### pools

```solidity
address[] pools
```

List of all created pools

### PoolImplementationUpdated

```solidity
event PoolImplementationUpdated(address _prevImpl, address _newImpl)
```

Event triggered when the pool implementation is updated

_Emitted when the pool implementation contract address is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevImpl | address | The previous pool implementation address |
| _newImpl | address | The new pool implementation address |

### FundManagerImplementationUpdated

```solidity
event FundManagerImplementationUpdated(address _prevImpl, address _newImpl)
```

Event triggered when the fund manager implementation is updated

_Emitted when the fund manager implementation contract address is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevImpl | address | The previous fund manager implementation address |
| _newImpl | address | The new fund manager implementation address |

### StakingPoolImplementationUpdated

```solidity
event StakingPoolImplementationUpdated(address _prevImpl, address _newImpl)
```

Event triggered when the staking pool implementation is updated

_Emitted when the staking pool implementation contract address is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevImpl | address | The previous staking pool implementation address |
| _newImpl | address | The new staking pool implementation address |

### ChainalysisAddressUpdated

```solidity
event ChainalysisAddressUpdated(address _prevAddress, address _newAddress)
```

Event triggered when the Chainalysis contract address is updated

_Emitted when the Chainalysis contract address is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevAddress | address | The previous Chainalysis contract address |
| _newAddress | address | The new Chainalysis contract address |

### SigmaTokenAddressUpdated

```solidity
event SigmaTokenAddressUpdated(address _prevAddress, address _newAddress)
```

Event triggered when the Sigma token address is updated

_Emitted when the Sigma token address is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevAddress | address | The previous Sigma token address |
| _newAddress | address | The new Sigma token address |

### PoolTokenAdded

```solidity
event PoolTokenAdded(address _poolToken)
```

Event triggered when a new token is added to the pool whitelist

_Emitted when a new token is added to the whitelist for pools_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolToken | address | The address of the pool token that was added |

### PoolTokenRemoved

```solidity
event PoolTokenRemoved(address _poolToken)
```

Event triggered when a token is removed from the pool whitelist

_Emitted when a token is removed from the whitelist for pools_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolToken | address | The address of the pool token that was removed |

### PoolManagerAdded

```solidity
event PoolManagerAdded(address _poolManager)
```

Event triggered when a pool manager is added

_Emitted when a new pool manager is added_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolManager | address | The address of the pool manager that was added |

### PoolManagerRemoved

```solidity
event PoolManagerRemoved(address _poolManager)
```

Event triggered when a pool manager is removed

_Emitted when a pool manager is removed_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolManager | address | The address of the pool manager that was removed |

### PoolCreated

```solidity
event PoolCreated(address _pool, address _poolManager, address _fundManager, address _poolToken, address _oracleManager, uint256 _poolAPY, uint256 _poolSize)
```

Event triggered when a new pool is created

_Emitted when a new pool is created_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the new pool |
| _poolManager | address | The address of the pool manager assigned to the pool |
| _fundManager | address | The address of the fund manager created for the pool |
| _poolToken | address | The address of the pool token |
| _oracleManager | address | The address of the oracle manager |
| _poolAPY | uint256 | The projected annual percentage yield (APY) of the pool |
| _poolSize | uint256 | The size (total capital) of the pool |

### StakingPoolCreated

```solidity
event StakingPoolCreated(address _stakingPool, address _pool)
```

Event triggered when a new staking pool is created

_Emitted when a new staking pool is created for a specific pool_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _stakingPool | address | The address of the newly created staking pool |
| _pool | address | The address of the pool for which the staking pool was created |

### PoolManagerUpdated

```solidity
event PoolManagerUpdated(address _pool, address _oldManager, address _newManager)
```

Event triggered when the pool manager of a pool is updated

_Emitted when the pool manager of a pool is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool |
| _oldManager | address | The previous pool manager address |
| _newManager | address | The new pool manager address |

### PoolSizeUpdated

```solidity
event PoolSizeUpdated(address _pool, uint256 _oldValue, uint256 _newValue)
```

Event triggered when the size of a pool is updated

_Emitted when the size (capital) of a pool is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose size was updated |
| _oldValue | uint256 | The previous size of the pool |
| _newValue | uint256 | The new size of the pool |

### AdminTransferred

```solidity
event AdminTransferred(address _oldOwner, address _newOwner)
```

Event triggered when the admin ownership is transferred

_Emitted when the admin ownership of the contract is transferred_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _oldOwner | address | The address of the previous owner |
| _newOwner | address | The address of the new owner |

### constructor

```solidity
constructor() public
```

### initialize

```solidity
function initialize(address _admin, address _fundManagerImpl, address _stakingPoolImpl, address _poolImpl, address _diamondV1, address _sigmaToken, address _chainalysis) public
```

Initializes the factory with the given parameters

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _admin | address | The address of the admin |
| _fundManagerImpl | address | The address of the fund manager implementation |
| _stakingPoolImpl | address | The address of the staking pool implementation |
| _poolImpl | address | The address of the pool implementation |
| _diamondV1 | address | The address of the diamond V1 contract |
| _sigmaToken | address | The address of the sigma token |
| _chainalysis | address | The address of the chainalysis contract |

### totalPools

```solidity
function totalPools() external view returns (uint256)
```

Returns the total number of pools created

### updatePoolImplementation

```solidity
function updatePoolImplementation(address _newImpl) external
```

Updates the pool implementation address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImpl | address | The address of the new pool implementation |

### updateFundManagerImplementation

```solidity
function updateFundManagerImplementation(address _newImpl) external
```

Updates the fund manager implementation address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImpl | address | The address of the new fund manager implementation |

### updateStakingPoolImplementation

```solidity
function updateStakingPoolImplementation(address _newImpl) external
```

Updates the staking pool implementation address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImpl | address | The address of the new staking pool implementation |

### updateChainalysisAddress

```solidity
function updateChainalysisAddress(address _newAddr) external
```

Updates the chainalysis contract address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newAddr | address | The address of the new chainalysis contract |

### updateSigmaTokenAddress

```solidity
function updateSigmaTokenAddress(address _newAddr) external
```

Updates the sigma token address

### addPoolManager

```solidity
function addPoolManager(address _poolManager) external
```

Adds a pool manager to the factory

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolManager | address | The address of the pool manager |

### removePoolManager

```solidity
function removePoolManager(address _poolManager) external
```

Removes a pool manager from the factory

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolManager | address | The address of the pool manager |

### addTokenToWhitelist

```solidity
function addTokenToWhitelist(address _token) external
```

Adds a token to the whitelist

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token |

### removeTokenFromWhitelist

```solidity
function removeTokenFromWhitelist(address _token) external
```

Removes a token from the whitelist

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token |

### createPool

```solidity
function createPool(string _poolName, string _poolSymbol, string _fundManagerLenderId, address _poolManager, address _poolToken, address _oracleManager, uint256 _projectedAPY, uint256 _poolSize) external returns (address _poolAddress, address _fundManager)
```

Creates a new pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolName | string | The name of the pool |
| _poolSymbol | string | The symbol of the pool |
| _fundManagerLenderId | string | The lender id of the fund manager |
| _poolManager | address | The address of the pool manager |
| _poolToken | address | The address of the pool token |
| _oracleManager | address | The address of the oracle manager |
| _projectedAPY | uint256 | The projected APY of the pool |
| _poolSize | uint256 | The size of the pool |

### createStakingPool

```solidity
function createStakingPool(address _pool) external returns (address _stakingPool)
```

Creates a new staking pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool for which the staking pool is to be created |

### updatePoolManager

```solidity
function updatePoolManager(address _pool, address _poolManager) external
```

Updates the pool manager of a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose pool manager is to be updated |
| _poolManager | address |  |

### updatePoolSize

```solidity
function updatePoolSize(address _pool, uint256 _poolSize) external
```

Updates the pool size of a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose pool size is to be updated |
| _poolSize | uint256 |  |

### updatePoolInvestmentLimit

```solidity
function updatePoolInvestmentLimit(address _pool, uint256 _limit) external
```

Updates the pool investment limit

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose investment limit is to be updated |
| _limit | uint256 |  |

### closePool

```solidity
function closePool(address _pool) external
```

Updates the status of the pool to closed

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose status is to be updated to closed |

### addOracleManager

```solidity
function addOracleManager(address _pool, address _manager) external
```

Adds a new oracle manager to a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool to which the oracle manager is to be added |
| _manager | address |  |

### removeOracleManager

```solidity
function removeOracleManager(address _pool, address _manager) external
```

Removes an oracle manager from a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool from which the oracle manager is to be removed |
| _manager | address |  |

### updatePauseStartTime

```solidity
function updatePauseStartTime(address _pool, uint64 _pauseStartTime) external
```

Updates the pause start time of a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose pause start time is to be updated |
| _pauseStartTime | uint64 | The new pause start time |

### updatePauseDuration

```solidity
function updatePauseDuration(address _pool, uint64 _pauseDuration) external
```

Updates the pause duration of a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose pause duration is to be updated |
| _pauseDuration | uint64 | The new pause duration |

### updateNonReservePercentage

```solidity
function updateNonReservePercentage(address _pool, uint64 _percentage) external
```

Updates the reserve percentage of a pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _pool | address | The address of the pool whose reserve percentage is to be updated |
| _percentage | uint64 | The new reserve percentage |

### upgradeTarget

```solidity
function upgradeTarget(address _target, address _implementation) external
```

Updates the implementation of a proxy which maybe a pool,staking pool or fund manager

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _target | address | The address of the proxy |
| _implementation | address | The address of the new implementation |

### pauseTarget

```solidity
function pauseTarget(address _target) external
```

Pauses a target contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _target | address | The address of the target contract |

### unpauseTarget

```solidity
function unpauseTarget(address _target) external
```

Unpauses a target contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _target | address | The address of the target contract |

### emergencyWithdraw

```solidity
function emergencyWithdraw(address _target, address _token, address _to, uint256 _amount) external
```

Withdraws tokens from a target contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _target | address | The address of the target contract |
| _token | address |  |
| _to | address |  |
| _amount | uint256 |  |

### grantRoleTarget

```solidity
function grantRoleTarget(address _target, bytes32 role, address _account) external
```

Grants a role to an account in a target contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _target | address | The address of the target contract |
| role | bytes32 | The role to be granted |
| _account | address | The address of the account to which the role is to be granted |

### revokeRoleTarget

```solidity
function revokeRoleTarget(address _target, bytes32 role, address _account) external
```

Revokes a role from an account in a target contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _target | address | The address of the target contract |
| role | bytes32 | The role to be revoked |
| _account | address | The address of the account from which the role is to be revoked |

### transferAdmin

```solidity
function transferAdmin(address _newOwner) public
```

Transfers the admin role to a new account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newOwner | address | The address of the new admin |

### grantRole

```solidity
function grantRole(bytes32 role, address _account) public virtual
```

Adds a particular role on the current contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to be added |
| _account | address | The address of the account to which the role is to be added |

### revokeRole

```solidity
function revokeRole(bytes32 role, address _account) public
```

Revokes a particular role on the current contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to be revoked |
| _account | address | The address of the account from which the role is to be revoked |

### _authorizeUpgrade

```solidity
function _authorizeUpgrade(address _newImplementation) internal
```

Upgrades the implementation of the contract

_ensures that the caller is admin by using onlyRole modifier_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImplementation | address | The address of the new implementation |

## CsigmaV2FundManager

This contract manages the fund deployment and claim process for the cSigma V2 Pool Managers.

### V1PoolIsNotActive

```solidity
error V1PoolIsNotActive(string _poolId)
```

Error when v1 pool is not active

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolId | string | The ID of the V1 pool |

### InvalidV1Pool

```solidity
error InvalidV1Pool(string _poolId)
```

Error when v1 pool is invalid

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolId | string | The ID of the V1 pool |

### InvalidAllocation

```solidity
error InvalidAllocation(uint256 _allocation)
```

Error when allocation is invalid i.e., exceeds 100%

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _allocation | uint256 | The allocation percentage |

### AccessDenied

```solidity
error AccessDenied(address _account)
```

### DuplicatePool

```solidity
error DuplicatePool(string _poolId)
```

Error when pool already exists in the list

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolId | string | The ID of the V1 pool |

### factory

```solidity
address factory
```

Address of the factory contract

### pool

```solidity
address pool
```

Address of the V2 pool

### poolToken

```solidity
address poolToken
```

Address of the pool token

### diamondV1

```solidity
address diamondV1
```

Address of the V1 diamond contract

### totalAllocation

```solidity
uint16 totalAllocation
```

Total allocation of funds to V1 pools

### fundManagerLenderId

```solidity
string fundManagerLenderId
```

Lender ID of the fund manager

### v1Pools

```solidity
struct CsigmaV2FundManager.PoolInfo[] v1Pools
```

Array of V1 pool information

### PoolInfo

```solidity
struct PoolInfo {
  string v1PoolId;
  uint16 allocation;
}
```

### Claim

```solidity
struct Claim {
  struct ICsigmaV1.Request request;
  bytes32 sigR;
  bytes32 sigS;
  uint8 sigV;
}
```

### Disburse

```solidity
struct Disburse {
  uint256 v1PoolIndex;
  uint256 amount;
}
```

### AdminTransferred

```solidity
event AdminTransferred(address _oldOwner, address _newOwner)
```

Emitted when admin role is transferred to a new address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _oldOwner | address | The address of the previous admin |
| _newOwner | address | The address of the new admin |

### V1PoolAdded

```solidity
event V1PoolAdded(address _executor, uint16 _allocation, string _v1PoolId)
```

Emitted when a new V1 pool is added

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executor | address | The address of the executor adding the pool |
| _allocation | uint16 | The allocation percentage for the pool |
| _v1PoolId | string | The ID of the V1 pool added |

### V1PoolRemoved

```solidity
event V1PoolRemoved(address _executor, uint16 _allocation, string _v1PoolId)
```

Emitted when a V1 pool is removed

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executor | address | The address of the executor removing the pool |
| _allocation | uint16 | The allocation percentage of the pool |
| _v1PoolId | string | The ID of the V1 pool removed |

### V1PoolAllocationUpdated

```solidity
event V1PoolAllocationUpdated(address _executor, uint16 _prevAllocation, uint16 _newAllocation, string _v1PoolId)
```

Emitted when the allocation of a V1 pool is updated

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executor | address | The address of the executor updating the allocation |
| _prevAllocation | uint16 | The previous allocation percentage |
| _newAllocation | uint16 | The new allocation percentage |
| _v1PoolId | string | The ID of the V1 pool whose allocation is updated |

### FundDeployed

```solidity
event FundDeployed(address _executor, uint256 _amount)
```

Emitted when funds are deployed to the V1 pools

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executor | address | The address of the executor deploying the funds |
| _amount | uint256 | The total amount of funds deployed |

### FundClaimed

```solidity
event FundClaimed(address _executor, uint256 _amount)
```

Emitted when funds are claimed from the V1 pools

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executor | address | The address of the executor claiming the funds |
| _amount | uint256 | The total amount of funds claimed |

### EmergencyWithdraw

```solidity
event EmergencyWithdraw(address _token, address _to, uint256 _amount)
```

Emitted when funds are withdrawn in an emergency

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token withdrawn |
| _to | address | The address to which the funds are withdrawn |
| _amount | uint256 | The amount of funds withdrawn |

### notZeroAddress

```solidity
modifier notZeroAddress(address _account)
```

### onlyPoolManager

```solidity
modifier onlyPoolManager()
```

### constructor

```solidity
constructor() public
```

### initialize

```solidity
function initialize(address _poolToken, address _diamondV1, string _lenderId, address _pool) public
```

Initializes the contract with the required parameters

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolToken | address | The address of the pool token |
| _diamondV1 | address | The address of the V1 diamond |
| _lenderId | string | The lender ID of the fund manager |
| _pool | address | The address of the V2 pool |

### totalV1Pools

```solidity
function totalV1Pools() external view returns (uint256)
```

Returns the total number of V1 pools to which the funds are deployed

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 The number of V1 pools |

### totalAssets

```solidity
function totalAssets() public view virtual returns (uint256)
```

Returns the total assets under management

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | uint256 The total assets under management |

### addPool

```solidity
function addPool(string _v1PoolId, uint16 _allocation) external
```

Adds a new V1 pool to the fund manager

_Only the pool manager can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _v1PoolId | string | The V1 pool ID |
| _allocation | uint16 | The allocation percentage of the pool |

### removePool

```solidity
function removePool(uint256 _index) external
```

Removes a V1 pool from the fund manager

_Only the pool manager can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _index | uint256 | The index of the V1 pool |

### updatePoolAllocation

```solidity
function updatePoolAllocation(uint256 _index, uint16 _allocation) external
```

Updates the allocation of a V1 pool

_Only the pool manager can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _index | uint256 | The index of the V1 pool |
| _allocation | uint16 | The new allocation percentage of the pool |

### deployFunds

```solidity
function deployFunds() external
```

Deploys the funds to the V1 pools

_Only the pool manager can call this function_

### claimFunds

```solidity
function claimFunds(struct CsigmaV2FundManager.Claim[] _claim) external
```

Claims the funds from the V1 pools

_Only the pool manager can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _claim | struct CsigmaV2FundManager.Claim[] | The claim information |

### sendToV2Reserve

```solidity
function sendToV2Reserve(uint256 _v2Amount) external
```

Sends the funds to the V2 pool reserve

_Only the pool manager can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _v2Amount | uint256 | The amount to send to the V2 pool reserve |

### pause

```solidity
function pause() external
```

Pauses the contract

_Only the admin can call this function_

### unpause

```solidity
function unpause() external
```

Unpauses the contract

_Only the admin can call this function_

### emergencyWithdraw

```solidity
function emergencyWithdraw(address _token, address _to, uint256 _amount) external
```

Withdraws the funds from the contract

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token |
| _to | address | The address to which the funds are withdrawn |
| _amount | uint256 | The amount to withdraw |

### transferAdmin

```solidity
function transferAdmin(address _newOwner) public
```

Transfers the admin role to a new address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newOwner | address | The address of the new admin |

### grantRole

```solidity
function grantRole(bytes32 role, address _account) public virtual
```

Grants the given role to the account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to grant |
| _account | address | The address to which the role is granted |

### revokeRole

```solidity
function revokeRole(bytes32 role, address _account) public
```

Revokes the given role from the account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to revoke |
| _account | address | The address from which the role is revoked |

### _authorizeUpgrade

```solidity
function _authorizeUpgrade(address _newImplementation) internal
```

Upgrades the contract to a new implementation

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImplementation | address | The address of the new implementation |

## CsigmaV2Pool

This contract is used to manage the pool

### PoolIsNotActive

```solidity
error PoolIsNotActive()
```

_Thrown when an operation is attempted on a pool that is not active._

### InvalidPoolSize

```solidity
error InvalidPoolSize(uint256 _poolSize)
```

_Thrown when an invalid pool size is provided._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolSize | uint256 | The invalid pool size. |

### InvalidStatusUpdate

```solidity
error InvalidStatusUpdate()
```

_Thrown when an invalid status update is attempted._

### AccessDenied

```solidity
error AccessDenied(address _executor)
```

_Thrown when an address does not have access to a function._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _executor | address | The address that is denied access. |

### WithdrawalPending

```solidity
error WithdrawalPending()
```

_Thrown when a withdrawal is pending and cannot be processed._

### InvalidDepositAmount

```solidity
error InvalidDepositAmount(uint256 _assets)
```

_Thrown when an invalid deposit amount is provided._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _assets | uint256 | The invalid deposit amount. |

### ROLE_ORACLE_MANAGER

```solidity
bytes32 ROLE_ORACLE_MANAGER
```

### factory

```solidity
address factory
```

_Address of the factory contract that created this pool._

### poolManager

```solidity
address poolManager
```

_Address of the pool manager._

### fundManager

```solidity
address fundManager
```

_Address of the fund manager._

### poolToken

```solidity
address poolToken
```

_Address of the pool token contract._

### status

```solidity
enum CsigmaV2Pool.PoolStatus status
```

_Current status of the pool (Pending, Active, Closed)._

### projectedAPY

```solidity
uint256 projectedAPY
```

_Projected APY (Annual Percentage Yield) for the pool._

### poolSize

```solidity
uint256 poolSize
```

_The maximum size of the pool._

### assetUnderManagement

```solidity
uint256 assetUnderManagement
```

_The total amount of assets under management._

### initialDepositTime

```solidity
uint64 initialDepositTime
```

_Timestamp of the initial deposit into the pool._

### nonReservePercentage

```solidity
uint64 nonReservePercentage
```

_Percentage of assets that are not reserved (e.g., 9000 represents 90%)._

### pauseDuration

```solidity
uint64 pauseDuration
```

_Duration (in seconds) for the pause period._

### pauseStartTime

```solidity
uint64 pauseStartTime
```

_Start time of the current pause period._

### minimumInvestmentLimit

```solidity
uint256 minimumInvestmentLimit
```

_The minimum investment limit for the pool._

### PoolStatus

```solidity
enum PoolStatus {
  PENDING,
  ACTIVE,
  CLOSE
}
```

### OracleManagerAdded

```solidity
event OracleManagerAdded(address _account)
```

_Emitted when an Oracle Manager is added._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _account | address | The address of the added Oracle Manager. |

### OracleManagerRemoved

```solidity
event OracleManagerRemoved(address _account)
```

_Emitted when an Oracle Manager is removed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _account | address | The address of the removed Oracle Manager. |

### AdminTransferred

```solidity
event AdminTransferred(address _oldOwner, address _newOwner)
```

_Emitted when the admin role is transferred to a new address._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _oldOwner | address | The address of the previous admin. |
| _newOwner | address | The address of the new admin. |

### PoolStatusUpdated

```solidity
event PoolStatusUpdated(address _by, enum CsigmaV2Pool.PoolStatus _prevStatus, enum CsigmaV2Pool.PoolStatus _newStatus)
```

_Emitted when the pool status is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _by | address | The address initiating the update. |
| _prevStatus | enum CsigmaV2Pool.PoolStatus | The previous pool status. |
| _newStatus | enum CsigmaV2Pool.PoolStatus | The new pool status. |

### AssetUnderManagementUpdated

```solidity
event AssetUnderManagementUpdated(address _by, uint256 _prevValue, uint256 _newValue)
```

_Emitted when the asset under management is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _by | address | The address initiating the update. |
| _prevValue | uint256 | The previous value of asset under management. |
| _newValue | uint256 | The new value of asset under management. |

### SuppliedAPYUpdated

```solidity
event SuppliedAPYUpdated(address _by, uint256 _prevValue, uint256 _newValue)
```

_Emitted when the supplied APY is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _by | address | The address initiating the update. |
| _prevValue | uint256 | The previous value of the supplied APY. |
| _newValue | uint256 | The new value of the supplied APY. |

### MinimumInvestmentLimitUpdated

```solidity
event MinimumInvestmentLimitUpdated(address _by, uint256 _prevValue, uint256 _newValue)
```

_Emitted when the minimum investment limit is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _by | address | The address initiating the update. |
| _prevValue | uint256 | The previous minimum investment limit. |
| _newValue | uint256 | The new minimum investment limit. |

### EmergencyWithdraw

```solidity
event EmergencyWithdraw(address _token, address _to, uint256 _amount)
```

_Emitted when an emergency withdrawal is performed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token being withdrawn. |
| _to | address | The address to which the token is withdrawn. |
| _amount | uint256 | The amount of the token withdrawn. |

### whenNotSanctioned

```solidity
modifier whenNotSanctioned(address _user)
```

### constructor

```solidity
constructor() public
```

### initialize

```solidity
function initialize(string _poolName, string _poolSymbol, address _poolManager, address _fundManager, address _poolToken, address _oracleManager, uint256 _projectedAPY, uint256 _poolSize) public
```

This function is used to initialize the contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolName | string | The name of the pool |
| _poolSymbol | string | The symbol of the pool |
| _poolManager | address | The address of the pool manager |
| _fundManager | address | The address of the fund manager |
| _poolToken | address | The address of the pool token |
| _oracleManager | address | The address of the oracle manager |
| _projectedAPY | uint256 | The projected APY |
| _poolSize | uint256 | The size of the pool |

### totalAssets

```solidity
function totalAssets() public view virtual returns (uint256)
```

This function is used to get the total amount of the underlying asset that is “managed” by Vault

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The total assets |

### maxDeposit

```solidity
function maxDeposit(address) public view virtual returns (uint256)
```

This function returns the maximum deposit amount

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The maximum deposit amount |

### maxMint

```solidity
function maxMint(address) public view virtual returns (uint256)
```

This function returns the maximum amount of shares that can be minted

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The maximum amount of shares |

### maxWithdraw

```solidity
function maxWithdraw(address) public view virtual returns (uint256)
```

This function returns the maximum amount of assets that can be withdrawn

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The maximum amount of assets |

### maxRedeem

```solidity
function maxRedeem(address) public view virtual returns (uint256)
```

This function returns the maximum amount of shares that can be redeemed

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The maximum amount of shares |

### deposit

```solidity
function deposit(uint256 assets, address receiver) public virtual returns (uint256 shares)
```

Deposits assets into the pool and mints shares for the receiver.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| assets | uint256 | The amount of assets to deposit. |
| receiver | address | The address of the receiver. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| shares | uint256 | The amount of shares minted. |

### mint

```solidity
function mint(uint256 shares, address receiver) public virtual returns (uint256 assets)
```

Mints shares and transfers assets to the fund manager.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| shares | uint256 | The amount of shares to mint. |
| receiver | address | The address of the receiver. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| assets | uint256 | The amount of assets used to mint shares. |

### withdraw

```solidity
function withdraw(uint256 assets, address receiver, address owner) public virtual returns (uint256)
```

Withdraws assets from the pool.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| assets | uint256 | The amount of assets to withdraw. |
| receiver | address | The address of the receiver. |
| owner | address | The address of the owner of the assets. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The amount of shares burned. |

### redeem

```solidity
function redeem(uint256 shares, address receiver, address owner) public virtual returns (uint256)
```

Redeems shares from the pool.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| shares | uint256 | The amount of shares to redeem. |
| receiver | address | The address of the receiver. |
| owner | address | The address of the owner of the shares. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The amount of assets redeemed. |

### updatePoolManager

```solidity
function updatePoolManager(address _poolManager) external
```

Updates the pool manager's address.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolManager | address | The address of the new pool manager. |

### updatePoolSize

```solidity
function updatePoolSize(uint256 _poolSize) external
```

Updates the pool size limit.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _poolSize | uint256 | The new pool size. |

### updateMinimumInvestmentLimit

```solidity
function updateMinimumInvestmentLimit(uint256 _min) external
```

Updates the minimum investment limit.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _min | uint256 | The new minimum investment limit. |

### activatePool

```solidity
function activatePool() external
```

Activates the pool (changes status from pending to active).

### closePool

```solidity
function closePool() external
```

Closes the pool.

### updateAssetUnderManagement

```solidity
function updateAssetUnderManagement(uint256 _assetUnderManagement) external
```

Updates the asset under management value.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _assetUnderManagement | uint256 | The new asset under management value. |

### updateInitialDepositTime

```solidity
function updateInitialDepositTime(uint64 _time) external
```

Updates the initial deposit time.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _time | uint64 | The new initial deposit time. |

### updatePauseDuration

```solidity
function updatePauseDuration(uint64 _duration) external
```

Updates the pause duration.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _duration | uint64 | The new pause duration. |

### updatePauseStartTime

```solidity
function updatePauseStartTime(uint64 _time) external
```

Updates the pause start time.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _time | uint64 | The new pause start time. |

### updateNonReservePercentage

```solidity
function updateNonReservePercentage(uint64 _percentage) external
```

Updates the non-reserve percentage.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _percentage | uint64 | The new non-reserve percentage. |

### isOracleManager

```solidity
function isOracleManager(address _account) public view returns (bool)
```

Checks if an account is an oracle manager.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _account | address | The address of the account. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | bool | True if the account is an oracle manager, otherwise false. |

### suppliedAPY

```solidity
function suppliedAPY() public view returns (int256 APY)
```

### pause

```solidity
function pause() external
```

Pauses the contract

_Only the admin can call this function_

### unpause

```solidity
function unpause() external
```

Unpauses the contract

_Only the admin can call this function_

### addOracleManager

```solidity
function addOracleManager(address _account) public
```

Adds an oracle manager

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _account | address | The address of the oracle manager |

### removeOracleManager

```solidity
function removeOracleManager(address _account) public
```

Removes an oracle manager

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _account | address | The address of the oracle manager |

### emergencyWithdraw

```solidity
function emergencyWithdraw(address _token, address _to, uint256 _amount) external
```

Withdraws the funds from the contract

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token |
| _to | address | The address to which the funds are withdrawn |
| _amount | uint256 | The amount to withdraw |

### transferAdmin

```solidity
function transferAdmin(address _newOwner) public
```

Transfers the admin role to a new address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newOwner | address | The address of the new admin |

### grantRole

```solidity
function grantRole(bytes32 role, address _account) public virtual
```

Grants the given role to the account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to grant |
| _account | address | The address to which the role is granted |

### revokeRole

```solidity
function revokeRole(bytes32 role, address _account) public
```

Revokes the given role from the account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to revoke |
| _account | address | The address from which the role is revoked |

### _beforeTokenTransfer

```solidity
function _beforeTokenTransfer(address _from, address _to, uint256 _amount) internal
```

### _authorizeUpgrade

```solidity
function _authorizeUpgrade(address _newImplementation) internal
```

Upgrades the contract to a new implementation

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImplementation | address | The address of the new implementation |

### _requireNotPaused

```solidity
function _requireNotPaused() internal view
```

_Throws if the contract is paused._

## CsigmaV2StakingPool

This contract allows users to stake assets in the pool and earn rewards based on staking periods

### PoolIsNotActive

```solidity
error PoolIsNotActive()
```

### InvalidInputs

```solidity
error InvalidInputs(uint256 _amount, uint32 _lockingPeriodInSeconds)
```

_Error message when staking params are invalid_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _amount | uint256 | The amount of staking tokens |
| _lockingPeriodInSeconds | uint32 | The locking period in seconds |

### AlreadyStaked

```solidity
error AlreadyStaked(address _staker)
```

_Error message when user has already staked in the pool_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the user |

### NotStaked

```solidity
error NotStaked(address _staker)
```

_Error message when user tries to unstake without staking_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the user |

### NotUnlocked

```solidity
error NotUnlocked(address _staker)
```

_Error message when the user tries to unstake and the tokens are not unlocked_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the user |

### factory

```solidity
address factory
```

_The address of the factory that deployed this contract_

### stakingToken

```solidity
address stakingToken
```

_The address of the token that can be staked in this pool_

### rewardToken

```solidity
address rewardToken
```

_The address of the reward token that will be distributed to stakers_

### slice

```solidity
uint32 slice
```

_The period in seconds for each slice of the staking duration_

### maxStakeDurationAllowed

```solidity
uint32 maxStakeDurationAllowed
```

_The maximum allowed staking duration (in seconds)_

### minStakeDurationAllowed

```solidity
uint32 minStakeDurationAllowed
```

_The minimum allowed staking duration (in seconds)_

### status

```solidity
enum CsigmaV2StakingPool.PoolStatus status
```

_The current status of the staking pool_

### rewardRate

```solidity
uint256 rewardRate
```

_The reward rate (based on the amount of staked assets) for reward calculation_

### totalRewards

```solidity
uint256 totalRewards
```

_The total rewards distributed in the pool_

### stakes

```solidity
mapping(address => struct CsigmaV2StakingPool.StakeInfo) stakes
```

_Mapping of staker address to their staking information_

### payableRewards

```solidity
mapping(uint256 => uint256) payableRewards
```

_Mapping of the unlock day to the total payable rewards for that day_

### StakeInfo

```solidity
struct StakeInfo {
  uint256 amount;
  uint256 rewards;
  uint32 unlockTime;
}
```

### PoolStatus

```solidity
enum PoolStatus {
  PENDING,
  ACTIVE,
  CLOSE
}
```

### AdminTransferred

```solidity
event AdminTransferred(address _oldOwner, address _newOwner)
```

_Emitted when the admin role is transferred to a new address_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _oldOwner | address | The previous admin address |
| _newOwner | address | The new admin address |

### RewardRateUpdated

```solidity
event RewardRateUpdated(uint256 _prevRate, uint256 _newRate)
```

_Emitted when the reward rate is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevRate | uint256 | The previous reward rate |
| _newRate | uint256 | The new reward rate |

### SlicePeriodUpdated

```solidity
event SlicePeriodUpdated(uint32 _prevValue, uint256 _newValue)
```

_Emitted when the slice period is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevValue | uint32 | The previous slice period |
| _newValue | uint256 | The new slice period |

### PoolStatusUpdated

```solidity
event PoolStatusUpdated(enum CsigmaV2StakingPool.PoolStatus _prevStatus, enum CsigmaV2StakingPool.PoolStatus _newStatus)
```

_Emitted when the pool status is updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevStatus | enum CsigmaV2StakingPool.PoolStatus | The previous pool status |
| _newStatus | enum CsigmaV2StakingPool.PoolStatus | The new pool status |

### Staked

```solidity
event Staked(address _staker, uint256 _amount, uint256 _assetAmount, uint256 _rewardAmount, uint32 _lockingPeriodInSeconds)
```

_Emitted when a user stakes tokens in the pool_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the user staking the tokens |
| _amount | uint256 | The amount of staking tokens staked |
| _assetAmount | uint256 | The amount of assets converted from the staking tokens |
| _rewardAmount | uint256 | The amount of reward calculated for the staker |
| _lockingPeriodInSeconds | uint32 | The locking period for the stake in seconds |

### Unstaked

```solidity
event Unstaked(address _staker, uint256 _amount, uint256 _rewardAmount)
```

_Emitted when a user unstakes their tokens and claims their rewards_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the user unstaking the tokens |
| _amount | uint256 | The amount of staking tokens withdrawn |
| _rewardAmount | uint256 | The amount of rewards claimed |

### EmergencyWithdraw

```solidity
event EmergencyWithdraw(address _token, address _to, uint256 _amount)
```

_Emitted when tokens are withdrawn in an emergency by the admin_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token being withdrawn |
| _to | address | The address receiving the withdrawn tokens |
| _amount | uint256 | The amount of tokens withdrawn |

### MinMaxStakeDurationUpdated

```solidity
event MinMaxStakeDurationUpdated(uint32 _min, uint32 _max, uint32 _newMin, uint32 _newMax)
```

_Emitted when the minimum and maximum stake duration are updated_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _min | uint32 | The previous minimum stake duration |
| _max | uint32 | The previous maximum stake duration |
| _newMin | uint32 | The new minimum stake duration |
| _newMax | uint32 | The new maximum stake duration |

### notZeroAddress

```solidity
modifier notZeroAddress(address _account)
```

_Modifier to check that an address is not zero_

### constructor

```solidity
constructor() public
```

### initialize

```solidity
function initialize(address _admin, address _stakingToken, address _rewardToken) public
```

Initializes the contract with necessary parameters

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _admin | address | The address of the admin role |
| _stakingToken | address | The address of the staking token |
| _rewardToken | address | The address of the reward token |

### unlockDay

```solidity
function unlockDay(uint32 _unlockTime) public pure returns (uint32)
```

Calculates the number of unlock days based on the unlock time

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _unlockTime | uint32 | The unlock timestamp to be converted into days |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint32 | The number of unlock days |

### updateRewardRate

```solidity
function updateRewardRate(uint256 _rate) external
```

Updates the reward rate in the pool

_Can only be called by the admin_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _rate | uint256 | The new reward rate |

### updateSlicePeriod

```solidity
function updateSlicePeriod(uint32 _slice) external
```

Updates the slice period (used for dividing staking duration)

_Can only be called by the admin_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _slice | uint32 | The new slice period |

### updateRewardInfo

```solidity
function updateRewardInfo(uint256 _rate, uint32 _slice) external
```

Updates both the reward rate and slice period

_Can only be called by the admin_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _rate | uint256 | The new reward rate |
| _slice | uint32 | The new slice period |

### updatePoolStatus

```solidity
function updatePoolStatus(enum CsigmaV2StakingPool.PoolStatus _status) external
```

Updates the status of the staking pool (PENDING, ACTIVE, CLOSE)

_Can only be called by the admin_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _status | enum CsigmaV2StakingPool.PoolStatus | The new status of the pool |

### updateMinMaxDurationAllowed

```solidity
function updateMinMaxDurationAllowed(uint32 _min, uint32 _max) external
```

Updates the minimum and maximum stake durations allowed

_Can only be called by the admin_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _min | uint32 | The new minimum stake duration allowed |
| _max | uint32 | The new maximum stake duration allowed |

### stake

```solidity
function stake(uint256 _amount, uint32 _lockingPeriodInSeconds) external
```

Allows users to stake tokens in the pool

_Can only stake when the pool is active and they have no existing stake_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _amount | uint256 | The amount of staking tokens to stake |
| _lockingPeriodInSeconds | uint32 | The locking period in seconds for the stake |

### unStake

```solidity
function unStake() external
```

Allows users to unstake their tokens and claim rewards

_Can only unstake when the tokens are unlocked_

### emergencyWithdraw

```solidity
function emergencyWithdraw(address _token, address _to, uint256 _amount) external
```

Allows the admin to withdraw tokens in an emergency

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token to withdraw |
| _to | address | The address to transfer the withdrawn tokens |
| _amount | uint256 | The amount of tokens to withdraw |

### transferAdmin

```solidity
function transferAdmin(address _newOwner) public
```

Transfers the admin role to a new address

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newOwner | address | The address of the new admin |

### grantRole

```solidity
function grantRole(bytes32 role, address _account) public virtual
```

Grants a specific role to an account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to grant |
| _account | address | The address to grant the role to |

### revokeRole

```solidity
function revokeRole(bytes32 role, address _account) public
```

Revokes a specific role from an account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to revoke |
| _account | address | The address from which to revoke the role |

### _authorizeUpgrade

```solidity
function _authorizeUpgrade(address _newImplementation) internal
```

Authorizes the contract upgrade to a new implementation

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImplementation | address | The address of the new implementation contract |

## CsigmaV2StakingPoolExtension

This contract is used to stake assets in the pool and earn rewards. It provides staking, withdrawing, and reward claiming functionality.

### PoolIsNotActive

```solidity
error PoolIsNotActive()
```

### InvalidInputs

```solidity
error InvalidInputs(uint256 _amount, uint32 _lockingPeriodInSeconds)
```

_Error when inputs for staking are invalid._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _amount | uint256 | The amount of tokens to stake. |
| _lockingPeriodInSeconds | uint32 | The lock duration for the stake. |

### AlreadyStaked

```solidity
error AlreadyStaked(address _staker)
```

_Error when a user tries to stake but is already staked._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |

### NotStaked

```solidity
error NotStaked(address _staker)
```

_Error when a user tries to withdraw or interact with a stake but has not staked._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |

### NotUnlocked

```solidity
error NotUnlocked(address _staker)
```

_Error when a user tries to unstake before the unlock time._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |

### AlreadyClaimed

```solidity
error AlreadyClaimed(address _staker, uint256 _index)
```

_Error when a user tries to claim rewards for a stake that has already been claimed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |
| _index | uint256 | The index of the stake. |

### factory

```solidity
address factory
```

_The address of the factory that created this contract._

### stakingToken

```solidity
address stakingToken
```

_The address of the staking token (e.g., ERC20 token)._

### rewardToken

```solidity
address rewardToken
```

_The address of the reward token (e.g., ERC20 token)._

### slice

```solidity
uint32 slice
```

_The duration of a reward slice in seconds._

### maxStakeDurationAllowed

```solidity
uint32 maxStakeDurationAllowed
```

_The maximum allowed staking duration in seconds._

### minStakeDurationAllowed

```solidity
uint32 minStakeDurationAllowed
```

_The minimum allowed staking duration in seconds._

### status

```solidity
enum CsigmaV2StakingPoolExtension.PoolStatus status
```

_The current status of the pool (pending, active, or closed)._

### rewardRate

```solidity
uint256 rewardRate
```

_The rate at which rewards are earned per token staked._

### totalRewards

```solidity
uint256 totalRewards
```

_The total rewards accumulated for the pool._

### stakes

```solidity
mapping(address => struct CsigmaV2StakingPoolExtension.StakeInfo[]) stakes
```

_A mapping of stakers to their respective stakes._

### payableRewards

```solidity
mapping(uint256 => uint256) payableRewards
```

_A mapping of unlock days to the rewards payable on that day._

### StakeInfo

```solidity
struct StakeInfo {
  uint256 amount;
  uint256 rewards;
  uint32 unlockTime;
  bool isClaimed;
}
```

### PoolStatus

```solidity
enum PoolStatus {
  PENDING,
  ACTIVE,
  CLOSE
}
```

### AdminTransferred

```solidity
event AdminTransferred(address _oldOwner, address _newOwner)
```

_Emitted when the admin (owner) of the contract is changed._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _oldOwner | address | The previous admin address. |
| _newOwner | address | The new admin address. |

### RewardRateUpdated

```solidity
event RewardRateUpdated(uint256 _prevRate, uint256 _newRate)
```

_Emitted when the reward rate is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevRate | uint256 | The previous reward rate. |
| _newRate | uint256 | The new reward rate. |

### SlicePeriodUpdated

```solidity
event SlicePeriodUpdated(uint32 _prevValue, uint256 _newValue)
```

_Emitted when the slice period is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevValue | uint32 | The previous slice period. |
| _newValue | uint256 | The new slice period. |

### PoolStatusUpdated

```solidity
event PoolStatusUpdated(enum CsigmaV2StakingPoolExtension.PoolStatus _prevStatus, enum CsigmaV2StakingPoolExtension.PoolStatus _newStatus)
```

_Emitted when the pool status is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _prevStatus | enum CsigmaV2StakingPoolExtension.PoolStatus | The previous pool status. |
| _newStatus | enum CsigmaV2StakingPoolExtension.PoolStatus | The new pool status. |

### Staked

```solidity
event Staked(address _staker, uint256 _amount, uint256 _assetAmount, uint256 _rewardAmount, uint32 _lockingPeriodInSeconds)
```

_Emitted when a user stakes tokens into the pool._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |
| _amount | uint256 | The amount of staking tokens deposited. |
| _assetAmount | uint256 | The converted asset amount. |
| _rewardAmount | uint256 | The reward amount earned from staking. |
| _lockingPeriodInSeconds | uint32 | The lock duration for the stake in seconds. |

### Unstaked

```solidity
event Unstaked(address _staker, uint256 _amount, uint256 _rewardAmount)
```

_Emitted when a user unstakes tokens and claims their rewards._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |
| _amount | uint256 | The amount of staking tokens withdrawn. |
| _rewardAmount | uint256 | The amount of rewards withdrawn. |

### EmergencyWithdraw

```solidity
event EmergencyWithdraw(address _token, address _to, uint256 _amount)
```

_Emitted when emergency withdrawals of tokens occur._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token being withdrawn. |
| _to | address | The address to which the tokens are sent. |
| _amount | uint256 | The amount of tokens being withdrawn. |

### MinMaxStakeDurationUpdated

```solidity
event MinMaxStakeDurationUpdated(uint32 _min, uint32 _max, uint32 _newMin, uint32 _newMax)
```

_Emitted when the min/max stake duration is updated._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _min | uint32 | The old minimum stake duration. |
| _max | uint32 | The old maximum stake duration. |
| _newMin | uint32 | The new minimum stake duration. |
| _newMax | uint32 | The new maximum stake duration. |

### notZeroAddress

```solidity
modifier notZeroAddress(address _account)
```

_Ensures the provided address is not zero._

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _account | address | The address to check. |

### constructor

```solidity
constructor() public
```

### initialize

```solidity
function initialize(address _admin, address _stakingToken, address _rewardToken) public
```

This function is used to initialize the contract

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _admin | address | The address of the admin |
| _stakingToken | address | The address of the staking token |
| _rewardToken | address | The address of the reward token |

### unlockDay

```solidity
function unlockDay(uint32 _unlockTime) public pure returns (uint32)
```

Converts a given unlock time to the corresponding day.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _unlockTime | uint32 | The unlock time in seconds. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint32 | The day corresponding to the given unlock time. |

### numberOfStakes

```solidity
function numberOfStakes(address _staker) external view returns (uint256)
```

Returns the number of stakes a specific address has.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | uint256 | The number of stakes held by the staker. |

### allStakes

```solidity
function allStakes(address _staker) external view returns (struct CsigmaV2StakingPoolExtension.StakeInfo[])
```

Returns all stake information for a specific address.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _staker | address | The address of the staker. |

#### Return Values

| Name | Type | Description |
| ---- | ---- | ----------- |
| [0] | struct CsigmaV2StakingPoolExtension.StakeInfo[] | A list of all stakes for the given address. |

### updateRewardRate

```solidity
function updateRewardRate(uint256 _rate) external
```

Updates the reward rate for the staking pool.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _rate | uint256 | The new reward rate. |

### updateSlicePeriod

```solidity
function updateSlicePeriod(uint32 _slice) external
```

Updates the slice period (duration of a reward slice).

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _slice | uint32 | The new slice period. |

### updateRewardInfo

```solidity
function updateRewardInfo(uint256 _rate, uint32 _slice) external
```

Updates both the reward rate and the slice period in a single call.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _rate | uint256 | The new reward rate. |
| _slice | uint32 | The new slice period. |

### updatePoolStatus

```solidity
function updatePoolStatus(enum CsigmaV2StakingPoolExtension.PoolStatus _status) external
```

Updates the status of the staking pool.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _status | enum CsigmaV2StakingPoolExtension.PoolStatus | The new status of the pool. |

### updateMinMaxDurationAllowed

```solidity
function updateMinMaxDurationAllowed(uint32 _min, uint32 _max) external
```

Updates the minimum and maximum allowed stake durations.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _min | uint32 | The new minimum stake duration. |
| _max | uint32 | The new maximum stake duration. |

### deposit

```solidity
function deposit(uint256 _amount, uint32 _lockingPeriodInSeconds) external
```

### stake

```solidity
function stake(uint256 _amount, uint32 _lockingPeriodInSeconds) external
```

This function is used to stake the assets in the pool

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _amount | uint256 | The amount of staking token to stake |
| _lockingPeriodInSeconds | uint32 | The locking period in seconds |

### withdrawBatch

```solidity
function withdrawBatch(uint256[] _index) external
```

Allows users to withdraw multiple stakes in a single transaction.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _index | uint256[] | The indices of the stakes to withdraw. |

### withdraw

```solidity
function withdraw(uint256 _index) public
```

Allows users to withdraw their stake and claim rewards.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _index | uint256 | The index of the stake to withdraw. |

### unStake

```solidity
function unStake(uint256 _index) external
```

Allows users to unstake the entire position from the pool and claim rewards.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _index | uint256 | The index of the stake to unstake. |

### emergencyWithdraw

```solidity
function emergencyWithdraw(address _token, address _to, uint256 _amount) external
```

Allows admin to withdraw tokens from the pool in case of emergency.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _token | address | The address of the token to withdraw. |
| _to | address | The address to send the withdrawn tokens. |
| _amount | uint256 | The amount of tokens to withdraw. |

### transferAdmin

```solidity
function transferAdmin(address _newOwner) public
```

Allows admin to transfer ownership to a new address.

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newOwner | address | The new admin address. |

### grantRole

```solidity
function grantRole(bytes32 role, address _account) public virtual
```

This function is used to grant a role to the account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to grant |
| _account | address | The address to which the role should be granted |

### revokeRole

```solidity
function revokeRole(bytes32 role, address _account) public
```

This function is used to revoke a role from the account

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| role | bytes32 | The role to revoke |
| _account | address | The address from which the role should be revoked |

### _authorizeUpgrade

```solidity
function _authorizeUpgrade(address _newImplementation) internal
```

Upgrades the contract to a new implementation

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImplementation | address | The address of the new implementation |


## CsigmaV2WithdrawalManager

This contract manages the fund repayed using a queue system

### WithdrawalRequest

```solidity
struct WithdrawalRequest {
  uint256 pendingCTokenAmount;
  uint256 cummulativeCTokenAmount;
  uint256 fulfilledAmount;
  address receiver;
  bool hasEverBeenPartiallyFulfilled;
}
```

### RepaymentData

```solidity
struct RepaymentData {
  uint256 queuePosition;
  uint256 exchangeRatio;
}
```

### underlyingToken

```solidity
contract IERC20 underlyingToken
```

### cToken

```solidity
contract IERC4626 cToken
```

### currentQueuePosition

```solidity
uint256 currentQueuePosition
```

### fulfilledQueuePosition

```solidity
uint256 fulfilledQueuePosition
```

### totalDueCToken

```solidity
uint256 totalDueCToken
```

### repaymentData

```solidity
struct CsigmaV2WithdrawalManager.RepaymentData[] repaymentData
```

### withdrawalQueue

```solidity
mapping(uint256 => struct CsigmaV2WithdrawalManager.WithdrawalRequest) withdrawalQueue
```

### initialize

```solidity
function initialize(address _underlyingToken, address _cToken) public
```

The role that allows the admin to pause the contract

### requestWithdrawal

```solidity
function requestWithdrawal(uint256 _cTokenAmount, address receiver) external
```

### collectDue

```solidity
function collectDue(uint256 queuePosition, uint256 repaymentDataIndex) external
```

### repay

```solidity
function repay(uint256 uptoQueuePosition, uint256 amount) external
```

### _authorizeUpgrade

```solidity
function _authorizeUpgrade(address _newImplementation) internal
```

Upgrades the contract to a new implementation

_Only the admin can call this function_

#### Parameters

| Name | Type | Description |
| ---- | ---- | ----------- |
| _newImplementation | address | The address of the new implementation |

