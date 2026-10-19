// SPDX-License-Identifier: unlicensed
pragma solidity 0.8.20;

import { MessagingFee, SendParam, MessagingReceipt, OFTReceipt } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/interfaces/IOFT.sol";
import { ILayerZeroComposer } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroComposer.sol";
import { OFTComposeMsgCodec } from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/libs/OFTComposeMsgCodec.sol";
import { Ticket } from "@stargatefinance/stg-evm-v2/src/interfaces/IStargate.sol";

contract MockStargate {

    event SendParamReceived(
        uint32 indexed dstEid,
        bytes32 indexed to,
        uint256 amountLD,
        uint256 minAmountLD
    );

    event FeeReceived(
        address indexed feeRefundAddress,
        uint256 nativeFee,
        uint256 lzTokenFee,
        uint256 msgValue
    );

    event Deposit(
        uint256 amountLD,
        address to
    );

    function sendToken (
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _feeRefundAddress
    ) external payable returns (MessagingReceipt memory msgReceipt, OFTReceipt memory oftReceipt, Ticket memory ticket) {
        emit SendParamReceived(
            _sendParam.dstEid,
            _sendParam.to,
            _sendParam.amountLD,
            _sendParam.minAmountLD
        );
        emit FeeReceived(
            _feeRefundAddress,
            _fee.nativeFee,
            _fee.lzTokenFee,
            msg.value
        );
    }

    function lzCompose(
        address _from,
        address _to,
        uint256 _amountLD,
        address masterPool,
        address receiver
    ) external {
        ILayerZeroComposer lzComposer = ILayerZeroComposer(_to);
        lzComposer.lzCompose(
            _from,
            bytes32(0),
            OFTComposeMsgCodec.encode(
                0,
                40150,
                _amountLD,
                abi.encode(
                    address(uint160(2**160 - 1)),
                    masterPool,
                    receiver
                )
            ),
            msg.sender,
            bytes("")
        );
    }

    function deposit(uint256 _amountLD, address _to) external returns (uint256) {
        emit Deposit(
            _amountLD,
            _to
        );
        return 0;
    }

    function asset() external view returns (address) {
        return address(this);
    }

    function approve(address, uint256) external returns (bool) {
        return true;
    }

    function allowance(
        address ,
        address 
    ) external view returns (uint256) {
        return 0;
    }

    function transferFrom(
        address ,
        address ,
        uint256 
    ) external returns (bool) {
        return true;
    }

    function LPToken() external view returns (address) {
        return address(this);
    }

    function underlyingToken() external view returns (address) {
        return address(this);
    }

    function requestWithdraw(
        uint256 _LPTokenAmount,
        address ,
        address 
    ) external returns (uint256) {
        return _LPTokenAmount;
    }

    function claim(
        uint256 ,
        uint256 
    ) external returns (address, uint256) {
        return (owner, amount);
    }

    function transfer(
        address ,
        uint256 
    ) external returns (bool) {
        return true;
    }

    address public owner;
    uint256 public amount;

    function setOwner(address _owner) external {
        owner = _owner;
    }
    function setAmount(uint256 _amount) external {
        amount = _amount;
    }
}