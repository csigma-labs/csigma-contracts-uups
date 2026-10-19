pragma solidity 0.8.9;

import "../interfaces/ICsigmaV1.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockV1 is ICsigmaV1 {

    struct PoolManagerData {
        address wallet;
        KYBStatus kybStatus;
    }

    struct LenderData {
        address wallet;
        KYBStatus kybStatus; // Using KYBStatus for lenders too (as per interface)
    }

    struct ChildPoolData {
        string poolId;
        string poolManagerId;
        uint8 poolType;
        bool exists;
    }

    mapping(string => PoolManagerData) private poolManagers;
    
    mapping(string => LenderData) private lenders;
    mapping(string => mapping(address => bool)) private lenderWallets;
    
    mapping(string => ChildPoolData) private childPools;

    mapping(string => ICsigmaV1.CreditPoolStatus) public poolStatus;
    
    address public poolToken;

    function getTokenBalance(string calldata, address _token) external view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }

    function getCreditPoolStatus(string calldata _poolId) external view returns (ICsigmaV1.CreditPoolStatus) {
        return poolStatus[_poolId];
    }

    function setPoolStatus(string calldata _poolId, ICsigmaV1.CreditPoolStatus _status) external {
        poolStatus[_poolId] = _status;
    }

    function deposit(
        string calldata,
        address _token,
        uint256 _amount
    ) external returns (string memory) {
        IERC20(_token).transferFrom(msg.sender, address(this), _amount);
    }

    function invest(
        string calldata _roleId,
        string calldata _poolId,
        uint256 _amount
    ) external {
    }

    function getPoolToken(string calldata) external view returns (address) {
        return poolToken;
    }

    function setPoolToken(address _poolToken) external {
        poolToken = _poolToken;
    }

    function withdrawPoolPaymentIntoVault(
        ICsigmaV1.Request calldata _request,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external {
    }

    function withdrawRequest(
        string calldata,
        address token,
        uint256 amount
    ) external returns(bool) {
        IERC20(token).transfer(msg.sender, amount);
    }

    function setPoolManagerData(
        string calldata _poolManagerId,
        address _wallet,
        KYBStatus _status
    ) external {
        poolManagers[_poolManagerId] = PoolManagerData({
            wallet: _wallet,
            kybStatus: _status
        });
    }

    function getPoolManagerWallet(string calldata _poolManagerId) 
        external 
        view 
        override 
        returns (address) 
    {
        return poolManagers[_poolManagerId].wallet;
    }

    function getPoolManagerKYBStatus(string calldata _poolManagerId) 
        external 
        view 
        override 
        returns (KYBStatus) 
    {
        return poolManagers[_poolManagerId].kybStatus;
    }

    function setLenderData(
        string calldata _lenderId,
        address _wallet,
        KYBStatus _status
    ) external {
        lenders[_lenderId] = LenderData({
            wallet: _wallet,
            kybStatus: _status
        });
    }

    function addLenderWallet(
        string calldata _lenderId,
        address _wallet
    ) external {
        lenderWallets[_lenderId][_wallet] = true;
    }

    function removeLenderWallet(
        string calldata _lenderId,
        address _wallet
    ) external {
        lenderWallets[_lenderId][_wallet] = false;
    }

    function getLenderWallet(string calldata _lenderId) 
        external 
        view 
        override 
        returns (address) 
    {
        return lenders[_lenderId].wallet;
    }

    function getLenderKYBStatus(string calldata _lenderId) 
        external 
        view 
        override 
        returns (KYBStatus) 
    {
        return lenders[_lenderId].kybStatus;
    }

    function isLenderWalletWhitelisted(
        string calldata _lenderId,
        address _wallet
    ) external view override returns (bool) {
        return lenderWallets[_lenderId][_wallet];
    }

    function setChildPoolData(
        string calldata _childPoolId,
        string calldata _poolManagerId,
        uint8 _poolType
    ) external {
        childPools[_childPoolId] = ChildPoolData({
            poolId: _childPoolId,
            poolManagerId: _poolManagerId,
            poolType: _poolType,
            exists: true
        });
    }

    function getChildPoolManagerId(string calldata _childPoolId) 
        external 
        view 
        override 
        returns (string memory) 
    {
        require(childPools[_childPoolId].exists, "Child pool does not exist");
        return childPools[_childPoolId].poolManagerId;
    }

    function getChildPoolType(string calldata _childPoolId) 
        external 
        view 
        override 
        returns (uint8) 
    {
        require(childPools[_childPoolId].exists, "Child pool does not exist");
        return childPools[_childPoolId].poolType;
    }

    function childPoolExists(string calldata _childPoolId) 
        external 
        view 
        override 
        returns (bool) 
    {
        return childPools[_childPoolId].exists;
    }

    address public owner;
    function setDiamondOwner(address _owner) external {
        owner = _owner;
    }
}