// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Stands in for both Permit2 and the Uniswap Universal Router in
///         CSUSDFundManager.swapExactInputSingle tests.
/// @dev The fund manager approves Permit2 and calls execute() on the router, so a single
///      contract serving as both lets the mock pull the input token with the allowance it
///      was just granted. The swap leg is pre-configured with setSwap rather than decoded
///      from the V4 command payload.
contract MockSwapRouter {
    address public tokenIn;
    address public tokenOut;
    uint256 public amountIn;
    uint256 public amountOut;

    /// @notice Configures the token amounts the next execute() call will move
    function setSwap(address _tokenIn, uint256 _amountIn, address _tokenOut, uint256 _amountOut) external {
        tokenIn = _tokenIn;
        amountIn = _amountIn;
        tokenOut = _tokenOut;
        amountOut = _amountOut;
    }

    /// @notice Permit2 IAllowanceTransfer.approve - no-op, the mock spends the ERC20 allowance directly
    function approve(address, address, uint160, uint48) external {}

    /// @notice IUniversalRouter.execute - settles the configured input and pays out the configured output
    function execute(bytes calldata, bytes[] calldata, uint256) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, amountOut);
    }
}