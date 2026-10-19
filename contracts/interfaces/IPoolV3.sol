// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.26;

interface IPoolV3 {
    enum PoolStatus { PENDING, ACTIVE, CLOSE }

    function status() external view returns (PoolStatus);
    function fundManager() external view returns (address);
    function pauseStartTime() external view returns (uint64);
    function pauseDuration() external view returns (uint64);
    function paused() external view returns (bool) ;
    function totalAssets() external view returns (uint256);
}
