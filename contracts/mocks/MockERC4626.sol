// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Mock ERC4626 vault for testing migration logic
contract MockERC4626 is ERC4626, ERC20Burnable {
    constructor(IERC20 asset_, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC4626(asset_)
    {}

    /// @dev Mint shares directly for testing
    function mintShares(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Mint assets directly to vault for testing
    function mintAssets(uint256 amount) external {
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
    }

    /// @inheritdoc ERC20
    function decimals() public view virtual override(ERC20, ERC4626) returns (uint8) {
        return super.decimals(); // use ERC4626’s logic
    }
}
