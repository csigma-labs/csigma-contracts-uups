pragma solidity 0.8.9;

contract MockChainAnalysis {
    mapping(address => bool) public isSanctioned;


    function sanction(address user, bool flag) external {
        isSanctioned[user] = flag;
    }
}