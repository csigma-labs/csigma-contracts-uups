pragma solidity 0.8.9;

contract MockWithdrawManager {
    function repay(uint256, uint256) external {
    }

    function totalDueLPToken() external pure returns (uint256) {
        return 0;
    }
}