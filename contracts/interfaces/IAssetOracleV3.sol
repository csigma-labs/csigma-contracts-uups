// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.20;

interface IAssetOracleV3 {
    function getAssetUnderManagement(address _pool) external view returns (uint256);
}
