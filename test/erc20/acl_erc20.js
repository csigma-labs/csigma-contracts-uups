// ERC20: AccessControl (ACL) Tests

// Zeppelin test helpers
const {
	BN,
	constants,
	expectEvent,
	expectRevert,
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

// deployment routines in use
const {
	NAME,
	SYMBOL,
	DECIMALS,
	S0,
} = require("./include/deployment_routines");

// BN constants and utilities
const {random_bn255} = require("../../scripts/include/bn_utils");

// deployment fixture routines in use
const {
	get_erc20_deployment,
	get_erc20_upgradeable_deployment
} = require("../include/deployment_fixture_routines");

// run AccessControl (ACL) tests
contract("ERC20: AccessControl (ACL) tests", function(accounts) {
	// extract accounts to be used:
	// A0 – special default zero account accounts[0] used by Truffle, reserved
	// a0 – deployment account having all the permissions, reserved
	// H0 – initial token holder account
	// a1, a2,... – working accounts to perform tests on
	const [A0, a0, H0, a1, a2] = accounts;
	const MINTER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";
    const UPGRADER_ROLE = "0x189ab7a9244df0848122154315af71fe140f3db0fe014031783b0946b8c9d2e3";
	const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

	// define test suite: it will be reused to test several contracts
	function acl_suite(contract_name, deployment_fn) {
		describe(`${contract_name}: ACL`, function() {
			// deploy token
			let token, tokenImpl;
			beforeEach(async function() {
				// a0 and H0 are ignored when using a fixture
				token = await deployment_fn.call(this, a0, H0);
				tokenImpl = await get_erc20_deployment.call(this, a0, H0);
				// when using a fixture, there is no initial token supply minted
				await token.mint(H0, S0,{from: a0});
			});

			const by = a1;
			const from = H0;
			const to = a2;
			const value = 1;

			describe("when operator has MINTER_ROLE", function() {
				beforeEach(async function() {
					await token.addMinter(by, {from: a0});
				});
				it("mint succeeds", async function() {
					const is1 = await token.isMinter(by);
					await token.mint(to, value, {from: by});
				});
			});
			describe("when operator does not have MINETR_ROLE", function() {
				beforeEach(async function() {
					await token.removeMinter(by, {from: a0});
				});
				it("mint reverts", async function() {
					await expectRevert.unspecified(token.mint(to, value, {from: by}));
				});
			});
			describe("when operator has UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await token.addUpgrader(by, {from: a0});
				});
				it("upgrade succeeds", async function() {
					await token.upgradeTo(tokenImpl.address, {from: by});
				});
			});
			describe("when operator does not have UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await token.removeUpgrader(by, {from: a0});
				});
				it("upgrade reverts", async function() {
					await expectRevert.unspecified(token.upgradeTo(tokenImpl.address, {from: by}));
				});
			});
			describe("when operator has DEFAULT_ADMIN_ROLE", function() {
				beforeEach(async function() {
					await token.grantRole(DEFAULT_ADMIN_ROLE, by, {from: a0});
				});
				it("can add new minter", async function() {
					await token.addMinter(to, {from: by});
					expect(await token.isMinter(to)).to.be.equals(true);
				});
				it("can remove existing minter", async function() {
					await token.removeMinter(to, {from: by});
					expect(await token.isMinter(to)).to.be.equals(false);
				});
				it("can add new upgrader", async function() {
					await token.addUpgrader(to, {from: by});
					expect(await token.isUpgrader(to)).to.be.equals(true);
				});
				it("can remove existing upgrader", async function() {
					await token.removeUpgrader(to, {from: by});
					expect(await token.isUpgrader(to)).to.be.equals(false);
				});
				it("can pause contract", async function() {
					await token.pause({from: by});
					expect(await token.paused()).to.be.equals(true);
				});
				it("can unpause contract", async function() {
					await token.pause({from: by});
					await token.unpause({from: by});
					expect(await token.paused()).to.be.equals(false);
				});
				it("can transfer admin role", async function() {
					await token.transferAdmin(to, {from: by});
					expect(await token.hasRole(DEFAULT_ADMIN_ROLE, to)).to.be.equals(true);
					expect(await token.hasRole(DEFAULT_ADMIN_ROLE, by)).to.be.equals(false);
				});
				it("can grant a new role", async function() {
					await token.grantRole(MINTER_ROLE, to, {from: by});
					expect(await token.hasRole(MINTER_ROLE, to)).to.be.equals(true);
				});
				it("can revoke an existing role", async function() {
					await token.revokeRole(MINTER_ROLE, to, {from: by});
					expect(await token.hasRole(MINTER_ROLE, to)).to.be.equals(false);
				});
			});
			describe("when operator does not have DEFAULT_ADMIN_ROLE", function() {
				beforeEach(async function() {
					await token.revokeRole(DEFAULT_ADMIN_ROLE, by, {from: a0});
				});
				it("can't add new minter", async function() {
					await expectRevert.unspecified(token.addMinter(to, {from: by}));
				});
				it("can't remove existing minter", async function() {
					await expectRevert.unspecified(token.removeMinter(to, {from: by}));
				});
				it("can't add new upgrader", async function() {
					await expectRevert.unspecified(token.addUpgrader(to, {from: by}));
				});
				it("can't remove existing upgrader", async function() {
					await expectRevert.unspecified(token.removeUpgrader(to, {from: by}));
				});
				it("can't pause contract", async function() {
					await expectRevert.unspecified(token.pause({from: by}));
				});
				it("can't unpause contract", async function() {
					await token.pause({from: a0});
					await expectRevert.unspecified(token.unpause({from: by}));
				});
				it("can't transfer admin role", async function() {
					await expectRevert.unspecified(token.transferAdmin(to, {from: by}));
				});
				it("can't grant a new role", async function() {
					await expectRevert.unspecified(token.grantRole(MINTER_ROLE, to, {from: by}));
				});
				it("can't revoke an existing role", async function() {
					await expectRevert.unspecified(token.revokeRole(MINTER_ROLE, to, {from: by}));
				});
			});
			describe("when contract is paused", function() {
				beforeEach(async function() {
					await token.approve(by, 100, {from: H0});
					await token.pause({from: a0});
				});
				it("approve reverts", async function() {
					await expectRevert(token.approve(by, 100, {from: H0}), "Pausable: paused");
				});
				it("increase allowance reverts", async function() {
					await expectRevert(token.increaseAllowance(by, 100, {from: H0}), "Pausable: paused");
				});
				it("decrease allowance reverts", async function() {
					await expectRevert(token.decreaseAllowance(by, 100, {from: H0}), "Pausable: paused");
				});
				it("permit reverts", async function() {
					await expectRevert(token.permit(by, to, 100, 0, 0, MINTER_ROLE, MINTER_ROLE, {from: H0}), "Pausable: paused");
				});
				it("transfer reverts", async function() {
					await expectRevert(token.transfer(by, 100, {from: H0}), "Pausable: paused");
				});
				it("transfer from reverts", async function() {
					await expectRevert(token.transferFrom(H0, to, 100, {from: by}), "Pausable: paused");
				});
				it("grant role reverts", async function() {
					await expectRevert(token.grantRole(MINTER_ROLE, by, {from: a0}), "Pausable: paused");
				});
				it("revoke role reverts", async function() {
					await expectRevert(token.revokeRole(MINTER_ROLE, by, {from: a0}), "Pausable: paused");
				});
			});
		});
	}

	// run the suite
	acl_suite("SIGMA", get_erc20_upgradeable_deployment);
});
