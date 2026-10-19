// ERC20: ERC165 Interface ID tests

// Zeppelin test helpers
const {
	constants
} = require("@openzeppelin/test-helpers");
const {
	assert,
	expect,
} = require("chai");
const {
	ZERO_ADDRESS,
	ZERO_BYTES32,
	MAX_UINT256,
} = constants;

// ERC165 tests runner helper by vittominacori
const {
	shouldSupportInterfaces,
} = require("../include/SupportsInterface.behavior");

// deployment fixture routines in use
const {
	get_erc20_upgradeable_deployment,
} = require("../include/deployment_fixture_routines");

// run ERC165 Interface ID tests
contract("ERC20: ERC165 Interface ID tests", function(accounts) {
	// extract accounts to be used:
	// A0 – special default zero account accounts[0] used by Truffle, reserved
	// a0 – deployment account having all the permissions, reserved
	// H0 – initial token holder account
	// a1, a2,... – working accounts to perform tests on
	const [A0, a0, H0, a1, a2] = accounts;

	// define test suite: it will be reused to test several contracts
	function erc165_suite(contract_name, deployment_fn) {
		let token;
		beforeEach(async function() {
			// a0 and H0 are ignored when using a fixture
			token = await deployment_fn.call(this, a0, H0);
		});

		describe("run vittominacori's shouldSupportInterfaces", function() {
			beforeEach(async function() {
				// shouldSupportInterfaces uses this.token shortcut to access token instance
				this.token = token;
			});
			shouldSupportInterfaces(["ERC20"]);
			shouldSupportInterfaces(["ERC165"]);
		});
	}

	erc165_suite("SIGMA", get_erc20_upgradeable_deployment);
});
