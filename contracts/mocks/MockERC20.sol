pragma solidity 0.8.9;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private _customDecimals;

    constructor() ERC20("Dummy Token", "DMT") {
        _customDecimals = 18; // default to 18
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setDecimals(uint8 newDecimals) external {
        _customDecimals = newDecimals;
    }

    function decimals() public view virtual override returns (uint8) {
        return _customDecimals;
    }
}
