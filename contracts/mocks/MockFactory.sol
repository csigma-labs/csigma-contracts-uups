pragma solidity 0.8.9;

interface Iv2Pool {
    function initialize(
        string calldata _poolName,
        string calldata _poolSymbol,
        address _poolManager,
        address _fundManager,
        address _poolToken,
        address _oracleManager,
        uint256 _projectedAPY,
        uint256 _poolSize
    ) external;

    function emergencyUpdateAUM(uint256 _assetUnderManagement) external;

    function burnFromBlacklist(address _account, uint256 _amount) external;
}

interface IPermissionedV2Pool {
    function initialize(
        string calldata _poolName,
        string calldata _poolSymbol,
        address _poolManager,
        address _fundManager,
        address _poolToken,
        address _oracleManager,
        uint256 _poolSize
    ) external;
    
    function activatePool() external;
    function emergencyUpdateAUM(uint256 _assetUnderManagement) external;
    function burnFromBlacklist(address _account, uint256 _amount) external;
    function setWithdrawalManager(address _withdrawalManager) external;
}

interface IAccessControl {
    function pause() external;
    function unpause() external;
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external;
    function grantRole(bytes32 role, address _account) external;
    function revokeRole(bytes32 role, address _account) external;
}

contract MockFactory{

    address public chainalysis;
    address public diamondV1;

    /// @notice Simulates the real factory's isPoolManager registry so tests can exercise
    ///         CsigmaPermissionedPool.updatePoolManager's verification gate.
    mapping(address => bool) public isPoolManager;

    function setPoolManager(address _addr, bool _verified) external {
        isPoolManager[_addr] = _verified;
    }

    function initializePool(
        address pool,
        string calldata _poolName,
        string calldata _poolSymbol,
        address _poolManager,
        address _fundManager,
        address _poolToken,
        address _oracleManager,
        uint256 _projectedAPY,
        uint256 _poolSize
    ) external {
        Iv2Pool(pool).initialize(_poolName, _poolSymbol, _poolManager, _fundManager, _poolToken, _oracleManager, _projectedAPY, _poolSize);
    }

    function initializePermissionedPool(
        address pool,
        string calldata _poolName,
        string calldata _poolSymbol,
        address _poolManager,
        address _fundManager,
        address _poolToken,
        address _oracleManager,
        uint256 _poolSize
    ) external {
        IPermissionedV2Pool(pool).initialize(_poolName, _poolSymbol, _poolManager, _fundManager, _poolToken, _oracleManager, _poolSize);
    }

    /// @notice Activate permissioned pool (factory calls this)
    function activatePool(address _pool) external {
        IPermissionedV2Pool(_pool).activatePool();
    }

    /// @notice Emergency update AUM on pool
    function emergencyUpdateAUM(address _pool, uint256 _assetUnderManagement) external {
        IPermissionedV2Pool(_pool).emergencyUpdateAUM(_assetUnderManagement);
    }

    /// @notice Burn LP tokens from blacklisted address (old pools)
    function burnFromBlacklist(address _pool, address _account, uint256 _amount) external {
        IPermissionedV2Pool(_pool).burnFromBlacklist(_account, _amount);
    }


    function setChainAnalysis(address newChainAnalysis) external {
        chainalysis = newChainAnalysis;
    }

    /// @notice Set Diamond V1 registry address (for new permissioned pools)
    function setDiamondV1(address _diamondV1) external {
        diamondV1 = _diamondV1;
    }

    function setWithdrawalManager(address _pool, address _withdrawalManager) external {
        IPermissionedV2Pool(_pool).setWithdrawalManager(_withdrawalManager);
    }

    function grantRoleTarget(address _target, bytes32 role, address _account) external {
        IAccessControl(_target).grantRole(role, _account);
    }

    function revokeRoleTarget(address _target, bytes32 role, address _account) external {
        IAccessControl(_target).revokeRole(role, _account);
    }

    function pauseTarget(address _target) external {
        IAccessControl(_target).pause();
    }

    function unpauseTarget(address _target) external {
        IAccessControl(_target).unpause();
    }
}