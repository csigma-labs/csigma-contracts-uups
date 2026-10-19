// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockPoolV3 {
    address public fundManager;
    uint256 private _totalAssets;
    uint8 private _status;
    bool private _paused;
    uint64 private _pauseStartTime;
    uint64 private _pauseDuration;
    address public poolToken;
    address public poolManager;

    constructor() {
        fundManager = msg.sender;
        _status = 1; // ACTIVE by default
        _paused = true;
    }

    function totalAssets() external view returns (uint256) {
        return _totalAssets;
    }

    function setTotalAssets(uint256 amount) external {
        _totalAssets = amount;
    }

    function setStatus(uint8 status_) external {
        _status = status_;
    }

    function status() external view returns (uint8) {
        return _status;
    }

    function pauseStartTime() external view returns (uint64) {
        return _pauseStartTime;
    }

    function pauseDuration() external view returns (uint64) {
        return _pauseDuration;
    }

    function setPauseConfig(uint64 startTime, uint64 duration) external {
        _pauseStartTime = startTime;
        _pauseDuration = duration;
    }

    function paused() external view returns (bool) {
        return _paused;
    }

    function setPaused(bool _p) external {
        _paused = _p;
    }

    function setPoolToken(address _token) external {
        poolToken = _token;
    }

    function setPoolManager(address _manager) external {
        poolManager = _manager;
    }
}