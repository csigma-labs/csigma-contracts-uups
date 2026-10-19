// ERC20: Burn and Blacklisting Tests
// Covers the new burn and blacklisting functionality added to the Sigma token.

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
} = constants;

// deployment constants in use
const {
	S0,
} = require("./include/deployment_routines");

// hardhat-deploy for scoped fixtures
const {deployments} = require("hardhat");

// Scoped fixture loader: only runs the Sigma deploy scripts (skipping other
// unrelated deploy scripts in the repo that may have env-config issues).
async function get_sigma_proxy() {
	await deployments.fixture(["Sigma_Proxy"]);
	const {address} = await deployments.get("Sigma_Proxy");
	const Contract = artifacts.require("./Sigma");
	return await Contract.at(address);
}

// run Burn + Blacklisting tests
contract("ERC20: Burn and Blacklisting tests", function(accounts) {
	// extract accounts:
	// A0 - Truffle reserved
	// a0 - deployment account (has DEFAULT_ADMIN_ROLE, MINTER_ROLE, UPGRADER_ROLE)
	// H0 - initial token holder
	// a1, a2, a3, a4 - working accounts
	const [A0, a0, H0, a1, a2, a3, a4] = accounts;

	// define test suite: reusable across token deployments
	function burn_blacklist_suite(contract_name, deployment_fn) {

		describe(`${contract_name}: burn`, function() {
			let token, BLACKLIST_MANAGER_ROLE;
			beforeEach(async function() {
				token = await deployment_fn.call(this, a0, H0);
				BLACKLIST_MANAGER_ROLE = await token.BLACKLIST_MANAGER_ROLE();
				await token.mint(H0, S0, {from: a0});
			});

			describe("when operator has DEFAULT_ADMIN_ROLE", function() {
				it("burns from a holder, reducing balance and totalSupply", async function() {
					const value = new BN(100);
					const balanceBefore = await token.balanceOf(H0);
					const totalSupplyBefore = await token.totalSupply();
					await token.burn(H0, value, {from: a0});
					expect(await token.balanceOf(H0)).to.be.bignumber.equal(balanceBefore.sub(value));
					expect(await token.totalSupply()).to.be.bignumber.equal(totalSupplyBefore.sub(value));
				});

				it("burn emits Transfer event to the zero address", async function() {
					const value = new BN(100);
					const receipt = await token.burn(H0, value, {from: a0});
					expectEvent(receipt, "Transfer", {from: H0, to: ZERO_ADDRESS, value});
				});

				it("burnActive flag is false after a successful burn", async function() {
					await token.burn(H0, 100, {from: a0});
					expect(await token.burnActive()).to.be.equal(false);
				});

				it("burnActive flag is false before any burn", async function() {
					expect(await token.burnActive()).to.be.equal(false);
				});

				it("burn from a blacklisted address succeeds", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await token.addBlackList(H0, {from: a1});
					expect(await token.isBlacklisted(H0)).to.be.equal(true);
					const value = new BN(100);
					const balanceBefore = await token.balanceOf(H0);
					await token.burn(H0, value, {from: a0});
					expect(await token.balanceOf(H0)).to.be.bignumber.equal(balanceBefore.sub(value));
				});

				it("burnActive resets to false after burning a blacklisted address", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await token.addBlackList(H0, {from: a1});
					await token.burn(H0, 100, {from: a0});
					expect(await token.burnActive()).to.be.equal(false);
				});

				it("burn with zero amount reverts", async function() {
					await expectRevert(token.burn(H0, 0, {from: a0}), "amount must be greater than 0");
				});

				it("burn more than balance reverts", async function() {
					const balance = await token.balanceOf(H0);
					await expectRevert.unspecified(token.burn(H0, balance.add(new BN(1)), {from: a0}));
				});

				it("burn from an account with zero balance reverts", async function() {
					expect(await token.balanceOf(a3)).to.be.bignumber.equal(new BN(0));
					await expectRevert.unspecified(token.burn(a3, 100, {from: a0}));
				});

				it("burn reverts when contract is paused", async function() {
					await token.pause({from: a0});
					await expectRevert(token.burn(H0, 100, {from: a0}), "Pausable: paused");
				});

				it("burnActive stays false when paused burn reverts", async function() {
					await token.pause({from: a0});
					await expectRevert(token.burn(H0, 100, {from: a0}), "Pausable: paused");
					expect(await token.burnActive()).to.be.equal(false);
				});
			});

			describe("when operator does not have DEFAULT_ADMIN_ROLE", function() {
				it("burn reverts for an account with MINTER_ROLE only", async function() {
					await token.addMinter(a1, {from: a0});
					await expectRevert.unspecified(token.burn(H0, 100, {from: a1}));
				});

				it("burn reverts for an account with BLACKLIST_MANAGER_ROLE only", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await expectRevert.unspecified(token.burn(H0, 100, {from: a1}));
				});

				it("burn reverts for an unprivileged account", async function() {
					await expectRevert.unspecified(token.burn(H0, 100, {from: a2}));
				});

				it("burn reverts for the holder themselves (no self-burn)", async function() {
					await expectRevert.unspecified(token.burn(H0, 100, {from: H0}));
				});
			});
		});

		describe(`${contract_name}: blacklisting`, function() {
			let token, BLACKLIST_MANAGER_ROLE;
			beforeEach(async function() {
				token = await deployment_fn.call(this, a0, H0);
				BLACKLIST_MANAGER_ROLE = await token.BLACKLIST_MANAGER_ROLE();
				await token.mint(H0, S0, {from: a0});
			});

			describe("BLACKLIST_MANAGER_ROLE: add/remove blacklist", function() {
				beforeEach(async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
				});

				it("isBlacklistManager returns true for granted account", async function() {
					expect(await token.isBlacklistManager(a1)).to.be.equal(true);
				});

				it("isBlacklistManager returns false for non-granted account", async function() {
					expect(await token.isBlacklistManager(a2)).to.be.equal(false);
				});

				it("addBlackList sets isBlacklisted = true and emits AddedBlackList", async function() {
					const receipt = await token.addBlackList(a2, {from: a1});
					expectEvent(receipt, "AddedBlackList", {_account: a2});
					expect(await token.isBlacklisted(a2)).to.be.equal(true);
				});

				it("removeBlackList sets isBlacklisted = false and emits RemovedBlackList", async function() {
					await token.addBlackList(a2, {from: a1});
					const receipt = await token.removeBlackList(a2, {from: a1});
					expectEvent(receipt, "RemovedBlackList", {_account: a2});
					expect(await token.isBlacklisted(a2)).to.be.equal(false);
				});

				it("addBlackList is idempotent (re-blacklisting same address)", async function() {
					await token.addBlackList(a2, {from: a1});
					await token.addBlackList(a2, {from: a1});
					expect(await token.isBlacklisted(a2)).to.be.equal(true);
				});

				it("removeBlackList on a non-blacklisted address does not revert", async function() {
					expect(await token.isBlacklisted(a2)).to.be.equal(false);
					await token.removeBlackList(a2, {from: a1});
					expect(await token.isBlacklisted(a2)).to.be.equal(false);
				});

				it("blacklisting zero address is allowed (no zero-address check)", async function() {
					// Documents current behavior — there is no notZeroAddress modifier on addBlackList.
					await token.addBlackList(ZERO_ADDRESS, {from: a1});
					expect(await token.isBlacklisted(ZERO_ADDRESS)).to.be.equal(true);
				});
			});

			describe("BLACKLIST_MANAGER_ROLE: access control", function() {
				it("addBlackList reverts for an account without BLACKLIST_MANAGER_ROLE", async function() {
					await expectRevert.unspecified(token.addBlackList(a2, {from: a1}));
				});

				it("removeBlackList reverts for an account without BLACKLIST_MANAGER_ROLE", async function() {
					await expectRevert.unspecified(token.removeBlackList(a2, {from: a1}));
				});

				it("DEFAULT_ADMIN without BLACKLIST_MANAGER_ROLE cannot addBlackList", async function() {
					// a0 has DEFAULT_ADMIN_ROLE but not BLACKLIST_MANAGER_ROLE
					expect(await token.isBlacklistManager(a0)).to.be.equal(false);
					await expectRevert.unspecified(token.addBlackList(a2, {from: a0}));
				});

				it("MINTER without BLACKLIST_MANAGER_ROLE cannot addBlackList", async function() {
					await token.addMinter(a1, {from: a0});
					await expectRevert.unspecified(token.addBlackList(a2, {from: a1}));
				});

				it("revoked BLACKLIST_MANAGER cannot addBlackList", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await token.revokeRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await expectRevert.unspecified(token.addBlackList(a2, {from: a1}));
				});
			});

			describe("blacklisted address behavior in transfers", function() {
				beforeEach(async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await token.addBlackList(H0, {from: a1});
				});

				it("transfer FROM blacklisted address reverts with AssetsFrozen", async function() {
					await expectRevert.unspecified(token.transfer(a2, 100, {from: H0}));
				});

				it("transfer TO blacklisted address reverts with AssetsFrozen", async function() {
					await token.mint(a3, 1000, {from: a0});
					await expectRevert.unspecified(token.transfer(H0, 100, {from: a3}));
				});

				it("transferFrom by a third party FROM blacklisted source reverts", async function() {
					// Unblacklist temporarily to seed the allowance, then re-blacklist
					await token.removeBlackList(H0, {from: a1});
					await token.approve(a2, 1000, {from: H0});
					await token.addBlackList(H0, {from: a1});
					await expectRevert.unspecified(token.transferFrom(H0, a3, 100, {from: a2}));
				});

				it("transferFrom TO blacklisted recipient reverts", async function() {
					await token.mint(a3, 1000, {from: a0});
					await token.approve(a2, 1000, {from: a3});
					await expectRevert.unspecified(token.transferFrom(a3, H0, 100, {from: a2}));
				});

				it("mint TO blacklisted address reverts", async function() {
					// _from is address(0) on mint, which is fine; _to is blacklisted, which reverts.
					await expectRevert.unspecified(token.mint(H0, 100, {from: a0}));
				});

				it("blacklisted address can still approve (no blacklist gate on approve)", async function() {
					// The eventual transferFrom would revert anyway.
					await token.approve(a2, 100, {from: H0});
					expect(await token.allowance(H0, a2)).to.be.bignumber.equal(new BN(100));
				});

				it("after removeBlackList, transfer FROM the address succeeds", async function() {
					await token.removeBlackList(H0, {from: a1});
					await token.transfer(a2, 100, {from: H0});
					expect(await token.balanceOf(a2)).to.be.bignumber.equal(new BN(100));
				});

				it("after removeBlackList, transfer TO the address succeeds", async function() {
					await token.removeBlackList(H0, {from: a1});
					await token.mint(a3, 1000, {from: a0});
					await token.transfer(H0, 100, {from: a3});
					expect(await token.balanceOf(H0)).to.be.bignumber.equal(S0.add(new BN(100)));
				});

				it("admin burn from blacklisted address succeeds (bypasses blacklist gate)", async function() {
					const balanceBefore = await token.balanceOf(H0);
					await token.burn(H0, 100, {from: a0});
					expect(await token.balanceOf(H0)).to.be.bignumber.equal(balanceBefore.sub(new BN(100)));
				});

				it("blacklist gate is restored after admin burn", async function() {
					await token.burn(H0, 100, {from: a0});
					// H0 still blacklisted -> normal transfer must still revert
					await expectRevert.unspecified(token.transfer(a2, 1, {from: H0}));
				});

				it("burning a blacklisted address with insufficient balance reverts and leaves blacklist intact", async function() {
					const balance = await token.balanceOf(H0);
					await expectRevert.unspecified(token.burn(H0, balance.add(new BN(1)), {from: a0}));
					expect(await token.isBlacklisted(H0)).to.be.equal(true);
					expect(await token.burnActive()).to.be.equal(false);
				});
			});

			describe("blacklist operations during pause", function() {
				beforeEach(async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
				});

				it("addBlackList works when contract is paused (no whenNotPaused gate)", async function() {
					await token.pause({from: a0});
					await token.addBlackList(a2, {from: a1});
					expect(await token.isBlacklisted(a2)).to.be.equal(true);
				});

				it("removeBlackList works when contract is paused", async function() {
					await token.addBlackList(a2, {from: a1});
					await token.pause({from: a0});
					await token.removeBlackList(a2, {from: a1});
					expect(await token.isBlacklisted(a2)).to.be.equal(false);
				});

				it("transfer is blocked by pause before blacklist check is reached", async function() {
					await token.addBlackList(H0, {from: a1});
					await token.pause({from: a0});
					// _beforeTokenTransfer has whenNotPaused first, so we see the pause error
					await expectRevert(token.transfer(a2, 100, {from: H0}), "Pausable: paused");
				});
			});

			describe("BLACKLIST_MANAGER_ROLE granting via DEFAULT_ADMIN", function() {
				it("admin can grant BLACKLIST_MANAGER_ROLE", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					expect(await token.isBlacklistManager(a1)).to.be.equal(true);
				});

				it("admin can revoke BLACKLIST_MANAGER_ROLE", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await token.revokeRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					expect(await token.isBlacklistManager(a1)).to.be.equal(false);
				});

				it("non-admin cannot grant BLACKLIST_MANAGER_ROLE", async function() {
					await expectRevert.unspecified(token.grantRole(BLACKLIST_MANAGER_ROLE, a2, {from: a1}));
				});

				it("non-admin cannot revoke BLACKLIST_MANAGER_ROLE", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await expectRevert.unspecified(token.revokeRole(BLACKLIST_MANAGER_ROLE, a1, {from: a2}));
				});

				it("granting BLACKLIST_MANAGER_ROLE to zero address reverts", async function() {
					await expectRevert(
						token.grantRole(BLACKLIST_MANAGER_ROLE, ZERO_ADDRESS, {from: a0}),
						"address cannot be zero"
					);
				});

				it("granting BLACKLIST_MANAGER_ROLE while paused reverts", async function() {
					await token.pause({from: a0});
					await expectRevert(
						token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0}),
						"Pausable: paused"
					);
				});

				it("revoking BLACKLIST_MANAGER_ROLE while paused reverts", async function() {
					await token.grantRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0});
					await token.pause({from: a0});
					await expectRevert(
						token.revokeRole(BLACKLIST_MANAGER_ROLE, a1, {from: a0}),
						"Pausable: paused"
					);
				});
			});
		});
	}

	// run the suite against the upgradeable Sigma deployment
	burn_blacklist_suite("SIGMA", get_sigma_proxy);
});
