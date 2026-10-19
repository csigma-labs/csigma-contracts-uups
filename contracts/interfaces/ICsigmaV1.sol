// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

interface ICsigmaV1 {
    
    struct Request {
        uint256 nonce;
        string roleId;
        string poolId;
        PaymentInfo[] paymentInfo;
    }

    struct PaymentInfo {
        uint256 amount;
        PaymentType paymentType;
    }
    
    enum PaymentType {INVESTMENT, PANDC, DEPOSIT, WITHDRAW, FEE, EXIT, PRINCIPAL, COUPON, PASTDUE}

    enum CreditPoolStatus {PENDING, ACTIVE, INACTIVE}

    enum KYBStatus {PENDING, VERIFIED, REJECTED}

    function getPoolToken(string calldata _poolId) external view returns (address);

    function getCreditPoolStatus(string calldata _poolId) external view returns (CreditPoolStatus);

    function getTokenBalance(string calldata _roleId, address _token) external view returns (uint256);
    
    function deposit(
        string calldata _roleId,
        address _token,
        uint256 _amount
    ) external returns (string memory);

    function invest(
        string calldata _roleId,
        string calldata _poolId,
        uint256 _amount
    ) external;

    function withdrawRequest(
        string calldata _roleId,
        address _token,
        uint256 _amount
    ) external returns(bool _isWithdrawn);

    function withdrawPoolPaymentIntoVault(
        Request calldata _request,
        bytes32 _sigR,
        bytes32 _sigS,
        uint8 _sigV
    ) external;

    function getPoolManagerWallet(string calldata _poolManagerId) external view returns (address);

    function getPoolManagerKYBStatus(string calldata _poolManagerId) external view returns (KYBStatus);

    function getLenderWallet(string calldata _lenderId) external view returns (address);

    function getLenderKYBStatus(string calldata _lenderId) external view returns (KYBStatus);

    function isLenderWalletWhitelisted(string calldata _lenderId, address _wallet) external view returns (bool);

    function getChildPoolManagerId(string calldata _childPoolId) external view returns (string memory);

    function getChildPoolType(string calldata _childPoolId) external view returns (uint8);

    function childPoolExists(string calldata _childPoolId) external view returns (bool);

    function owner() external view returns (address);
}
