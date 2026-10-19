// CsigmaPDN: Unit Tests

// Zeppelin test helpers
const {
	BN,
	constants,
	expectEvent,
	expectRevert,
} = require("@openzeppelin/test-helpers");

// const { expect } = require("chai");
const { ethers } = require("hardhat");
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
	get_sigmaPDN_deployment,
    get_sigmaPDNv1_1_deployment,
	get_sigmaPDN_upgradeable_deployment,
	get_sigmaPDNv1_1_upgradeable_deployment
} = require("../include/deployment_fixture_routines");
const { ZeroAddress } = require("ethers");

// run Unit tests
contract("CsigmaPDN: Unit tests", function(accounts) {
	// extract accounts to be used:
	// A0 – special default zero account accounts[0] used by Truffle, reserved
	// a0 – deployment account having all the permissions, reserved
	// H0 – initial token holder account
	// a1, a2,... – working accounts to perform tests on
	const [A0, a0, H0, a1, a2, lenderAcc1, lenderAcc2] = accounts;
	const ROLE_CREATE_MANAGER = "0x1694924e8b02ad9ed093ee2e818c411a91043151d33cb90a301009fc9ebba0e1";
    const ROLE_UPGRADE_MANAGER = "0x7bc03dd4c626a643aa85428e185011e877bed9d0da9f90f563f8eb5bbebca45e";
    const ROLE_EDIT_MANAGER = "0xcb86229392ae4670ab0ecaf94455d737d51cabe839f7a44e0a9421d3690c4920";
	const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
	const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

	// define test suite: it will be reused to test several contracts
	function test_suite(contract_name, deployment_fn) {
		describe(`${contract_name}: ACL`, function() {
			// deploy contracts
			let pdn, pdnImpl, pdnNFT;
			// const PDNNFT = artifacts.require("CsigmaPDNInvestmentNFT");
			beforeEach(async function() {
				// a0 and H0 are ignored when using a fixture
				pdn = await deployment_fn.call(this, a0, H0);
				pdnImpl = await get_sigmaPDN_deployment.call(this, a0, H0);
                pdnImplv1_1 = await get_sigmaPDNv1_1_deployment.call(this, a0, H0);
                await pdn.grantRole(ROLE_CREATE_MANAGER, a0, {from: a0});

				// let pdnNFT_deployed = await deployment_fn.call(this, a0, H0);
				// pdnNFTImpl = await get_CsigmaPDNInvestmentNFT_deployment.call(this, a0, H0);
                // await pdnNFT_deployed.upgradeTo(pdnNFTImpl.address, {from:a0});
                // const Contract1 = artifacts.require("./CsigmaPDNInvestmentNFT");
                // pdnNFT = await Contract1.at(pdnNFT_deployed.address);

				// // await pdn.

				// deploy NFT
				
				// await pdnNFT.grantRole("0xf206625bad3d9112d5609b8d356e6fbd514cd1f69980d4ce2b3e6e68e1789ace", pdn.address, { from: a0 });
				// pdnNFT = await PDNNFT.new({ from: a0 });
				
				const PDNNFT = await ethers.getContractFactory("CsigmaPDNInvestmentNFT");
				pdnNFT = await PDNNFT.deploy();
				proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
				proxy = await proxyFactory.deploy(await pdnNFT.getAddress(), "0x");
				pdnNFT = await ethers.getContractAt("CsigmaPDNInvestmentNFT", await proxy.getAddress());
				await pdnNFT.initialize(
					"PDN Investment NFT",
					"PDN-NFT",
					"https://metadata.csigma.finance/",
					a0,
					pdn.address
				);
				// wire NFT to PDN
				// pdnNFT.
            });
			
			const by = a1;
			const from = H0;
			const to = a2;
			const value = 1;
			
			describe("when operator has ROLE_CREATE_MANAGER", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_CREATE_MANAGER, by, {from: a0});
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await expectRevert.unspecified(pdn.updateInvestmentNFT(ZERO_ADDRESS, { from: by}));
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by});
				});
				it("lender creation succeeds", async function() {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: by});
					const lender = await pdn.lenders("lender");
					expect(lender.userId).to.be.equals("user");
					expect(lender.metaHash).to.be.equals("hash");
					expect(await pdn.lenderWallet("lender")).to.be.equals(lenderAcc1);
					expect(lender.totalInvested).to.be.bignumber.equals(BN(0));
					expect(lender.totalReceived).to.be.bignumber.equals(BN(0));
				});
				it("lender creation batch succeeds", async function() {
					const lender1 = {lenderId: "lender1", userId: "user1", metaHash: "hash1"};
					const lender2 = {lenderId: "lender2", userId: "user2", metaHash: "hash2"};
					await pdn.createLenderBatch([lender1, lender2], [lenderAcc1, lenderAcc2], {from: by});
					const lenderData1 = await pdn.lenders("lender1");
					const lenderData2 = await pdn.lenders("lender2"); 
					expect(lenderData1.userId).to.be.equals("user1");
					expect(lenderData1.metaHash).to.be.equals("hash1");
					expect(await pdn.lenderWallet("lender1")).to.be.equals(lenderAcc1);
					expect(lenderData2.userId).to.be.equals("user2");
					expect(lenderData2.metaHash).to.be.equals("hash2");
					expect(await pdn.lenderWallet("lender2")).to.be.equals(lenderAcc2);
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
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: by});
					expect(await pdnNFT.nextTokenId()).to.be.equals(1);
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: by});
					const payment = await pdn.payments("pay1"); 
					expect(payment.lenderId).to.be.equals("lender");
					expect(payment.poolId).to.be.equals("pool");
					expect(payment.principal).to.be.bignumber.equals(BN(100));
					expect(payment.coupon).to.be.bignumber.equals(BN(0));
					expect(payment.paymentType).to.be.bignumber.equals(BN(0));
					expect(payment.timeStamp).to.be.bignumber.equals(BN(10));
					expect(await pdnNFT.tokenURI(1)).to.be.equals("https://metadata.csigma.finance/1");
					expect(await pdnNFT.nextTokenId()).to.be.equals(2);
					await expectRevert.unspecified(pdnNFT.connect(await ethers.getSigner(by)).setBaseURI("https://testmetadata.csigma.finance"));
					await pdnNFT.connect(await ethers.getSigner(a0)).setBaseURI("https://testmetadata.csigma.finance/");
					expect(await pdnNFT.tokenURI(1)).to.be.equals("https://testmetadata.csigma.finance/1");

					const metadata = await pdnNFT.investmentData(1); 
					expect(metadata.lenderId).to.be.equals("lender");
					expect(metadata.poolId).to.be.equals("pool");
					expect(metadata.totalInvestment).to.be.equals(100);
					expect(metadata.outstandingPrincipal).to.be.equals(100);
					expect(metadata.outstandingCoupon).to.be.equals(0);
					expect(metadata.totalRepaid).to.be.equals(0);

					const owner = await pdnNFT.ownerOf(1);
					expect(owner).to.be.equals(lenderAcc1);
				});
				
				it("update coupon metadata batch succeeds", async function() {
					await pdn.createLender("lender1", "user", "hash", lenderAcc1, {from: by});
					await pdn.createPool("pool1", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.createLender("lender2", "user", "hash", lenderAcc2, {from: by});
					await pdn.createPool("pool2", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.addPayment("pay1", "lender1", "pool1", 100, 0, 0, 10, {from: by});
					await pdn.addPayment("pay2", "lender2", "pool2", 100, 0, 0, 10, {from: by});
					await pdn.updateCouponInMetadataBatch([1,2], [45,10], {from: a0});
					const payment1 = {paymentId: "pay3", lenderId: "lender1", poolId: "pool1", principal: 100, coupon: 5, paymentType: 1, timeStamp: 10};
					const payment2 = {paymentId: "pay4", lenderId: "lender2", poolId: "pool2", principal: 100, coupon: 10, paymentType: 1, timeStamp: 20};
					await pdn.addPaymentBatch([payment1, payment2], {from: by});

					const nft1 = await pdnNFT.investmentData(1);
					const nft2 = await pdnNFT.investmentData(2);
					expect(nft1.lenderId).to.equal("lender1");
					expect(nft1.poolId).to.equal("pool1");
					expect(nft1.totalInvestment).to.equal(100);
					expect(nft1.outstandingPrincipal).to.equal(0);
					expect(nft1.outstandingCoupon).to.equal(40);
					expect(nft1.totalRepaid).to.equal(105);

					expect(nft2.lenderId).to.equal("lender2");
					expect(nft2.poolId).to.equal("pool2");
					expect(nft2.totalInvestment).to.equal(100);
					expect(nft2.outstandingPrincipal).to.equal(0);
					expect(nft2.outstandingCoupon).to.equal(0);
					expect(nft2.totalRepaid).to.equal(110);
				});

				it("update coupon metadata batch Fails due to invalid access", async function() {
					await pdn.createLender("lender1", "user", "hash", lenderAcc1, {from: by});
					await pdn.createPool("pool1", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.createLender("lender2", "user", "hash", lenderAcc2, {from: by});
					await pdn.createPool("pool2", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.addPayment("pay1", "lender1", "pool1", 100, 0, 0, 10, {from: by});
					await pdn.addPayment("pay2", "lender2", "pool2", 100, 0, 0, 10, {from: by});
					await expectRevert.unspecified(pdn.updateCouponInMetadataBatch([1,2], [45,10], {from: lenderAcc1}));
				});
				it("add payment batch succeeds", async function() {
					await pdn.createLender("lender1", "user", "hash", lenderAcc1, {from: by});
					await pdn.createPool("pool1", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.createLender("lender2", "user", "hash", lenderAcc2, {from: by});
					await pdn.createPool("pool2", "pm", "hash", 0, 10, 20, 30, {from: by});
					await pdn.addPayment("pay1", "lender1", "pool1", 100, 0, 0, 10, {from: by});
					await pdn.addPayment("pay2", "lender2", "pool2", 100, 0, 0, 10, {from: by});
					await pdn.updateCouponInMetadata(2, 10, {from: a0});
					const payment1 = {paymentId: "pay3", lenderId: "lender1", poolId: "pool1", principal: 100, coupon: 0, paymentType: 0, timeStamp: 10};
					const payment2 = {paymentId: "pay4", lenderId: "lender2", poolId: "pool2", principal: 100, coupon: 10, paymentType: 1, timeStamp: 20};
					await pdn.addPaymentBatch([payment1, payment2], {from: by});
					const pay1 = await pdn.payments("pay3");
					const pay2 = await pdn.payments("pay4"); 
					expect(pay1.lenderId).to.be.equals("lender1");
					expect(pay1.poolId).to.be.equals("pool1");
					expect(pay1.principal).to.be.bignumber.equals(BN(100));
					expect(pay1.coupon).to.be.bignumber.equals(BN(0));
					expect(pay1.paymentType).to.be.bignumber.equals(BN(0));
					expect(pay1.timeStamp).to.be.bignumber.equals(BN(10));
					expect(pay2.lenderId).to.be.equals("lender2");
					expect(pay2.poolId).to.be.equals("pool2");
					expect(pay2.principal).to.be.bignumber.equals(BN(100));
					expect(pay2.coupon).to.be.bignumber.equals(BN(10));
					expect(pay2.paymentType).to.be.bignumber.equals(BN(1));
					expect(pay2.timeStamp).to.be.bignumber.equals(BN(20));
				});
                it("add fee succeeds", async function() {
					await pdn.addFee("pay1", "lender", "pool", 100, 10, {from: by});
					const payment = await pdn.payments("pay1"); 
					expect(payment.lenderId).to.be.equals("lender");
					expect(payment.poolId).to.be.equals("pool");
					expect(payment.principal).to.be.bignumber.equals(BN(100));
					expect(payment.coupon).to.be.bignumber.equals(BN(0));
					expect(payment.paymentType).to.be.bignumber.equals(BN(2));
					expect(payment.timeStamp).to.be.bignumber.equals(BN(10));
				});
                it("add fee batch succeeds", async function() {
					const payment1 = {paymentId: "pay1", lenderId: "lender1", poolId: "pool1", principal: 100, coupon: 0, paymentType: 2, timeStamp: 10};
					const payment2 = {paymentId: "pay2", lenderId: "lender2", poolId: "pool2", principal: 200, coupon: 0, paymentType: 2, timeStamp: 20};
					await pdn.addFeeBatch([payment1, payment2], {from: by});
					const pay1 = await pdn.payments("pay1");
					const pay2 = await pdn.payments("pay2"); 
					expect(pay1.lenderId).to.be.equals("lender1");
					expect(pay1.poolId).to.be.equals("pool1");
					expect(pay1.principal).to.be.bignumber.equals(BN(100));
					expect(pay1.coupon).to.be.bignumber.equals(BN(0));
					expect(pay1.paymentType).to.be.bignumber.equals(BN(2));
					expect(pay1.timeStamp).to.be.bignumber.equals(BN(10));
					expect(pay2.lenderId).to.be.equals("lender2");
					expect(pay2.poolId).to.be.equals("pool2");
					expect(pay2.principal).to.be.bignumber.equals(BN(200));
					expect(pay2.coupon).to.be.bignumber.equals(BN(0));
					expect(pay2.paymentType).to.be.bignumber.equals(BN(2));
					expect(pay2.timeStamp).to.be.bignumber.equals(BN(20));
				});
			});
			describe("when operator does not have ROLE_CREATE_MANAGER", function() {
				beforeEach(async function() {
					await pdn.revokeRole(ROLE_CREATE_MANAGER, by, {from: a0});
				});
				it("lender creation reverts", async function() {
					await expectRevert.unspecified(pdn.createLender("lender", "user", "hash", lenderAcc1, {from: by}));
				});
				it("pool creation reverts", async function() {
					await expectRevert.unspecified(pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: by}));
				});
				it("add payment reverts", async function() {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
					await expectRevert.unspecified(pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: by}));
				});
                it("add fee reverts", async function() {
					await expectRevert.unspecified(pdn.addFee("pay1", "lender", "pool", 100, 10, {from: by}));
				});
			});
			describe("when operator has UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_UPGRADE_MANAGER, by, {from: a0});
				});
				it("upgrade succeeds", async function() {
					await pdn.upgradeTo(pdnImpl.address, {from: by});
				});
			});
			describe("when operator does not have UPGRADER_ROLE", function() {
				beforeEach(async function() {
					await pdn.revokeRole(ROLE_UPGRADE_MANAGER, by, {from: a0});
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
					await pdn.grantRole(ROLE_CREATE_MANAGER, to, {from: by});
					expect(await pdn.hasRole(ROLE_CREATE_MANAGER, to)).to.be.equals(true);
				});
				it("can remove existing create manager", async function() {
					await pdn.revokeRole(ROLE_CREATE_MANAGER, to, {from: by});
					expect(await pdn.hasRole(ROLE_CREATE_MANAGER, to)).to.be.equals(false);
				});
				it("can add new upgrader", async function() {
					await pdn.grantRole(ROLE_UPGRADE_MANAGER, to, {from: by});
					expect(await pdn.hasRole(ROLE_UPGRADE_MANAGER, to)).to.be.equals(true);
				});
				it("can remove existing upgrader", async function() {
					await pdn.revokeRole(ROLE_UPGRADE_MANAGER, to, {from: by});
					expect(await pdn.hasRole(ROLE_UPGRADE_MANAGER, to)).to.be.equals(false);
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
					await expectRevert.unspecified(pdn.grantRole(ROLE_CREATE_MANAGER, to, {from: by}));
				});
				it("can't remove existing create manager", async function() {
					await expectRevert.unspecified(pdn.revokeRole(ROLE_CREATE_MANAGER, to, {from: by}));
				});
				it("can't add new upgrader", async function() {
					await expectRevert.unspecified(pdn.grantRole(ROLE_UPGRADE_MANAGER, to, {from: by}));
				});
				it("can't remove existing upgrader", async function() {
					await expectRevert.unspecified(pdn.revokeRole(ROLE_UPGRADE_MANAGER, to, {from: by}));
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
					await expectRevert(pdn.createLender("lender", "user", "hash", lenderAcc1, {from: by}), "Pausable: paused");
				});
				it("pool creation reverts", async function() {
					await expectRevert(pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: by}), "Pausable: paused");
				});
				it("add payment reverts", async function() {
					await expectRevert(pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: by}), "Pausable: paused");
				});
                it("add fee reverts", async function() {
					await expectRevert(pdn.addFee("pay1", "lender", "pool", 100, 10, {from: by}), "Pausable: paused");
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
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
					let lenderDetails = await pdn.lenders("lender");
					expect(lenderDetails[0]).to.be.equals("user");
					expect(lenderDetails[1]).to.be.equals("hash");
					expect(lenderDetails[2]).to.be.equals(0);
					expect(lenderDetails[3]).to.be.equals(0);
					let lenderWallet = await pdn.lenderWallet("lender");
					expect(lenderWallet).to.be.equals(lenderAcc1);
				});
				it("fails if lender id already exists", async function() {
					await expectRevert.unspecified(pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0}));
				});
				it("succeed otherwise", async function() {
					await pdn.createLender("lender1", "user", "hash", lenderAcc1, {from: a0});
				});
				it("emit lender added event", async function() {
					expectEvent(await pdn.createLender("lender1", "user", "hash", lenderAcc1, {from: a0}), 'LenderAdded', {
						_lenderId: "0xe13fac35daadc41e71f6ce847a03e52253d424293815d5304cce881b14a414b0", // keccak_256(lender1)
						_userId: "user",
						_metaHash: "hash",
					});
				});
				it("updated lenderWallet", async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateLenderWallet("lender", lenderAcc2, {from:by});
					let lenderWallet = await pdn.lenderWallet("lender");
					expect(lenderWallet).to.be.equals(lenderAcc2);
				});

				it("emit lender wallet updation event", async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					// UpdatedLenderWallet(string indexed _lenderId, address _oldLenderWallet, address _newLenderWallet);
					expectEvent(await pdn.updateLenderWallet("lender", lenderAcc2, {from:by}), 'UpdatedLenderWallet', {
						_lenderId: "0x57c66d3d85e0eb55b3720781fbd6803baef59f40ea1e66c38dd54ae65a51202e", 
						_oldLenderWallet: lenderAcc1,
						_newLenderWallet: lenderAcc2
					});
				});

				it("fail to updated lenderWallet without edit manager role", async function() {
					await expectRevert.unspecified(pdn.updateLenderWallet("lender", lenderAcc2, {from: a0}));
				});

				it("fail to updated lenderWallet of invalid lender", async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await expectRevert.unspecified(pdn.updateLenderWallet("lender1", lenderAcc2, {from: by}));
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
			describe("mintLegacyInvestmentNFTBatch", function () {
				beforeEach(async function () {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by });

					await pdn.createLender("lender1", "user1", "hash1", lenderAcc1, { from: a0 });
					await pdn.createLender("lender2", "user2", "hash2", lenderAcc2, { from: a0 });

					await pdn.createPool("pool1", "pm1", "hash1", 0, 10, 20, 1000, { from: a0 });
					await pdn.createPool("pool2", "pm2", "hash2", 0, 10, 20, 1000, { from: a0 });
				});

				it("mints investment NFTs in batch successfully", async function () {
					const data = [
						{
							lenderId: "lender1",
							poolId: "pool1",
							totalInvestment: 500,
							outstandingPrincipal: 500,
							outstandingCoupon: 0,
							totalRepaid: 0
						},
						{
							lenderId: "lender2",
							poolId: "pool2",
							totalInvestment: 800,
							outstandingPrincipal: 800,
							outstandingCoupon: 0,
							totalRepaid: 0
						}
					];

					await pdn.mintLegacyInvestmentNFTBatch(data, { from: a0 });

					const nft1 = await pdnNFT.investmentData(1);
					const nft2 = await pdnNFT.investmentData(2);

					expect(nft1.lenderId).to.equal("lender1");
					expect(nft1.poolId).to.equal("pool1");
					expect(nft1.totalInvestment).to.equal(500);

					expect(nft2.lenderId).to.equal("lender2");
					expect(nft2.poolId).to.equal("pool2");
					expect(nft2.totalInvestment).to.equal(800);

					expect(await pdnNFT.ownerOf(1)).to.equal(lenderAcc1);
					expect(await pdnNFT.ownerOf(2)).to.equal(lenderAcc2);
				});

				it("uses PDN contract as owner when lenderWallet is zero address", async function () {
					const data = [
						{
							lenderId: "lender1",
							poolId: "pool1",
							totalInvestment: 500,
							outstandingPrincipal: 500,
							outstandingCoupon: 0,
							totalRepaid: 0
						}
					];

					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateLenderWallet("lender1", ZeroAddress, {from:by});

					await pdn.mintLegacyInvestmentNFTBatch(data, { from: a0 });

					expect(await pdnNFT.ownerOf(1)).to.equal(pdn.address);
				});

				it("reverts if lender does not exist", async function () {
					const data = [
						{
							lenderId: "invalid-lender",
							poolId: "pool1",
							totalInvestment: 500,
							outstandingPrincipal: 500,
							outstandingCoupon: 0,
							totalRepaid: 0
						}
					];

					await expectRevert.unspecified(
						pdn.mintLegacyInvestmentNFTBatch(data, { from: a0 })
					);
				});

				it("reverts if pool does not exist", async function () {
					const data = [
						{
							lenderId: "lender1",
							poolId: "invalid-pool",
							totalInvestment: 500,
							outstandingPrincipal: 500,
							outstandingCoupon: 0,
							totalRepaid: 0
						}
					];

					await expectRevert.unspecified(
						pdn.mintLegacyInvestmentNFTBatch(data, { from: a0 })
					);
				});

				it("reverts when caller does not have ROLE_CREATE_MANAGER", async function () {
					const data = [
						{
							lenderId: "lender1",
							poolId: "pool1",
							totalInvestment: 500,
							outstandingPrincipal: 500,
							outstandingCoupon: 0,
							totalRepaid: 0
						}
					];

					await expectRevert.unspecified(
						pdn.mintLegacyInvestmentNFTBatch(data, { from: a1 })
					);
				});
			});

			describe("NFT Transfer Restrictions", function () {
				beforeEach(async function () {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, { from: a0 });
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by });

					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 1000, { from: a0 });

					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, { from: a0 });

					expect(await pdnNFT.ownerOf(1)).to.equal(lenderAcc1);
				});

				it("reverts when lender tries to transfer NFT", async function () {
					await expectRevert.unspecified(
						pdnNFT.connect(await ethers.getSigner(lenderAcc1)).transferFrom(lenderAcc1, lenderAcc2, 1)
					);
				});

				it("reverts when approved address tries to transfer NFT", async function () {
					await pdnNFT.connect(await ethers.getSigner(lenderAcc1)).approve(a1, 1);

					await expectRevert.unspecified(
						pdnNFT.connect(await ethers.getSigner(a1)).transferFrom(lenderAcc1, lenderAcc2, 1)
					);
				});

				it("reverts when operator tries to transfer NFT via setApprovalForAll", async function () {
					await pdnNFT.connect(await ethers.getSigner(lenderAcc1)).setApprovalForAll(a1, true);

					await expectRevert.unspecified(
						pdnNFT.connect(await ethers.getSigner(a1)).transferFrom(lenderAcc1, lenderAcc2, 1)
					);
				});

				it("reverts when lender tries safeTransferFrom", async function () {
					await expectRevert.unspecified(
						pdnNFT.connect(await ethers.getSigner(lenderAcc1)).safeTransferFrom(lenderAcc1, lenderAcc2, 1)
					);
				});

				it("reverts when transferring to zero address", async function () {
					await expectRevert.unspecified(
						pdnNFT.connect(await ethers.getSigner(lenderAcc1)).transferFrom(lenderAcc1, ZERO_ADDRESS, 1)
					);
				});
			});

			describe("claimLegacyInvestmentNFTs", function () {
				beforeEach(async function () {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, { from: a0 });
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by });

					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 1000, { from: a0 });

					const data = [{
						lenderId: "lender",
						poolId: "pool",
						totalInvestment: 100,
						outstandingPrincipal: 100,
						outstandingCoupon: 0,
						totalRepaid: 0
					}];

					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateLenderWallet("lender", ZeroAddress, {from:by});

					await pdn.mintLegacyInvestmentNFTBatch(
						data,
						{ from: a0 }
					);
				});

				it("allows lender to claim their NFTs", async function () {
					expect(await pdnNFT.ownerOf(1)).to.equal(pdn.address);

					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateLenderWallet("lender", lenderAcc1, {from:by});

					await pdn.claimLegacyInvestmentNFTs([1], { from: lenderAcc1 });

					expect(await pdnNFT.ownerOf(1)).to.equal(lenderAcc1);
				});
				it("reverts if caller is not lender wallet", async function () {
					await expectRevert.unspecified(
						pdn.claimLegacyInvestmentNFTs([1], { from: a1 })
					);
				});

				it("reverts if contract is paused", async function () {
					await pdn.pause({ from: a0 });

					await expectRevert(
						pdn.claimLegacyInvestmentNFTs([1], { from: lenderAcc1 }),
						"Pausable: paused"
					);
				});
			});

			describe("reassignInvestmentNFTs", function () {
				beforeEach(async function () {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, { from: a0 });
					await pdn.grantRole(ROLE_CREATE_MANAGER, by, { from: a0 });
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by });
					await pdn.createPool("poolA", "pm", "hash", 0, 10, 20, 1000, { from: a0 });
					await pdn.createPool("poolB", "pm", "hash", 0, 10, 20, 1000, { from: a0 });
				});

				it("moves an NFT to the newly registered wallet, and every other read stays in sync", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.addPayment("inv1", "lender", "poolA", 100, 0, 0, 10, { from: by });
					const tokenId = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc1);

					const metaBefore = await pdnNFT.investmentData(tokenId);
					const lenderBefore = await pdn.lenders("lender");

					await pdn.updateLenderWallet("lender", lenderAcc2, { from: by });
					// the wallet write alone moves nothing - the NFT is still at the old address
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc1);

					const receipt = await pdn.reassignInvestmentNFTs("lender", [tokenId], { from: by });

					// custody moved, to the destination read from the mapping
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc2);
					expect(await pdn.lenderWallet("lender")).to.equal(lenderAcc2);
					expectEvent(receipt, 'InvestmentNFTReassigned', {
						_tokenId: BN(tokenId),
						_newWallet: lenderAcc2
					});

					// everything a wallet rotation must NOT touch: the pair still points at the same
					// token, its metadata is untouched, and the PDN's aggregates for this lender are
					// untouched - only ownerOf() changed, nothing else in the system
					expect((await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber()).to.equal(tokenId);
					const metaAfter = await pdnNFT.investmentData(tokenId);
					expect(metaAfter.lenderId).to.equal(metaBefore.lenderId);
					expect(metaAfter.poolId).to.equal(metaBefore.poolId);
					expect(metaAfter.totalInvestment).to.equal(metaBefore.totalInvestment);
					expect(metaAfter.outstandingPrincipal).to.equal(metaBefore.outstandingPrincipal);
					expect(metaAfter.outstandingCoupon).to.equal(metaBefore.outstandingCoupon);
					expect(metaAfter.totalRepaid).to.equal(metaBefore.totalRepaid);
					const lenderAfter = await pdn.lenders("lender");
					expect(lenderAfter.totalInvested).to.be.bignumber.equal(lenderBefore.totalInvested);
					expect(lenderAfter.totalReceived).to.be.bignumber.equal(lenderBefore.totalReceived);

					// and the system keeps working afterward: a payment posted after the rotation
					// still finds and updates this same token, without moving it again
					await pdn.addPayment("pay1", "lender", "poolA", 0, 0, 1, 20, { from: by });
					const metaFinal = await pdnNFT.investmentData(tokenId);
					expect(metaFinal.outstandingPrincipal).to.equal(metaBefore.outstandingPrincipal); // 0-value payment, unchanged
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc2);
				});

				it("migrates a multi-token lender across separate batched calls", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.createPool("poolC", "pm", "hash", 0, 10, 20, 1000, { from: a0 });
					await pdn.addPayment("inv1", "lender", "poolA", 100, 0, 0, 10, { from: by });
					await pdn.addPayment("inv2", "lender", "poolB", 50, 0, 0, 10, { from: by });
					await pdn.addPayment("inv3", "lender", "poolC", 25, 0, 0, 10, { from: by });
					const idA = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();
					const idB = (await pdn.getlenderPoolToTokenId("lender", "poolB")).toNumber();
					const idC = (await pdn.getlenderPoolToTokenId("lender", "poolC")).toNumber();
					expect(Number(await pdnNFT.balanceOf(lenderAcc1))).to.equal(3);

					await pdn.updateLenderWallet("lender", lenderAcc2, { from: by });

					await pdn.reassignInvestmentNFTs("lender", [idA, idB], { from: by }); // batch 1
					expect(Number(await pdnNFT.balanceOf(lenderAcc1))).to.equal(1); // partial, and that is fine
					expect(Number(await pdnNFT.balanceOf(lenderAcc2))).to.equal(2);

					await pdn.reassignInvestmentNFTs("lender", [idC], { from: by }); // batch 2

					expect(Number(await pdnNFT.balanceOf(lenderAcc1))).to.equal(0); // drained: migration complete
					expect(Number(await pdnNFT.balanceOf(lenderAcc2))).to.equal(3);
					expect(await pdnNFT.ownerOf(idA)).to.equal(lenderAcc2);
					expect(await pdnNFT.ownerOf(idB)).to.equal(lenderAcc2);
					expect(await pdnNFT.ownerOf(idC)).to.equal(lenderAcc2);
				});

				it("lets the lender complete their own migration from the newly registered wallet", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.addPayment("inv1", "lender", "poolA", 100, 0, 0, 10, { from: by });
					const tokenId = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();

					await pdn.updateLenderWallet("lender", lenderAcc2, { from: by });
					await pdn.reassignInvestmentNFTs("lender", [tokenId], { from: lenderAcc2 });

					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc2);
				});

				it("reverts when the caller is neither an edit manager nor the registered wallet", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.addPayment("inv1", "lender", "poolA", 100, 0, 0, 10, { from: by });
					const tokenId = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();
					await pdn.updateLenderWallet("lender", lenderAcc2, { from: by });
					await expectRevert.unspecified(
						pdn.reassignInvestmentNFTs("lender", [tokenId], { from: H0 })
					);
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc1); // nothing moved
				});

				it("reverts when the lender has no registered wallet to reassign to", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.addPayment("inv1", "lender", "poolA", 100, 0, 0, 10, { from: by });
					const tokenId = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();
					await pdn.updateLenderWallet("lender", ZeroAddress, { from: by });

					// destination would be address(0); rejected up front rather than deep inside the NFT
					await expectRevert.unspecified(
						pdn.reassignInvestmentNFTs("lender", [tokenId], { from: by })
					);
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc1);
					await expectRevert.unspecified(
						pdn.reassignInvestmentNFTs("lender", [], { from: by })
					);
				});

				it("leaves an escrowed NFT alone, and it still claims to the current wallet", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.updateLenderWallet("lender", ZeroAddress, { from: by });
					await pdn.mintLegacyInvestmentNFTBatch(
						[{ lenderId: "lender", poolId: "poolA", totalInvestment: 500, outstandingPrincipal: 500, outstandingCoupon: 0, totalRepaid: 0 }],
						{ from: by }
					);
					const tokenId = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(pdn.address); // escrowed

					await pdn.updateLenderWallet("lender", lenderAcc2, { from: by });

					await pdn.claimLegacyInvestmentNFTs([tokenId], { from: lenderAcc2 });
					expect(await pdnNFT.ownerOf(tokenId)).to.equal(lenderAcc2);
				});

				it("reverts if an escrowed token is named, since that path is claim, not reassign", async function () {

					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.updateLenderWallet("lender", ZeroAddress, { from: by });
					await pdn.mintLegacyInvestmentNFTBatch(
						[{ lenderId: "lender", poolId: "poolA", totalInvestment: 500, outstandingPrincipal: 500, outstandingCoupon: 0, totalRepaid: 0 }],
						{ from: by }
					);
					const escrowedId = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();
					await pdn.updateLenderWallet("lender", lenderAcc2, { from: by });
					expect(await pdnNFT.ownerOf(escrowedId)).to.equal(pdn.address);

					await expectRevert.unspecified(
						pdn.reassignInvestmentNFTs("lender", [escrowedId], { from: by })
					);
					expect(await pdnNFT.ownerOf(escrowedId)).to.equal(pdn.address); // untouched
				});

				it("reverts if a tokenId belongs to a different lender", async function () {
					await pdn.createLender("lenderA", "userA", "hash", lenderAcc1, { from: a0 });
					await pdn.createLender("lenderB", "userB", "hash", lenderAcc2, { from: a0 });
					await pdn.addPayment("invB", "lenderB", "poolB", 50, 0, 0, 10, { from: by });
					const otherToken = (await pdn.getlenderPoolToTokenId("lenderB", "poolB")).toNumber();

					// lenderA's rotation must not be able to drag lenderB's token along with it
					await expectRevert.unspecified(
						pdn.reassignInvestmentNFTs("lenderA", [otherToken], { from: by })
					);
					expect(await pdnNFT.ownerOf(otherToken)).to.equal(lenderAcc2); // still lenderB's
				});

				it("reverts on a duplicate tokenId, so overlapping batches cannot double-apply", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.addPayment("inv1", "lender", "poolA", 100, 0, 0, 10, { from: by });
					const idA = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();
					await pdn.updateLenderWallet("lender", lenderAcc2, { from: by });

					// the first occurrence moves it; the second finds it already at the destination
					// and managerTransfer's to == from guard rejects the no-op
					await expectRevert.unspecified(
						pdn.reassignInvestmentNFTs("lender", [idA, idA], { from: by })
					);
					expect(await pdnNFT.ownerOf(idA)).to.equal(lenderAcc1); // whole call rolled back
				});

				it("reverts when a non-manager address calls managerTransfer directly on the NFT", async function () {
					await pdn.createLender("lender", "user", "hash", lenderAcc1, { from: a0 });
					await pdn.addPayment("inv1", "lender", "poolA", 100, 0, 0, 10, { from: by });
					const tokenId = (await pdn.getlenderPoolToTokenId("lender", "poolA")).toNumber();

					await expectRevert.unspecified(
						pdnNFT.connect(await ethers.getSigner(a1)).managerTransfer(tokenId, lenderAcc2)
					);
				});
			});

			describe("add payment", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					const temp = await pdnNFT.investmentData(1);
					expect(temp[0]).to.be.equals("lender");
					expect(temp[1]).to.be.equals("pool");
					expect(temp[2]).to.be.equals(100);
					expect(temp[3]).to.be.equals(100);
					expect(temp[4]).to.be.equals(0);
					expect(temp[5]).to.be.equals(0);
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
					const temp = await pdnNFT.investmentData(1);
					expect(temp[0]).to.be.equals("lender");
					expect(temp[1]).to.be.equals("pool");
					expect(temp[2]).to.be.equals(200);
					expect(temp[3]).to.be.equals(200);
					expect(temp[4]).to.be.equals(0);
					expect(temp[5]).to.be.equals(0);
				});

				it("should update investment metadata", async function() {
					let temp = await pdnNFT.investmentData(1);
					expect(temp[0]).to.be.equals("lender");
					expect(temp[1]).to.be.equals("pool");
					expect(temp[2]).to.be.equals(100);
					expect(temp[3]).to.be.equals(100);
					expect(temp[4]).to.be.equals(0);
					expect(temp[5]).to.be.equals(0);
					let tokenID = await pdn.getlenderPoolToTokenId("lender", "pool");
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdnNFT.connect(await ethers.getSigner(a0)).emergencyUpdateMetadata(tokenID.toNumber(), 800, 300, 250, 550);
					temp = await pdnNFT.investmentData(1);
					expect(temp[0]).to.be.equals("lender");
					expect(temp[1]).to.be.equals("pool");
					expect(temp[2]).to.be.equals(800);
					expect(temp[3]).to.be.equals(300);
					expect(temp[4]).to.be.equals(250);
					expect(temp[5]).to.be.equals(550);
				});

				it("should not be able update investment metadata with invalid access wallet", async function() {
					let tokenID = await pdn.getlenderPoolToTokenId("lender", "pool");
					await expectRevert.unspecified(pdnNFT.connect(await ethers.getSigner(by)).emergencyUpdateMetadata(tokenID.toNumber(), 800, 300, 250, 550));
				});

				it("should update payment amount in lender and pool data", async function() {
					await pdn.updateCouponInMetadata(1, 10, {from: a0});
					let temp = await pdnNFT.investmentData(1);
					expect(temp[4]).to.be.equals(10);
					await pdn.addPayment("pay", "lender", "pool", 100, 10, 1, 10, {from: a0});
					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalReceived).to.be.bignumber.equals(BN(110));
					expect(pool.totalPayment).to.be.bignumber.equals(BN(110));
					temp = await pdnNFT.investmentData(1);
					expect(temp[0]).to.be.equals("lender");
					expect(temp[1]).to.be.equals("pool");
					expect(temp[2]).to.be.equals(100);
					expect(temp[3]).to.be.equals(0);
					expect(temp[4]).to.be.equals(0);
					expect(temp[5]).to.be.equals(110);
				});

				it("should not be able update investment coupon in metadata with invalid access wallet", async function() {
					let tokenID = await pdn.getlenderPoolToTokenId("lender", "pool");
					await expectRevert.unspecified(pdn.updateCouponInMetadata(tokenID, 250, {from: by}));
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
            describe("add Fee", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: a0});
				});
				it("fails if payment id exists", async function() {
					await expectRevert.unspecified(pdn.addFee("pay1", "lender", "pool", 100, 10, {from: a0}));
				});
				it("succeed otherwise", async function() {
					await pdn.addFee("pay", "lender", "pool", 100, 10, {from: a0});
				});
				it("emit payment added event", async function() {
					expectEvent(await pdn.addFee("pay", "lender", "pool", 100, 10, {from: a0}), 'PaymentAdded', {
						_paymentId: "0xadc756803e4eb4ccfb136b73d5f72e3dc0d452d30ae1f4bc82af394c73ce7115", // keccak_256(pay)
						_lenderId: "lender",
						_poolId: "pool",
						_principal: BN(100),
						_coupon: BN(0),
						_paymentType: BN(2),
						_timeStamp: BN(10)
					});
				});
			});
			describe("When operator has ROLE_EDIT_MANAGER", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.updateCouponInMetadata(1, 10, {from: a0});
					await pdn.addPayment("pay2", "lender", "pool", 100, 10, 1, 10, {from: a0});
					await pdn.addFee("pay3", "lender", "pool", 5, 10, {from: a0});
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
				});
				it("Success updating lender fields", async function() {
					expectEvent(await pdn.updateLenderUserId("lender", "user1", {from: by}), 'UpdatedLenderUserId', {
						_lenderId: "0x57c66d3d85e0eb55b3720781fbd6803baef59f40ea1e66c38dd54ae65a51202e",
						_oldUserId: "user",
						_newUserId: "user1"
					});
					expectEvent(await pdn.updateLenderMetaHash("lender", "hash1", {from: by}), 'UpdatedLenderMetaHash', {
						_lenderId: "0x57c66d3d85e0eb55b3720781fbd6803baef59f40ea1e66c38dd54ae65a51202e",
						_oldMetaHash: "hash",
						_newMetaHash: "hash1"
					});
					lender = await pdn.lenders("lender");
					expect(lender.userId).to.be.equals("user1");
					expect(lender.metaHash).to.be.equals("hash1");
				});
				it("Success updating pool fields", async function() {
					expectEvent(await pdn.updatePoolManagerId("pool", "pm1", {from: by}), 'UpdatedPoolManagerId', {
						_poolId: "0xe35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd",
						_oldPoolManagerId: "pm",
						_newPoolManagerId: "pm1"
					});
					expectEvent(await pdn.updatePoolMetaHash("pool", "hash1", {from: by}), 'UpdatedPoolMetaHash', {
						_poolId: "0xe35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd",
						_oldMetaHash: "hash",
						_newMetaHash: "hash1"
					});
					expectEvent(await pdn.updatePoolRatings("pool", 1, {from: by}), 'UpdatedPoolRatings', {
						_poolId: "0xe35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd",
						_oldRatings: BN(0),
						_newRatings: BN(1)
					});
					expectEvent(await pdn.updatePoolInceptionTime("pool", 20, {from: by}), 'UpdatedPoolInceptionTime', {
						_poolId: "0xe35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd",
						_oldInceptionTime: BN(10),
						_newInceptionTime: BN(20)
					});
					expectEvent(await pdn.updatePoolExpiryTime("pool", 30, {from: by}), 'UpdatedPoolExpiryTime', {
						_poolId: "0xe35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd",
						_oldExpiryTime: BN(20),
						_newExpiryTime: BN(30)
					});
					expectEvent(await pdn.updatePoolSize("pool", 40, {from: by}), 'UpdatedPoolSize', {
						_poolId: "0xe35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd",
						_oldPoolSize: BN(30),
						_newPoolSize: BN(40)
					});
					pool = await pdn.pools("pool");
					expect(pool.poolManagerId).to.be.equals("pm1");
					expect(pool.metaHash).to.be.equals("hash1");
					expect(pool.ratings).to.be.bignumber.equals(BN(1));
					expect(pool.inceptionTime).to.be.bignumber.equals(BN(20));
					expect(pool.expiryTime).to.be.bignumber.equals(BN(30));
					expect(pool.poolSize).to.be.bignumber.equals(BN(40));
				});
				it("Success updating payment fields", async function() {
					expectEvent(await pdn.updatePaymentTimeStamp("pay1", 20, {from: by}), 'UpdatedPaymentTimeStamp', {
						_paymentId: "0x4914ccf08b940ca80fee9ec44c7dae6f383cc7f7b26780b49dd533e374712ed6",
						_oldTimeStamp: BN(10),
						_newTimeStamp: BN(20)
					});
					payment = await pdn.payments("pay1");
					expect(payment.timeStamp).to.be.bignumber.equals(BN(20));				
				});
				it("Fails to delete pool records if payment attributes are non-zero", async function() {
					await expectRevert.unspecified(pdn.deletePoolRecord("pool", {from: by}));				
				});
				it("Fails to delete lender records if payment attributes are non-zero", async function() {
					await expectRevert.unspecified(pdn.deleteLenderRecord("lender", {from: by}));				
				});
				it("Success deleting pool records if payment attributes are zero", async function() {
					// delete newest-first: the PAYMENT (pay2) before the INVESTMENT (pay1), so the
					// NFT reversal in deletePaymentRecord does not underflow outstandingPrincipal
					await pdn.deletePaymentRecord("pay2", {from:by});
					await pdn.deletePaymentRecord("pay1", {from:by});
					expectEvent(await pdn.deletePoolRecord("pool", {from: by}), 'PoolDeleted', {
						_poolId: "0xe35b2940ca10a9581573918a0d9ed2422f97cc9196f63510c77f5a0ed5393cfd"
					});
				});
				it("Success deleting lender records if payment attributes are zero", async function() {
					// delete newest-first: the PAYMENT (pay2) before the INVESTMENT (pay1)
					await pdn.deletePaymentRecord("pay2", {from:by});
					await pdn.deletePaymentRecord("pay1", {from:by});
					expectEvent(await pdn.deleteLenderRecord("lender", {from: by}), 'LenderDeleted', {
						_lenderId: "0x57c66d3d85e0eb55b3720781fbd6803baef59f40ea1e66c38dd54ae65a51202e"
					});
				});
				it("Success deleting payment records", async function() {
					// beforeEach state: NFT token 1 = TI:100, OP:0, OC:0, TR:110
					//   lender: totalInvested 100, totalReceived 110
					//   pool:   investmentReceived 100, totalPayment 110

					// delete the FEE (pay3) - does not touch lender/pool totals or the NFT
					await pdn.deletePaymentRecord("pay3", {from:by});
					let lender = await pdn.lenders("lender");
					let pool = await pdn.pools("pool");
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(100));
					expect(lender.totalInvested).to.be.bignumber.equals(BN(100));
					expect(pool.totalPayment).to.be.bignumber.equals(BN(110));
					expect(lender.totalReceived).to.be.bignumber.equals(BN(110));

					// delete newest-first: the PAYMENT (pay2) before the INVESTMENT (pay1)
					await pdn.deletePaymentRecord("pay2", {from:by});
					lender = await pdn.lenders("lender");
					pool = await pdn.pools("pool");
					expect(pool.totalPayment).to.be.bignumber.equals(BN(0));
					expect(lender.totalReceived).to.be.bignumber.equals(BN(0));
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(100));
					expect(lender.totalInvested).to.be.bignumber.equals(BN(100));
					// payment reversal restores outstanding principal/coupon and reduces repaid
					let nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(100);
					expect(nft.outstandingPrincipal).to.equal(100);
					expect(nft.outstandingCoupon).to.equal(10);
					expect(nft.totalRepaid).to.equal(0);

					// delete the INVESTMENT (pay1)
					await pdn.deletePaymentRecord("pay1", {from:by});
					lender = await pdn.lenders("lender");
					pool = await pdn.pools("pool");
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(0));
					expect(lender.totalInvested).to.be.bignumber.equals(BN(0));
					// investment reversal zeroes totalInvestment and outstandingPrincipal; the coupon
					// set directly via updateCouponInMetadata is not tied to a payment and remains
					nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(0);
					expect(nft.outstandingPrincipal).to.equal(0);
					expect(nft.outstandingCoupon).to.equal(10);
					expect(nft.totalRepaid).to.equal(0);
				});
			});
			describe("deletePaymentRecord NFT metadata reversal", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 1000, {from: a0});
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
				});

				it("deleting a first investment zeroes the NFT metadata", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					let nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(100);
					expect(nft.outstandingPrincipal).to.equal(100);

					await pdn.deletePaymentRecord("inv1", {from: by});

					nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(0);
					expect(nft.outstandingPrincipal).to.equal(0);
					expect(nft.outstandingCoupon).to.equal(0);
					expect(nft.totalRepaid).to.equal(0);

					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalInvested).to.be.bignumber.equals(BN(0));
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(0));
				});

				it("deleting a subsequent investment reduces the NFT by that principal only", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.addPayment("inv2", "lender", "pool", 50, 0, 0, 10, {from: a0});
					let nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(150);
					expect(nft.outstandingPrincipal).to.equal(150);

					// deleting the newest investment (inv2) is a clean reversal
					await pdn.deletePaymentRecord("inv2", {from: by});

					nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(100);
					expect(nft.outstandingPrincipal).to.equal(100);

					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalInvested).to.be.bignumber.equals(BN(100));
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(100));
				});

				it("deleting a payment restores outstanding amounts and reduces repaid", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.updateCouponInMetadata(1, 20, {from: a0});
					// partial repayment: principal 40, coupon 15
					await pdn.addPayment("pay1", "lender", "pool", 40, 15, 1, 10, {from: a0});
					let nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingPrincipal).to.equal(60);
					expect(nft.outstandingCoupon).to.equal(5);
					expect(nft.totalRepaid).to.equal(55);

					await pdn.deletePaymentRecord("pay1", {from: by});

					nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(100);
					expect(nft.outstandingPrincipal).to.equal(100);
					expect(nft.outstandingCoupon).to.equal(20);
					expect(nft.totalRepaid).to.equal(0);

					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalReceived).to.be.bignumber.equals(BN(0));
					expect(pool.totalPayment).to.be.bignumber.equals(BN(0));
				});

				it("newest-first unwind of payment then investment returns the NFT to zero", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 1, 10, {from: a0});
					let nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingPrincipal).to.equal(0);
					expect(nft.totalRepaid).to.equal(100);

					// delete newest-first: payment, then investment
					await pdn.deletePaymentRecord("pay1", {from: by});
					nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingPrincipal).to.equal(100);
					expect(nft.totalRepaid).to.equal(0);

					await pdn.deletePaymentRecord("inv1", {from: by});
					nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(0);
					expect(nft.outstandingPrincipal).to.equal(0);
					expect(nft.outstandingCoupon).to.equal(0);
					expect(nft.totalRepaid).to.equal(0);
				});

				it("deleting an investment before its later payment goes negative rather than reverting", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 1, 10, {from: a0});

					// outstandingPrincipal is already 0. While it was uint256 this underflowed and
					// reverted, which incidentally forced newest-first deletion. It is int256 now,
					// so the reversal is allowed to go negative and the ordering rule is gone.
					await pdn.deletePaymentRecord("inv1", {from: by});

					let nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(0);
					expect(nft.outstandingPrincipal).to.equal(-100);
					expect(nft.totalRepaid).to.equal(100);

					// removing the remaining record still lands on a clean position, so deletion
					// order changes the intermediate state but not the end state
					await pdn.deletePaymentRecord("pay1", {from: by});

					nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(0);
					expect(nft.outstandingPrincipal).to.equal(0);
					expect(nft.outstandingCoupon).to.equal(0);
					expect(nft.totalRepaid).to.equal(0);

					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalInvested).to.be.bignumber.equals(BN(0));
					expect(lender.totalReceived).to.be.bignumber.equals(BN(0));
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(0));
					expect(pool.totalPayment).to.be.bignumber.equals(BN(0));
				});

				it("deleting a FEE leaves the NFT metadata untouched", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.addFee("fee1", "lender", "pool", 5, 10, {from: a0});

					await pdn.deletePaymentRecord("fee1", {from: by});

					const nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(100);
					expect(nft.outstandingPrincipal).to.equal(100);
					expect(nft.outstandingCoupon).to.equal(0);
					expect(nft.totalRepaid).to.equal(0);
				});
			});

			// A position lives on three surfaces at once: the lender aggregate, the pool aggregate,
			// and the investment NFT. Both reported findings were "one surface moved, another did
			// not", which per-function tests cannot see. These tests assert the surfaces agree and
			// exercise the sequences that cross function boundaries.
			describe("lenderPoolToTokenId indexing invariants", function() {
				const legacy = (lenderId, poolId, totalInvestment, outstandingPrincipal, outstandingCoupon, totalRepaid) => ({
					lenderId, poolId, totalInvestment, outstandingPrincipal, outstandingCoupon, totalRepaid
				});

				// asserts the NFT the pair points at, plus both aggregates
				async function expectPosition(lenderId, poolId, expected) {
					const tokenId = await pdn.getlenderPoolToTokenId(lenderId, poolId);
					expect(tokenId).to.be.bignumber.equals(BN(expected.tokenId));
					const nft = await pdnNFT.investmentData(tokenId.toNumber());
					expect(nft.totalInvestment).to.equal(expected.totalInvestment);
					expect(nft.outstandingPrincipal).to.equal(expected.outstandingPrincipal);
					expect(nft.outstandingCoupon).to.equal(expected.outstandingCoupon);
					expect(nft.totalRepaid).to.equal(expected.totalRepaid);
					const lender = await pdn.lenders(lenderId);
					const pool = await pdn.pools(poolId);
					expect(lender.totalInvested).to.be.bignumber.equals(BN(expected.totalInvested));
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(expected.investmentReceived));
				}

				beforeEach(async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 1000, {from: a0});
					await pdn.createPool("pool2", "pm", "hash", 0, 10, 20, 1000, {from: a0});
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
					await pdn.createLender("lender2", "user2", "hash2", lenderAcc2, {from: a0});
				});

				// --- Finding 1: the legacy mint must record the token it just created ---

				it("legacy mint indexes every token it creates", async function() {
					await pdn.mintLegacyInvestmentNFTBatch([
						legacy("lender", "pool", 500, 500, 0, 0),
						legacy("lender2", "pool2", 800, 800, 0, 0)
					], {from: a0});

					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(1));
					expect(await pdn.getlenderPoolToTokenId("lender2", "pool2")).to.be.bignumber.equals(BN(2));
				});

				it("legacy mint emits LenderPoolTokenIdSet for each token", async function() {
					const receipt = await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					expectEvent(receipt, 'LenderPoolTokenIdSet', {
						_poolId: "pool",
						_oldTokenId: BN(0),
						_newTokenId: BN(1)
					});
				});

				it("an investment after a legacy mint updates that NFT and mints no second one", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					const nextBefore = await pdnNFT.nextTokenId();

					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});

					// the whole point: no duplicate NFT, and the legacy token carries the position
					expect(await pdnNFT.nextTokenId()).to.equal(nextBefore);
					await expectPosition("lender", "pool", {
						tokenId: 1, totalInvestment: 600, outstandingPrincipal: 600,
						outstandingCoupon: 0, totalRepaid: 0,
						totalInvested: 100, investmentReceived: 100
					});
				});

				it("a repayment after a legacy mint succeeds instead of reverting on token zero", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 50, 0)], {from: a0}
					);

					await pdn.addPayment("pay1", "lender", "pool", 100, 20, 1, 10, {from: a0});

					const nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingPrincipal).to.equal(400);
					expect(nft.outstandingCoupon).to.equal(30);
					expect(nft.totalRepaid).to.equal(120);
				});

				it("re-running the legacy mint reverts instead of minting an orphan", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					const nextBefore = Number(await pdnNFT.nextTokenId());

					await expectRevert.unspecified(
						pdn.mintLegacyInvestmentNFTBatch(
							[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
						)
					);

					expect(Number(await pdnNFT.nextTokenId())).to.equal(nextBefore);
					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(1));
				});

				it("legacy mint reverts when addPayment already indexed the pair", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					const nextBefore = Number(await pdnNFT.nextTokenId());

					await expectRevert.unspecified(
						pdn.mintLegacyInvestmentNFTBatch(
							[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
						)
					);

					expect(Number(await pdnNFT.nextTokenId())).to.equal(nextBefore); // no orphan
					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(1));
					const nft = await pdnNFT.investmentData(1);
					expect(nft.totalInvestment).to.equal(100); // untouched
				});

				it("reverts on a duplicate pair within a single batch", async function() {
					const nextBefore = Number(await pdnNFT.nextTokenId());
					await expectRevert.unspecified(
						pdn.mintLegacyInvestmentNFTBatch(
							[legacy("lender", "pool", 500, 500, 0, 0), legacy("lender", "pool", 300, 300, 0, 0)],
							{from: a0}
						)
					);

					expect(Number(await pdnNFT.nextTokenId())).to.equal(nextBefore); // neither was minted
					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(0));
				});

				it("allows a deliberate re-mint once the pair has been unindexed", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					// the documented escape hatch: clear the index first, then minting is allowed again
					await pdn.setLenderPoolTokenId("lender", "pool", 0, {from: a0});

					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);

					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(2));
				});

				// --- setLenderPoolTokenId: the backfill path ---

				it("clears the index when passed token id zero", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);

					await pdn.setLenderPoolTokenId("lender", "pool", 0, {from: a0});

					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(0));
				});

				it("backfills a cleared pair back to its token", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					await pdn.setLenderPoolTokenId("lender", "pool", 0, {from: a0});

					await pdn.setLenderPoolTokenId("lender", "pool", 1, {from: a0});

					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(1));
				});

				it("emits LenderPoolTokenIdSet with the old and new token id", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);

					expectEvent(await pdn.setLenderPoolTokenId("lender", "pool", 0, {from: a0}),
						'LenderPoolTokenIdSet', {
							_poolId: "pool",
							_oldTokenId: BN(1),
							_newTokenId: BN(0)
						});
				});

				it("reverts when the token belongs to a different lender", async function() {
					await pdn.mintLegacyInvestmentNFTBatch([
						legacy("lender", "pool", 500, 500, 0, 0),
						legacy("lender2", "pool", 800, 800, 0, 0)
					], {from: a0});
					await pdn.setLenderPoolTokenId("lender", "pool", 0, {from: a0});

					// token 2 is lender2's position in the same pool
					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("lender", "pool", 2, {from: a0})
					);
				});

				it("reverts when the token belongs to a different pool", async function() {
					await pdn.mintLegacyInvestmentNFTBatch([
						legacy("lender", "pool", 500, 500, 0, 0),
						legacy("lender", "pool2", 800, 800, 0, 0)
					], {from: a0});
					await pdn.setLenderPoolTokenId("lender", "pool", 0, {from: a0});

					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("lender", "pool", 2, {from: a0})
					);
				});

				it("reverts for a token that was never minted", async function() {
					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("lender", "pool", 99, {from: a0})
					);
				});

				it("reverts for an unknown lender", async function() {
					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("nope", "pool", 1, {from: a0})
					);
				});

				it("reverts for an unknown pool", async function() {
					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("lender", "nope", 1, {from: a0})
					);
				});

				it("reverts when caller does not have ROLE_CREATE_MANAGER", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("lender", "pool", 1, {from: a2})
					);
				});

				it("reverts when the contract is paused", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					await pdn.pause({from: a0});

					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("lender", "pool", 1, {from: a0})
					);
				});

				// --- the state actually found on Arbitrum (tokens 6 and 10): a legacy NFT minted
				// before the index fix, an investment posted in between that minted a second NFT
				// for the same pair, and the repair that repoints the pair at the surviving token.
				// Setting the index to zero is how these tests recreate the pre-fix condition. ---

				async function buildSplitPosition() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 650, 650, 0, 0)], {from: a0}
					);
					// the pre-fix legacy mint did not record the token it created
					await pdn.setLenderPoolTokenId("lender", "pool", 0, {from: a0});
					// an investment posted in between finds an empty lookup and mints a second NFT
					await pdn.addPayment("inv1", "lender", "pool", 75, 0, 0, 10, {from: a0});
				}

				it("an unindexed legacy NFT plus a later investment splits the position across two NFTs", async function() {
					await buildSplitPosition();

					// two tokens exist for one pair, and the pair points at the newer one
					expect(await pdnNFT.nextTokenId()).to.equal(3);
					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(2));

					const orphan = await pdnNFT.investmentData(1);
					const live = await pdnNFT.investmentData(2);
					expect(orphan.totalInvestment).to.equal(650);
					expect(live.totalInvestment).to.equal(75);

					// the pool aggregate covers the whole position while neither NFT does
					const pool = await pdn.pools("pool");
					expect(pool.investmentReceived).to.be.bignumber.equals(BN(75));
				});

				it("a repayment on a split pair lands only on the indexed token", async function() {
					await buildSplitPosition();

					await pdn.addPayment("pay1", "lender", "pool", 25, 0, 1, 10, {from: a0});

					const orphan = await pdnNFT.investmentData(1);
					const live = await pdnNFT.investmentData(2);
					expect(orphan.outstandingPrincipal).to.equal(650);   // untouched
					expect(live.outstandingPrincipal).to.equal(50);
					expect(live.totalRepaid).to.equal(25);
				});

				it("repoints a split pair onto the legacy token in one call", async function() {
					await buildSplitPosition();

					await pdn.setLenderPoolTokenId("lender", "pool", 1, {from: a0});

					expect(await pdn.getlenderPoolToTokenId("lender", "pool")).to.be.bignumber.equals(BN(1));

					// later activity now lands on the legacy token instead of the duplicate
					await pdn.addPayment("pay1", "lender", "pool", 50, 0, 1, 10, {from: a0});
					const nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingPrincipal).to.equal(600);
					expect(nft.totalRepaid).to.equal(50);

					const superseded = await pdnNFT.investmentData(2);
					expect(superseded.totalInvestment).to.equal(75);
				});

				it("completes the merge by folding the duplicate in and zeroing it", async function() {
					await buildSplitPosition();

					// repoint, fold both balances onto the survivor, retire the duplicate
					await pdn.setLenderPoolTokenId("lender", "pool", 1, {from: a0});
					const admin = await ethers.getSigner(a0);
					await pdnNFT.connect(admin).emergencyUpdateMetadata(1, 725, 725, 0, 0);
					await pdnNFT.connect(admin).emergencyUpdateMetadata(2, 0, 0, 0, 0);

					const survivor = await pdnNFT.investmentData(1);
					expect(survivor.totalInvestment).to.equal(725);
					expect(survivor.outstandingPrincipal).to.equal(725);

					const retired = await pdnNFT.investmentData(2);
					expect(retired.totalInvestment).to.equal(0);
					expect(retired.outstandingPrincipal).to.equal(0);

					// the retired token still exists and cannot be burned
					expect(await pdnNFT.ownerOf(2)).to.equal(lenderAcc1);
				});

				it("rejects repointing a split pair at a token belonging to another pair", async function() {
					await buildSplitPosition();
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender2", "pool2", 100, 100, 0, 0)], {from: a0}
					);

					await expectRevert.unspecified(
						pdn.setLenderPoolTokenId("lender", "pool", 3, {from: a0})
					);
				});

				// --- Finding 2: delete then re-add must be a no-op on every surface ---

				it("deleting and re-adding an investment restores all three surfaces", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					const nextBefore = await pdnNFT.nextTokenId();

					await pdn.deletePaymentRecord("inv1", {from: by});
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});

					// no duplicate NFT, and nothing double counted
					expect(await pdnNFT.nextTokenId()).to.equal(nextBefore);
					await expectPosition("lender", "pool", {
						tokenId: 1, totalInvestment: 100, outstandingPrincipal: 100,
						outstandingCoupon: 0, totalRepaid: 0,
						totalInvested: 100, investmentReceived: 100
					});
				});

				it("deleting and re-adding a payment restores all three surfaces", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 500, 0, 0, 10, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 1, 10, {from: a0});
					const before = await pdnNFT.investmentData(1);

					await pdn.deletePaymentRecord("pay1", {from: by});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 1, 10, {from: a0});

					const after = await pdnNFT.investmentData(1);
					expect(after.totalInvestment).to.equal(before.totalInvestment);
					expect(after.outstandingPrincipal).to.equal(before.outstandingPrincipal);
					expect(after.outstandingCoupon).to.equal(before.outstandingCoupon);
					expect(after.totalRepaid).to.equal(before.totalRepaid);

					const lender = await pdn.lenders("lender");
					const pool = await pdn.pools("pool");
					expect(lender.totalReceived).to.be.bignumber.equals(BN(100));
					expect(pool.totalPayment).to.be.bignumber.equals(BN(100));
				});

				it("deleting and re-adding an investment on a legacy NFT does not double count", async function() {
					await pdn.mintLegacyInvestmentNFTBatch(
						[legacy("lender", "pool", 500, 500, 0, 0)], {from: a0}
					);
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});

					await pdn.deletePaymentRecord("inv1", {from: by});
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});

					await expectPosition("lender", "pool", {
						tokenId: 1, totalInvestment: 600, outstandingPrincipal: 600,
						outstandingCoupon: 0, totalRepaid: 0,
						totalInvested: 100, investmentReceived: 100
					});
				});
			});

			// outstandingPrincipal and outstandingCoupon are int256, so reversals and overpayments
			// are allowed to go negative instead of reverting. totalInvestment and totalRepaid are
			// still uint256 and still revert on underflow, so the two halves of the metadata do not
			// behave the same way. These tests pin that asymmetry down.
			describe("signed outstanding balances", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, by, {from: a0});
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: by});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 1000, {from: a0});
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
				});

				it("a coupon repayment with no accrued coupon goes negative", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 0, 30, 1, 10, {from: a0});

					const nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingCoupon).to.equal(-30);
					expect(nft.totalRepaid).to.equal(30);
				});

				it("a principal overpayment goes negative", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 150, 0, 1, 10, {from: a0});

					const nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingPrincipal).to.equal(-50);
					expect(nft.totalInvestment).to.equal(100);
				});

				it("a negative balance is restored when the record is deleted", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 150, 0, 1, 10, {from: a0});

					await pdn.deletePaymentRecord("pay1", {from: by});

					const nft = await pdnNFT.investmentData(1);
					expect(nft.outstandingPrincipal).to.equal(100);
					expect(nft.totalRepaid).to.equal(0);
				});

				it("totalRepaid still reverts on underflow", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 500, 0, 0, 10, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 1, 10, {from: a0});

					// drop totalRepaid below the record being reversed, the way a metadata rewrite
					// during the split-position merge would leave it
					await pdnNFT.connect(await ethers.getSigner(a0)).emergencyUpdateMetadata(1, 500, 400, 0, 50);

					await expectRevert.unspecified(pdn.deletePaymentRecord("pay1", {from: by}));
				});

				it("totalInvestment still reverts on underflow", async function() {
					await pdn.addPayment("inv1", "lender", "pool", 100, 0, 0, 10, {from: a0});

					await pdnNFT.connect(await ethers.getSigner(a0)).emergencyUpdateMetadata(1, 50, 100, 0, 0);

					await expectRevert.unspecified(pdn.deletePaymentRecord("inv1", {from: by}));
				});
			});

			describe("When operator does not have ROLE_EDIT_MANAGER", function() {
				beforeEach(async function() {
					await pdn.grantRole(ROLE_EDIT_MANAGER, a2, {from: a0});
					await pdn.updateInvestmentNFT(await pdnNFT.getAddress(), { from: a2});
					await pdn.createPool("pool", "pm", "hash", 0, 10, 20, 30, {from: a0});
					await pdn.createLender("lender", "user", "hash", lenderAcc1, {from: a0});
					await pdn.addPayment("pay1", "lender", "pool", 100, 0, 0, 10, {from: a0});
				});
				it("Fails to update lender data", async function () {
					await expectRevert.unspecified(pdn.updateLenderUserId("lender", "user1", {
						from: by
					}));
					await expectRevert.unspecified(pdn.updateLenderMetaHash("lender", "hash1", {
						from: by
					}));
				})
				it("Fails to update pool data", async function () {
					await expectRevert.unspecified(pdn.updatePoolManagerId("pool", "pm1", {
						from: by
					}));
					await expectRevert.unspecified(pdn.updatePoolMetaHash("pool", "hash1", {
						from: by
					}));
					await expectRevert.unspecified(pdn.updatePoolRatings("pool", 1, {
						from: by
					}));
					await expectRevert.unspecified(pdn.updatePoolInceptionTime("pool", 20, {
						from: by
					}));
					await expectRevert.unspecified(pdn.updatePoolExpiryTime("pool", 30, {
						from: by
					}));
					await expectRevert.unspecified(pdn.updatePoolSize("pool", 40, {
						from: by
					}));
				});
				it("Fails to update payment data", async function () {
					await expectRevert.unspecified(pdn.updatePaymentTimeStamp("pay1", 20, {
						from: by
					}));
				});
			});				
		});
	}

	// run the suite
	test_suite("SIGMA_PDN_v1_1", get_sigmaPDNv1_1_upgradeable_deployment);
});
