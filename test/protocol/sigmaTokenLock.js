// SigmaTokenLock: Unit Tests

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
} = require("../erc20/include/deployment_routines");

// BN constants and utilities
const {random_bn255} = require("../../scripts/include/bn_utils");

// deployment fixture routines in use
const {
	get_erc20_upgradeable_deployment,
	get_sigmaTokenLock_deployment
} = require("../include/deployment_fixture_routines");

// run Unit tests
contract("SigmaTokenLock: Unit tests", function(accounts) {
	// extract accounts to be used:
	// A0 – special default zero account accounts[0] used by Truffle, reserved
	// a0 – deployment account having all the permissions, reserved
	// H0 – initial token holder account
	// a1, a2,... – working accounts to perform tests on
	const [A0, a0, H0, a1, a2] = accounts;
	const ROLE_WITHDRAW_MANAGER = "0xfb9ef25575e43f5a1169ea1385a3493ec86bd8dcdc21f729516c26cd15e5c244";
    const ROLE_UPGRADE_MANAGER = "0x7bc03dd4c626a643aa85428e185011e877bed9d0da9f90f563f8eb5bbebca45e";
	const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

	// define test suite: it will be reused to test several contracts
	function test_suite(contract_name, deployment_fn) {
		describe(`${contract_name}: ACL`, function() {
			// deploy contracts
			let sigma, sigmaLock, sigmaLockImpl;
			beforeEach(async function() {
				// a0 and H0 are ignored when using a fixture
				sigma = await get_erc20_upgradeable_deployment.call(this, a0, H0);
				let sigmaLockDeployed = await deployment_fn.call(this, a0, H0);
				sigmaLockImpl = await get_sigmaTokenLock_deployment.call(this, a0, H0);
				const sigmaLock_contract = new web3.eth.Contract(sigmaLockDeployed.abi, sigmaLockDeployed.address);
				const proxy_init_data = sigmaLock_contract.methods.initialize(sigma.address, a0, a0).encodeABI();
				const ERC1967Proxy = artifacts.require("./ERC1967Proxy");
				const proxy = await ERC1967Proxy.new(sigmaLockDeployed.address, proxy_init_data, {from: a0});	
				const sigmaLockArtifacts = artifacts.require("./SigmaTokenLock");
				sigmaLock = await sigmaLockArtifacts.at(proxy.address);
			});

			const by = a1;
			const from = H0;
			const to = a2;
			const value = 1;

			describe("when operator has ROLE_WITHDRAW_MANAGER", function() {
				beforeEach(async function() {
					await sigma.mint(sigmaLock.address, 100, {from: a0});
					await sigmaLock.addWithdrawManager(by, {from: a0});
				});
				it("withdraw succeeds", async function() {
					await sigmaLock.emergencyWithdraw(sigma.address, to, 100, {from: by});
					expect(await sigma.balanceOf(to)).to.be.bignumber.equals(BN(100));
				});
			});
			describe("when operator does not have ROLE_WITHDRAW_MANAGER", function() {
				beforeEach(async function() {
					await sigma.mint(sigmaLock.address, 100, {from: a0});
					await sigmaLock.removeWithdrawManager(by, {from: a0});
				});
				it("withdraw reverts", async function() {
					await expectRevert.unspecified(sigmaLock.emergencyWithdraw(sigma.address, to, 100, {from: by}));
				});
			});
			describe("when operator has UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await sigmaLock.addUpgradeManager(by, {from: a0});
				});
				it("upgrade succeeds", async function() {
					await sigmaLock.upgradeTo(sigmaLockImpl.address, {from: by});
				});
			});
			describe("when operator does not have UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await sigmaLock.removeUpgradeManager(by, {from: a0});
				});
				it("upgrade reverts", async function() {
					await expectRevert.unspecified(sigmaLock.upgradeTo(sigmaLockImpl.address, {from: by}));
				});
			});
			describe("when operator has DEFAULT_ADMIN_ROLE", function() {
				beforeEach(async function() {
					await sigmaLock.grantRole(DEFAULT_ADMIN_ROLE, by, {from: a0});
				});
				it("can add new withdraw manager", async function() {
					await sigmaLock.addWithdrawManager(to, {from: by});
					expect(await sigmaLock.isWithdrawManager(to)).to.be.equals(true);
				});
				it("can remove existing withdraw manager", async function() {
					await sigmaLock.removeWithdrawManager(to, {from: by});
					expect(await sigmaLock.isWithdrawManager(to)).to.be.equals(false);
				});
				it("can add new upgrader", async function() {
					await sigmaLock.addUpgradeManager(to, {from: by});
					expect(await sigmaLock.isUpgradeManager(to)).to.be.equals(true);
				});
				it("can remove existing upgrader", async function() {
					await sigmaLock.removeUpgradeManager(to, {from: by});
					expect(await sigmaLock.isUpgradeManager(to)).to.be.equals(false);
				});
				it("can pause contract", async function() {
					await sigmaLock.pause({from: by});
					expect(await sigmaLock.paused()).to.be.equals(true);
				});
				it("can unpause contract", async function() {
					await sigmaLock.pause({from: by});
					await sigmaLock.unpause({from: by});
					expect(await sigmaLock.paused()).to.be.equals(false);
				});
				it("can transfer admin role", async function() {
					await sigmaLock.transferAdmin(to, {from: by});
					expect(await sigmaLock.hasRole(DEFAULT_ADMIN_ROLE, to)).to.be.equals(true);
					expect(await sigmaLock.hasRole(DEFAULT_ADMIN_ROLE, by)).to.be.equals(false);
				});
				it("can grant a new role", async function() {
					await sigmaLock.grantRole(ROLE_WITHDRAW_MANAGER, to, {from: by});
					expect(await sigmaLock.hasRole(ROLE_WITHDRAW_MANAGER, to)).to.be.equals(true);
				});
				it("can revoke an existing role", async function() {
					await sigmaLock.revokeRole(ROLE_WITHDRAW_MANAGER, to, {from: by});
					expect(await sigmaLock.hasRole(ROLE_WITHDRAW_MANAGER, to)).to.be.equals(false);
				});
			});
			describe("when operator does not have DEFAULT_ADMIN_ROLE", function() {
				beforeEach(async function() {
					await sigmaLock.revokeRole(DEFAULT_ADMIN_ROLE, by, {from: a0});
				});
				it("can't add new withdraw manager", async function() {
					await expectRevert.unspecified(sigmaLock.addWithdrawManager(to, {from: by}));
				});
				it("can't remove existing withdraw manager", async function() {
					await expectRevert.unspecified(sigmaLock.removeWithdrawManager(to, {from: by}));
				});
				it("can't add new upgrader", async function() {
					await expectRevert.unspecified(sigmaLock.addUpgradeManager(to, {from: by}));
				});
				it("can't remove existing upgrader", async function() {
					await expectRevert.unspecified(sigmaLock.removeUpgradeManager(to, {from: by}));
				});
				it("can't pause contract", async function() {
					await expectRevert.unspecified(sigmaLock.pause({from: by}));
				});
				it("can't unpause contract", async function() {
					await sigmaLock.pause({from: a0});
					await expectRevert.unspecified(sigmaLock.unpause({from: by}));
				});
				it("can't transfer admin role", async function() {
					await expectRevert.unspecified(sigmaLock.transferAdmin(to, {from: by}));
				});
				it("can't grant a new role", async function() {
					await expectRevert.unspecified(sigmaLock.grantRole(ROLE_WITHDRAW_MANAGER, to, {from: by}));
				});
				it("can't revoke an existing role", async function() {
					await expectRevert.unspecified(sigmaLock.revokeRole(ROLE_WITHDRAW_MANAGER, to, {from: by}));
				});
			});
			describe("when contract is paused", function() {
				beforeEach(async function() {
					await sigmaLock.pause({from: a0});
				});
				it("lock tokens reverts", async function() {
					await expectRevert(sigmaLock.lockToken(100, 10, {from: by}), "Pausable: paused");
				});
				it("unlock tokens reverts", async function() {
					await expectRevert(sigmaLock.unlockToken({from: by}), "Pausable: paused");
				});
				it("increase lock amount reverts", async function() {
					await expectRevert(sigmaLock.increaseLockingAmount(100, {from: by}), "Pausable: paused");
				});
				it("increase lock duration reverts", async function() {
					await expectRevert(sigmaLock.increaseLockingDuration(100, {from: by}), "Pausable: paused");
				});
				it("emergency withdraw reverts", async function() {
					await expectRevert(sigmaLock.emergencyWithdraw(sigma.address, to, 100, {from: a0}), "Pausable: paused");
				});
				it("grant role reverts", async function() {
					await expectRevert(sigmaLock.grantRole(ROLE_WITHDRAW_MANAGER, by, {from: a0}), "Pausable: paused");
				});
				it("revoke role reverts", async function() {
					await expectRevert(sigmaLock.revokeRole(ROLE_WITHDRAW_MANAGER, by, {from: a0}), "Pausable: paused");
				});
			});
			describe("lock tokens", function() {
				beforeEach(async function() {
					await sigma.mint(by, 100, {from: a0});
					await sigma.approve(sigmaLock.address, 100, {from: by});
				});
				it("fails if tokens already locked", async function() {
					await sigmaLock.lockToken(50, 100, {from: by});
					await expectRevert.unspecified(sigmaLock.lockToken(50, 100, {from: by}));
				});
				it("fails if locking amount is invalid", async function() {
					await expectRevert.unspecified(sigmaLock.lockToken(101, 100, {from: by}));
				});
				it("succeed otherwise", async function() {
					await sigmaLock.lockToken(100, 10, {from: by});
					const info = await sigmaLock.lockInfo(by);
					expect(info.amount).to.be.bignumber.equals(BN(100));
					expect(info.lockingDurationInSeconds).to.be.bignumber.equals(BN(10));
					expect(info.startTime).not.to.be.bignumber.equals(BN(0));
					expect(await sigma.balanceOf(sigmaLock.address)).to.be.bignumber.equals(BN(100));
				});
			});
			describe("unlock tokens", function() {
				beforeEach(async function() {
					await sigma.mint(by, 100, {from: a0});
					await sigma.approve(sigmaLock.address, 100, {from: by});
				});
				it("fails if tokens are not locked", async function() {
					await expectRevert.unspecified(sigmaLock.unlockToken({from: by}));
				});
				it("fails if locking period is not over", async function() {
					await sigmaLock.lockToken(100, 1000, {from: by});
					await expectRevert.unspecified(sigmaLock.unlockToken({from: by}));
				});
				it("succeed otherwise", async function() {
					await sigmaLock.lockToken(100, 0, {from: by});
					await sigmaLock.unlockToken({from: by});
					const info = await sigmaLock.lockInfo(by);
					expect(info.amount).to.be.bignumber.equals(BN(0));
					expect(info.lockingDurationInSeconds).to.be.bignumber.equals(BN(0));
					expect(info.startTime).to.be.bignumber.equals(BN(0));
					expect(await sigma.balanceOf(by)).to.be.bignumber.equals(BN(100));
				});
			});
			describe("increase locking amount", function() {
				beforeEach(async function() {
					await sigma.mint(by, 100, {from: a0});
					await sigma.approve(sigmaLock.address, 100, {from: by});
				});
				it("fails if tokens are not locked", async function() {
					await expectRevert.unspecified(sigmaLock.increaseLockingAmount(100, {from: by}));
				});
				it("fails if locking amount is invalid", async function() {
					await sigmaLock.lockToken(100, 10, {from: by});
					await expectRevert.unspecified(sigmaLock.increaseLockingAmount(100, {from: by}));
				});
				it("succeed otherwise", async function() {
					await sigmaLock.lockToken(50, 10, {from: by});
					const before = await sigmaLock.lockInfo(by);
					await sigmaLock.increaseLockingAmount(50, {from: by});
					const info = await sigmaLock.lockInfo(by);
					expect(info.amount).to.be.bignumber.equals(BN(100));
					expect(info.lockingDurationInSeconds).to.be.bignumber.equals(BN(10));
					expect(info.startTime).to.be.bignumber.equals(before.startTime);
					expect(await sigma.balanceOf(sigmaLock.address)).to.be.bignumber.equals(BN(100));
				});
			});
			describe("increase locking duration", function() {
				beforeEach(async function() {
					await sigma.mint(by, 100, {from: a0});
					await sigma.approve(sigmaLock.address, 100, {from: by});
				});
				it("fails if tokens are not locked", async function() {
					await expectRevert.unspecified(sigmaLock.increaseLockingDuration(100, {from: by}));
				});
				it("succeed otherwise", async function() {
					await sigmaLock.lockToken(100, 10, {from: by});
					const before = await sigmaLock.lockInfo(by);
					await sigmaLock.increaseLockingDuration(100, {from: by});
					const info = await sigmaLock.lockInfo(by);
					expect(info.amount).to.be.bignumber.equals(BN(100));
					expect(info.lockingDurationInSeconds).to.be.bignumber.equals(BN(110));
					expect(info.startTime).to.be.bignumber.equals(before.startTime);
					expect(await sigma.balanceOf(sigmaLock.address)).to.be.bignumber.equals(BN(100));
				});
			});
		});
	}

	// run the suite
	test_suite("SIGMA_TOKEN_LOCK", get_sigmaTokenLock_deployment);
});
