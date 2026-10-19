// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.20;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

import { IStargate, MessagingFee, OFTReceipt, SendParam } from "@stargatefinance/stg-evm-v2/src/interfaces/IStargate.sol";
import { ILayerZeroComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroComposer.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/libs/OFTComposeMsgCodec.sol";
import { OptionsBuilder } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/libs/OptionsBuilder.sol";

interface ICsigmaV2WithdrawalManager {
    function LPToken() external view returns (address);
    function underlyingToken() external view returns (address);
    function requestWithdrawal(uint256 _LPTokenAmount, address _owner, address _receiver) external returns (uint256 amountReceived);
    function claim(uint256 queuePosition, uint256 repaymentDataIndex) external returns (address owner, uint256 claimedAmount);
}

contract CsigmaRouter is 
    ILayerZeroComposer,
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    mapping(address => bool) public whitelistedBridges; 
    mapping(address => address) public stargatePool; // token => stargatePool

    event EmergencyWithdraw(address indexed _token, address indexed _to, uint256 _amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the contract
    /// @param _admin The address of the admin
    /// @param _endpoint The address of the LayerZeroV2 endpoint
    /// @param supportedToken The list of supported tokens
    /// @param _stargatePool The list of stargate pools for respective tokens
    function initialize(
        address _admin, 
        address _endpoint, 
        address[] calldata supportedToken, 
        address[] calldata _stargatePool
    ) external initializer{        
        __AccessControl_init();
        __UUPSUpgradeable_init();
        
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        whitelistedBridges[_endpoint] = true;
        for(uint256 i = 0; i < supportedToken.length; i++) {
            stargatePool[supportedToken[i]] = _stargatePool[i];
        }
    }    
    
    /// @notice This function is used to receive the message from the LayerZero endpoint
    /// @param _from The address of the sender (Stargate pool)
    /// @param _message The encoded message which contains the address of LP token and the receiver address
    function lzCompose(
        address _from,
        bytes32,
        bytes calldata _message,
        address,
        bytes calldata
    ) external payable {
        require(whitelistedBridges[msg.sender], "!endpoint");

        uint256 amountLD = OFTComposeMsgCodec.amountLD(_message);
        bytes memory payload = OFTComposeMsgCodec.composeMsg(_message);
        (address masterPool, address receiver) = abi.decode(payload, (address, address));
        address _token = IERC4626(masterPool).asset();

        require(_from == stargatePool[_token], "Invalid caller");
        SafeERC20.forceApprove(IERC20(_token), masterPool, amountLD);

        try 
            IERC4626(masterPool).deposit(amountLD, receiver) {

        } catch {
            SafeERC20.safeTransfer(IERC20(_token), receiver, amountLD);
        }
    }

    /// @notice This function is used to bridge assets from one chain to another
    /// @dev The function will revert if the token is not supported or if the amount is zero
    /// @param _withdrawalManager The address of the withdrawal manager
    /// @param _LPTokenAmount The amount of LP tokens to withdraw
    /// @param _dstChainId The chain id of the destination chain
    /// @param _slippage The slippage percentage acceptable by the user for the bridge transaction multiplied by 100
    /// @param _feeRefundAddress The address to refund the native gas fee
    /// @param _to The address to which the assets should be transferred
    function requestWithdrawAndBridge(
        address _withdrawalManager,
        uint256 _LPTokenAmount,
        uint32 _dstChainId,
        uint256 _slippage,
        address _feeRefundAddress,
        address _to
    ) external payable {

        require(_to != address(0), "Invalid receiver address");
        require(_feeRefundAddress != address(0), "Invalid fee refund address");

        ICsigmaV2WithdrawalManager withdrawManager = ICsigmaV2WithdrawalManager(_withdrawalManager);
        IERC20 LPToken = IERC20(withdrawManager.LPToken());
        LPToken.transferFrom(msg.sender, address(this), _LPTokenAmount);
        LPToken.approve(_withdrawalManager, _LPTokenAmount);
        
        address _token = withdrawManager.underlyingToken();
        uint256 _amountLD = withdrawManager.requestWithdrawal(_LPTokenAmount, msg.sender, address(this));
        uint256 _minAmountLD = (_amountLD * (10000 - _slippage)) / 10000;
        if(_amountLD > 0)
            _bridge(_dstChainId, _token, _amountLD, _minAmountLD, _feeRefundAddress, _to);        
    }

    /// @notice This function is used to claim the assets from the withdrawal manager and bridge them to another chain
    /// @dev The function will revert if the queue position is not valid or if the repayment data index is not valid
    /// @param _withdrawalManager The address of the withdrawal manager
    /// @param _queuePosition The queue position of the withdrawal request
    /// @param _repaymentDataIndex The index of the repayment data
    /// @param _dstChainId The chain id of the destination chain
    /// @param _slippage The slippage percentage acceptable by the user for the bridge transaction multiplied by 100
    /// @param _feeRefundAddress The address to refund the native gas fee
    /// @param _to The address to which the assets should be transferred
    function claimAndBridge(
        address _withdrawalManager,
        uint256 _queuePosition,
        uint256 _repaymentDataIndex,
        uint32 _dstChainId,
        uint256 _slippage,
        address _feeRefundAddress,
        address _to
    ) external payable {
        require(_to != address(0), "Invalid receiver address");
        require(_feeRefundAddress != address(0), "Invalid fee refund address");

        ICsigmaV2WithdrawalManager withdrawManager = ICsigmaV2WithdrawalManager(_withdrawalManager);
        address _token = withdrawManager.underlyingToken();
        (address owner, uint256 _amountLD) = withdrawManager.claim(_queuePosition, _repaymentDataIndex);
        require(owner == msg.sender, "Not the owner of the queue position");
        uint256 _minAmountLD = (_amountLD * (10000 - _slippage)) / 10000;
        require(_amountLD > 0, "No amount to claim");

        _bridge(_dstChainId, _token, _amountLD, _minAmountLD, _feeRefundAddress, _to);        
    }

    /// @notice This function is used to redeem the LP tokens and bridge the underlying assets to another chain
    /// @dev The function will revert if the LP token is not supported or if the amount is zero
    /// @param _LPToken The address of the LP token vault to redeem
    /// @param _LPTokenAmount The amount of LP tokens to redeem
    /// @param _dstChainId The chain id of the destination chain
    /// @param _slippage The slippage percentage acceptable by the user for the bridge transaction multiplied by 100
    /// @param _feeRefundAddress The address to refund the native gas fee
    /// @param _to The address to which the assets should be transferred
    function redeemAndBridge(
        address _LPToken,
        uint256 _LPTokenAmount,
        uint32 _dstChainId,
        uint256 _slippage,
        address _feeRefundAddress,
        address _to
    ) external payable {
        require(_to != address(0), "Invalid receiver address");
        require(_feeRefundAddress != address(0), "Invalid fee refund address");

        IERC4626 LPToken = IERC4626(_LPToken);
        address _token = LPToken.asset();
        uint256 _amountLD = LPToken.redeem(_LPTokenAmount, address(this), msg.sender);
        uint256 _minAmountLD = (_amountLD * (10000 - _slippage)) / 10000;
        require(_amountLD > 0, "No amount to redeem");
    
        _bridge(_dstChainId, _token, _amountLD, _minAmountLD, _feeRefundAddress, _to);
    }

    /// @notice This function is used to withdraw the assets from the pool in case of emergency
    /// @dev Only admin can call this function
    /// @param _token The address of the token to withdraw
    /// @param _to The address to which the assets should be transferred
    /// @param _amount The amount of assets to withdraw
    function emergencyWithdraw(address _token, address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SafeERC20.safeTransfer(IERC20(_token), _to, _amount);
        emit EmergencyWithdraw(_token, _to, _amount);
    }

    /// @notice This function is used to relay the transaction to the composer
    /// @param _dstChainId The chain id of the destination chain
    /// @param token The address of the token to bridge
    /// @param _amountLD The amount of assets to bridge in local decimals
    /// @param _minAmountLD The minimum amount of assets to receive in local decimals
    /// @param _feeRefundAddress The address to refund the native gas fee
    /// @param _to The address to which the assets should be transferred
    function _bridge(
        uint32 _dstChainId,
        address token,
        uint256 _amountLD,
        uint256 _minAmountLD,
        address _feeRefundAddress,
        address _to
    ) internal {
        IStargate stargate = IStargate(stargatePool[token]);
        SafeERC20.forceApprove(IERC20(token), address(stargate), _amountLD);
        SendParam memory sendParam = SendParam({
            dstEid: _dstChainId,
            to: bytes32(uint256(uint160(_to))),
            amountLD: _amountLD,
            minAmountLD: _minAmountLD,
            extraOptions: bytes(""),
            composeMsg: bytes(""),
            oftCmd: bytes("")
        });

        MessagingFee memory messagingFee = MessagingFee({
            nativeFee: msg.value,
            lzTokenFee: 0
        });
        IStargate(stargate).sendToken{ value: msg.value }(sendParam, messagingFee, _feeRefundAddress); 
    }

    /// @notice This function is used to add/remove the supported tokens
    /// @dev Only admin can call this function
    /// @param _token The address of the token to add/remove
    /// @param _stargatePool The address of the stargate pool, address(0) to remove
    function updateTokenSupport(address _token, address _stargatePool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stargatePool[_token] = _stargatePool;
    }

    function updateWhitelistedBridge(address _bridgeAddress, bool _status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedBridges[_bridgeAddress] = _status;
    }

    /// @notice Upgrades the contract to a new implementation
    /// @dev Only the admin can call this function
    /// @param _newImplementation The address of the new implementation
    function _authorizeUpgrade(address _newImplementation) 
        internal 
        override 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {}

    /// @notice Adds an executor LZ compose option to the existing options.
    /// @param _index The index for the lzCompose() function call.
    /// @param _gas The gasLimit for the lzCompose() function call.
    /// @return option The updated options container.
    /// @return length The length of the option.
    function buildOption(uint16 _index, uint128 _gas) external pure returns (bytes memory option, uint256 length) {
        bytes memory t1 = abi.encodePacked(_index, _gas);
        return (abi.encodePacked(
                abi.encodePacked(uint16(3)),
                uint8(1),
                uint16(t1.length) + 1,
                abi.encodePacked(uint8(3)),
                t1
            ), t1.length);
    }
}