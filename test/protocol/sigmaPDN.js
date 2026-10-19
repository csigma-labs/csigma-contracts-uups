// CsigmaPDN: Unit Tests

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
const { ethers } = require("hardhat");
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
	get_sigmaPDN_deployment
} = require("../include/deployment_fixture_routines");

// run Unit tests
contract("CsigmaPDN: Unit tests", function(accounts) {
	// extract accounts to be used:
	// A0 – special default zero account accounts[0] used by Truffle, reserved
	// a0 – deployment account having all the permissions, reserved
	// H0 – initial token holder account
	// a1, a2,... – working accounts to perform tests on
	const [A0, a0, H0, a1, a2] = accounts;
	const ROLE_CREATE_MANAGER = "0x1694924e8b02ad9ed093ee2e818c411a91043151d33cb90a301009fc9ebba0e1";
    const ROLE_UPGRADE_MANAGER = "0x7bc03dd4c626a643aa85428e185011e877bed9d0da9f90f563f8eb5bbebca45e";
	const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

	// define test suite: it will be reused to test several contracts
	function test_suite(contract_name) {
		describe(`${contract_name}: ACL`, function() {
			// deploy contracts
			let pdn, pdnImpl;
			beforeEach(async function() {
				// The dedicated SigmaPDN_Proxy deploy script was removed in favour of the v1_1
				// proxy, so the fixture no longer provides one. Deploy the base CsigmaPDN behind an
				// ERC1967 proxy inline instead, from a0 so a0 becomes admin/create/upgrade manager
				// (matching the old initialize(A0, A0) setup).
				pdnImpl = await get_sigmaPDN_deployment.call(this, a0, H0);
				const signerA0 = await ethers.getSigner(a0);
				const PDNfactory = await ethers.getContractFactory("CsigmaPDN", signerA0);
				const initData = PDNfactory.interface.encodeFunctionData("initialize", [a0, a0]);
				const proxyFactory = await ethers.getContractFactory("ERC1967Proxy", signerA0);
				const proxy = await proxyFactory.deploy(pdnImpl.address, initData);
				const Contract = artifacts.require("./CsigmaPDN");
				pdn = await Contract.at(await proxy.getAddress());
			});

			const by = a1;
			const from = H0;
			const to = a2;
			const value = 1;

			describe("when operator has ROLE_CREATE_MANAGER", function() {
				beforeEach(async function() {
					await pdn.addCreateManager(by, {from: a0});
				});
				it("lender creation succeeds", async function() {
					await pdn.createLender("lender", "user", "hash", {from: by});
					const lender = await pdn.lenders("lender"); 
					expect(lender.userId).to.be.equals("user");
					expect(lender.metaHash).to.be.equals("hash");
					expect(lender.totalInvested).to.be.bignumber.equals(BN(0));
					expect(lender.totalReceived).to.be.bignumber.equals(BN(0));
				});
				it("lender creation batch succeeds", async function() {
					const lender1 = {lenderId: "lender1", userId: "user1", metaHash: "hash1"};
					const lender2 = {lenderId: "lender2", userId: "user2", metaHash: "hash2"};
					await pdn.createLenderBatch([lender1, lender2], {from: by});
					const lenderData1 = await pdn.lenders("lender1");
					const lenderData2 = await pdn.lenders("lender2"); 
					expect(lenderData1.userId).to.be.equals("user1");
					expect(lenderData1.metaHash).to.be.equals("hash1");
					expect(lenderData2.userId).to.be.equals("user2");
					expect(lenderData2.metaHash).to.be.equals("hash2");
				});
				it("pool creation succeeds", async function() {
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: by});
					const pool = await pdn.pools("pool"); 
					expect(pool.poolManagerId).to.be.equals("pm");
					expect(pool.metaHash).to.be.equals("hash");
					expect(pool.ratings).to.be.bignumber.equals(BN(0));
					expect(pool.inceptionTime).to.be.bignumber.equals(BN(10));
					expect(pool.expiryTime).to.be.bignumber.equals(BN(20));
					expect(pool.poolSize).to.be.bignumber.equals(BN(30));
					expect(pool.expiryTime).to.be.bignumber.equals(BN(20));
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(0));
					expect(pool.totalPayment).to.be.bignumber.equals(BN(0));
				});
				it("pool creation batch succeeds", async function() {
					const pool1 = {poolId: "pool1", poolManagerId: "pm1", metaHash: "hash1", ratings: 0, inceptionTime: 10, expiryTime: 20, poolSize:30};
					const pool2 = {poolId: "pool2", poolManagerId: "pm2", metaHash: "hash2", ratings: 1, inceptionTime: 20, expiryTime: 40, poolSize:60};
					await pdn.createPoolBatch([pool1, pool2], {from: by});
					const poolData1 = await pdn.pools("pool1");
					const poolData2 = await pdn.pools("pool2"); 
					expect(poolData1.poolManagerId).to.be.equals("pm1");
					expect(poolData1.metaHash).to.be.equals("hash1");
					expect(poolData1.ratings).to.be.bignumber.equals(BN(0));
					expect(poolData1.inceptionTime).to.be.bignumber.equals(BN(10));
					expect(poolData1.expiryTime).to.be.bignumber.equals(BN(20));
					expect(poolData1.poolSize).to.be.bignumber.equals(BN(30));
					expect(poolData2.poolManagerId).to.be.equals("pm2");
					expect(poolData2.metaHash).to.be.equals("hash2");
					expect(poolData2.ratings).to.be.bignumber.equals(BN(1));
					expect(poolData2.inceptionTime).to.be.bignumber.equals(BN(20));
					expect(poolData2.expiryTime).to.be.bignumber.equals(BN(40));
					expect(poolData2.poolSize).to.be.bignumber.equals(BN(60));
				});
				it("add payment succeeds", async function() {
					await pdn.createLender("lender", "user", "hash", {from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: by});
					const payment = await pdn.payments("pay1"); 
					expect(payment.lenderId).to.be.equals("lender");
					expect(payment.poolId).to.be.equals("pool");
					expect(payment.principal).to.be.bignumber.equals(BN(100));
					expect(payment.coupon).to.be.bignumber.equals(BN(0));
					expect(payment.paymentType).to.be.bignumber.equals(BN(0));
					expect(payment.timeStamp).to.be.bignumber.equals(BN(10));
				});
				it("add payment batch succeeds", async function() {
					await pdn.createLender("lender1", "user", "hash", {from: by});
					await pdn.createPool("pool1", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.createLender("lender2", "user", "hash", {from: by});
					await pdn.createPool("pool2", "pm", "hash", 0, 10, 20, 30, {from: by});
					const payment1 = {paymentId: "pay1", lenderId: "lender1", poolId: "pool1", principal: 100, coupon: 0, paymentType: 0, timeStamp: 10};
					const payment2 = {paymentId: "pay2", lenderId: "lender2", poolId: "pool2", principal: 200, coupon: 10, paymentType: 1, timeStamp: 20};
					await pdn.addPaymentBatch([payment1, payment2], {from: by});
					const pay1 = await pdn.payments("pay1");
					const pay2 = await pdn.payments("pay2"); 
					expect(pay1.lenderId).to.be.equals("lender1");
					expect(pay1.poolId).to.be.equals("pool1");
					expect(pay1.principal).to.be.bignumber.equals(BN(100));
					expect(pay1.coupon).to.be.bignumber.equals(BN(0));
					expect(pay1.paymentType).to.be.bignumber.equals(BN(0));
					expect(pay1.timeStamp).to.be.bignumber.equals(BN(10));
					expect(pay2.lenderId).to.be.equals("lender2");
					expect(pay2.poolId).to.be.equals("pool2");
					expect(pay2.principal).to.be.bignumber.equals(BN(200));
					expect(pay2.coupon).to.be.bignumber.equals(BN(10));
					expect(pay2.paymentType).to.be.bignumber.equals(BN(1));
					expect(pay2.timeStamp).to.be.bignumber.equals(BN(20));
				});
			});
			describe("when operator does not have ROLE_CREATE_MANAGER", function() {
				beforeEach(async function() {
					await pdn.removeCreateManager(by, {from: a0});
				});
				it("lender creation reverts", async function() {
					await expectRevert.unspecified(pdn.createLender("lender", "user", "hash", {from: by}));
				});
				it("pool creation reverts", async function() {
					await expectRevert.unspecified(pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: by}));
				});
				it("add payment reverts", async function() {
					await pdn.createLender("lender", "user", "hash", {from: a0});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
					await expectRevert.unspecified(pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: by}));
				});
			});
			describe("when operator has UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await pdn.addUpgradeManager(by, {from: a0});
				});
				it("upgrade succeeds", async function() {
					await pdn.upgradeTo(pdnImpl.address, {from: by});
				});
			});
			describe("when operator does not have UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await pdn.removeUpgradeManager(by, {from: a0});
				});
				it("upgrade reverts", async function() {
					await expectRevert.unspecified(pdn.upgradeTo(pdnImpl.address, {from: by}));
				});
			});
			describe("when operator has DEFAULT_ADMIN_ROLE", function() {
				beforeEach(async function() {
					await pdn.grantRole(DEFAULT_ADMIN_ROLE, by, {from: a0});
				});
				it("can add new create manager", async function() {
					await pdn.addCreateManager(to, {from: by});
					expect(await pdn.isCreateManager(to)).to.be.equals(true);
				});
				it("can remove existing create manager", async function() {
					await pdn.removeCreateManager(to, {from: by});
					expect(await pdn.isCreateManager(to)).to.be.equals(false);
				});
				it("can add new upgrader", async function() {
					await pdn.addUpgradeManager(to, {from: by});
					expect(await pdn.isUpgradeManager(to)).to.be.equals(true);
				});
				it("can remove existing upgrader", async function() {
					await pdn.removeUpgradeManager(to, {from: by});
					expect(await pdn.isUpgradeManager(to)).to.be.equals(false);
				});
				it("can pause contract", async function() {
					await pdn.pause({from: by});
					expect(await pdn.paused()).to.be.equals(true);
				});
				it("can unpause contract", async function() {
					await pdn.pause({from: by});
					await pdn.unpause({from: by});
					expect(await pdn.paused()).to.be.equals(false);
				});
				it("can transfer admin role", async function() {
					await pdn.transferAdmin(to, {from: by});
					expect(await pdn.hasRole(DEFAULT_ADMIN_ROLE, to)).to.be.equals(true);
					expect(await pdn.hasRole(DEFAULT_ADMIN_ROLE, by)).to.be.equals(false);
				});
				it("can grant a new role", async function() {
					await pdn.grantRole(ROLE_CREATE_MANAGER, to, {from: by});
					expect(await pdn.hasRole(ROLE_CREATE_MANAGER, to)).to.be.equals(true);
				});
				it("can revoke an existing role", async function() {
					await pdn.revokeRole(ROLE_CREATE_MANAGER, to, {from: by});
					expect(await pdn.hasRole(ROLE_CREATE_MANAGER, to)).to.be.equals(false);
				});
			});
			describe("when operator does not have DEFAULT_ADMIN_ROLE", function() {
				beforeEach(async function() {
					await pdn.revokeRole(DEFAULT_ADMIN_ROLE, by, {from: a0});
				});
				it("can't add new create manager", async function() {
					await expectRevert.unspecified(pdn.addCreateManager(to, {from: by}));
				});
				it("can't remove existing create manager", async function() {
					await expectRevert.unspecified(pdn.removeCreateManager(to, {from: by}));
				});
				it("can't add new upgrader", async function() {
					await expectRevert.unspecified(pdn.addUpgradeManager(to, {from: by}));
				});
				it("can't remove existing upgrader", async function() {
					await expectRevert.unspecified(pdn.removeUpgradeManager(to, {from: by}));
				});
				it("can't pause contract", async function() {
					await expectRevert.unspecified(pdn.pause({from: by}));
				});
				it("can't unpause contract", async function() {
					await pdn.pause({from: a0});
					await expectRevert.unspecified(pdn.unpause({from: by}));
				});
				it("can't transfer admin role", async function() {
					await expectRevert.unspecified(pdn.transferAdmin(to, {from: by}));
				});
				it("can't grant a new role", async function() {
					await expectRevert.unspecified(pdn.grantRole(ROLE_CREATE_MANAGER, to, {from: by}));
				});
				it("can't revoke an existing role", async function() {
					await expectRevert.unspecified(pdn.revokeRole(ROLE_CREATE_MANAGER, to, {from: by}));
				});
			});
			describe("when contract is paused", function() {
				beforeEach(async function() {
					await pdn.pause({from: a0});
				});
				it("lender creation reverts", async function() {
					await expectRevert(pdn.createLender("lender", "user", "hash", {from: by}), "Pausable: paused");
				});
				it("pool creation reverts", async function() {
					await expectRevert(pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: by}), "Pausable: paused");
				});
				it("add payment reverts", async function() {
					await expectRevert(pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: by}), "Pausable: paused");
				});
				it("grant role reverts", async function() {
					await expectRevert(pdn.grantRole(ROLE_CREATE_MANAGER, by, {from: a0}), "Pausable: paused");
				});
				it("revoke role reverts", async function() {
					await expectRevert(pdn.revokeRole(ROLE_CREATE_MANAGER, by, {from: a0}), "Pausable: paused");
				});
			});
			describe("create lender", function() {
				beforeEach(async function() {
					await pdn.createLender("lender", "user", "hash", {from: a0});
				});
				it("fails if lender id already exists", async function() {
					await expectRevert.unspecified(pdn.createLender("lender", "user", "hash", {from: a0}));
				});
				it("succeed otherwise", async function() {
					await pdn.createLender("lender1", "user", "hash", {from: a0});
				});
				it("emit lender added event", async function() {
					expectEvent(await pdn.createLender("lender1", "user", "hash", {from: a0}), 'LenderAdded', {
						_lenderId: "0xe13fac35daadc41e71f6ce847a03e52253d424293815d5304cce881b14a414b0", // keccak_256(lender1)
						_userId: "user",
						_metaHash: "hash",
					});
				});
			});
			describe("create pool", function() {
				beforeEach(async function() {
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
				});
				it("fails if pool id already exists", async function() {
					await expectRevert.unspecified(pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0}));
				});
				it("succeed otherwise", async function() {
					await pdn.createPool("pool1", "pm", "hash", 0, 10, 20, 30, {from: a0});
				});
				it("emit pool added event", async function() {
					expectEvent(await pdn.createPool("pool1", "pm", "hash", 0, 10, 20, 30, {from: a0}), 'PoolAdded', {
						_poolId: "0xd2dd734abc5b00cd944e9263bc784f05764df8a693313e71125ba239d5d3103c", // keccak_256(pool1)
						_poolManagerId: "pm",
						_metaHash: "hash",
						_ratings: BN(0),
						_inceptionTime: BN(10),
						_expiryTime: BN(20),
						_poolSize: BN(30)
					});
				});
			});
			describe("add payment", function() {
				beforeEach(async function() {
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
					await pdn.createLender("lender", "user", "hash", {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: a0});
				});
				it("fails if payment id exists", async function() {
					await expectRevert.unspecified(pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: a0}));
				});
				it("fails if lender id do not exist", async function() {
					await expectRevert.unspecified(pdn.addPayment("pay", "lender1", "pool", 100, 0, 0, 10, {from: a0}));
				});
				it("fails if pool id do not exist", async function() {
					await expectRevert.unspecified(pdn.addPayment("pay", "lender", "pool1", 100, 0, 0, 10, {from: a0}));
				});
				it("fails if inputs are invalid", async function() {
					await expectRevert.unspecified(pdn.addPayment("pay", "lender", "pool", 100, 10, 0, 10, {from: a0}));
				});
				it("succeed otherwise", async function() {
					await pdn.addPayment("pay", "lender", "pool", 100, 0, 0, 10, {from: a0});
				});
				it("should update investment amount in lender and pool data", async function() {
					await pdn.addPayment("pay", "lender", "pool", 100, 0, 0, 10, {from: a0});
					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalInvested).to.be.bignumber.equals(BN(200));
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(200));
				});
				it("should update payment amount in lender and pool data", async function() {
					await pdn.addPayment("pay", "lender", "pool", 100, 10, 1, 10, {from: a0});
					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalReceived).to.be.bignumber.equals(BN(110));
					expect(pool.totalPayment).to.be.bignumber.equals(BN(110));
				});
				it("emit payment added event", async function() {
					expectEvent(await pdn.addPayment("pay", "lender", "pool", 100, 0, 0, 10, {from: a0}), 'PaymentAdded', {
						_paymentId: "0xadc756803e4eb4ccfb136b73d5f72e3dc0d452d30ae1f4bc82af394c73ce7115", // keccak_256(pay)
						_lenderId: "lender",
						_poolId: "pool",
						_principal: BN(100),
						_coupon: BN(0),
						_paymentType: BN(0),
						_timeStamp: BN(10)
					});
				});
			});
		});
	}

	// run the suite
	test_suite("SIGMA_PDN");
});