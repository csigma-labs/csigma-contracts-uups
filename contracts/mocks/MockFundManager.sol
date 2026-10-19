pragma solidity 0.8.9;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
interface Pool {
    function updateAssetUnderManagement(uint256 amount) external;
    function pmRepayAndBurn(address lender, uint256 shares) external;
}
contract MockFundManager {
    address public token;
    uint256 public aum;
    constructor(address toke) {
        token = toke;
    }

    function totalAssets() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function updateAUM(uint256 amount, address pool) external {
        Pool(pool).updateAssetUnderManagement(amount);
    }

    function withdraw() external {
        IERC20(token).transfer(msg.sender, IERC20(token).balanceOf(address(this)));
    }

    function increaseUndeployedAmount(uint256 _amount) external {}

    function pmRepayAndBurn(address pool, address lender, uint256 shares) external {
        Pool(pool).pmRepayAndBurn(lender, shares);
    }
}