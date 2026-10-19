// SPDX-License-Identifier: BUSL-1.1
// @author cSigma Finance Inc., a Delaware company, for its Real World Credit tokenization protocol

pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract CsigmaTimelock is TimelockControllerUpgradeable, UUPSUpgradeable {
    function initialize(address admin_, uint256 minDelay_, address[] memory proposers_, address[] memory executors_) public initializer {
        __TimelockController_init(minDelay_, proposers_, executors_, admin_);
        
    }

    function _authorizeUpgrade(address) internal override onlyRole(TIMELOCK_ADMIN_ROLE) {}
}