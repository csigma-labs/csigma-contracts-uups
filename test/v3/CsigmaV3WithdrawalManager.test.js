const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    time: {
        latest,
        increase,
        duration: { days },
    },
} = require("@nomicfoundation/hardhat-network-helpers");
const { ZeroAddress } = require("ethers");

describe("V3 Withdrawal Manager ", function () {
    let oracle, proxy, proxyFactory, dummy, dummyFactory, csUSD, mockFeed, pool, admin, roleManager, oracleManager, controller, poolManager, user;
    let MockFeed, MockPool, Oracle, accounts, v3Pool, v3FundManager, paymentInfo, request, claimRequest;

    before(async function () {
        accounts = await ethers.getSigners();
        [admin, roleManager, oracleManager, controller, poolManager, blacklistManager, user] = accounts;

        const CsigmaUSD = await ethers.getContractFactory("CsigmaUSD");
        csUSD = await CsigmaUSD.deploy();
        proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
        proxy = await proxyFactory.deploy(await csUSD.getAddress(), "0x");
        csUSD = await ethers.getContractAt("CsigmaUSD", await proxy.getAddress());

        let chainAnalysisFactory = await ethers.getContractFactory("MockChainAnalysis");
        chainAnalysis = await chainAnalysisFactory.deploy();
        // await chainAnalysis.sanction(controller.address, true);
        // v3FundManager.setChainAnalysis(await chainAnalysis.getAddress());

        await csUSD.initialize("cSigma USD", "csUSD", controller.address, roleManager.address, await chainAnalysis.getAddress());

        dummyFactory = await ethers.getContractFactory("MockERC20");
        dummy = await dummyFactory.deploy();

        MockFeed = await ethers.getContractFactory("MockAggregatorV3");
        MockPool = await ethers.getContractFactory("MockPoolV3");
        Oracle = await ethers.getContractFactory("CsigmaAssetOracle");

        mockFeed = await MockFeed.deploy(8, "100000000"); // 1 USD, 8 decimals
        pool = await MockPool.deploy();

        const oracleLogic = await Oracle.deploy();
        proxy = await proxyFactory.deploy(
            await oracleLogic.getAddress(),
            oracleLogic.interface.encodeFunctionData("initialize", [
                admin.address,
                roleManager.address,
                await csUSD.getAddress()
            ])
        );
        oracle = await ethers.getContractAt("CsigmaAssetOracle", await proxy.getAddress());

        // fundManager V3 deploy
        let v1DiamondFactory = await ethers.getContractFactory("MockV1");
        diamondV1 = await v1DiamondFactory.deploy();

        let v3FundManagerFactory = await ethers.getContractFactory("CSUSDFundManager");
        const fundManagerLogic = await v3FundManagerFactory.deploy();
        proxy = await proxyFactory.deploy(
            await fundManagerLogic.getAddress(),
            fundManagerLogic.interface.encodeFunctionData("initialize", [
                await diamondV1.getAddress(),
                "LENDER1",
                roleManager.address,
                accounts[20].address,
                poolManager.address,
                accounts[20].address
            ])
        );
        v3FundManager = await ethers.getContractAt("CSUSDFundManager", await proxy.getAddress());


        // Deploy vault logic and proxy
        const poolFactory = await ethers.getContractFactory("CsigmaV3Pool");
        const poolLogic = await poolFactory.deploy();

        withdrawalManagerFactory = await ethers.getContractFactory("CsigmaV3WithdrawalManager");
        v3Withdraw = await withdrawalManagerFactory.deploy();

        proxy = await proxyFactory.deploy(
            await poolLogic.getAddress(),
            poolLogic.interface.encodeFunctionData("initialize", [
                await csUSD.getAddress(),
                poolManager.address,
                await v3FundManager.getAddress(),
                roleManager.address,
                dummy.target,
                await oracle.getAddress(),
                oracleManager.address,
                await v3Withdraw.getAddress()
            ])
        );

        v3Pool = await ethers.getContractAt("CsigmaV3Pool", await proxy.getAddress());
        await oracle.connect(roleManager).addSupportedAsset(
            await v3Pool.getAddress(),
            await dummy.getAddress(),
            await mockFeed.getAddress(),
            0,
            ethers.parseUnits("0.85", 18),
            ethers.parseUnits("1.10", 18)
        );
        await csUSD.addController(await v3Pool.getAddress());
        await v3Pool.connect(roleManager).activatePool();
        await v3Pool.connect(roleManager).updateNonReservePercentage("9000");

        await v3FundManager.connect(roleManager).addTokenToWhitelist(await v3Pool.getAddress());
        for (let i = 0; i < 8; i++) {
            await dummy.mint(accounts[i].address, ethers.parseEther("5000"));
            await dummy.connect(accounts[i]).approve(await v3Pool.getAddress(), ethers.parseEther("5000"));
            await v3Pool.connect(accounts[i]).deposit(ethers.parseEther("5000"), accounts[i].address);
        }
        await v3Pool.connect(roleManager).createWithdrawalManager(accounts[0].address);

        const withdrawManagerAddress = await v3Pool.withdrawalManager();
        v3Withdraw = await ethers.getContractAt("CsigmaV3WithdrawalManager", withdrawManagerAddress);
        const BLACKLIST_ROLE = await csUSD.BLACKLIST_MANAGER_ROLE();
        await csUSD.connect(admin).grantRole(BLACKLIST_ROLE, blacklistManager.address);

    });

    it("Should have initialized correctly", async function () {
        expect(await v3Withdraw.hasRole(await v3Withdraw.DEFAULT_ADMIN_ROLE(), await v3Pool.getAddress())).to.be.true;
        expect(await v3Withdraw.hasRole(await v3Withdraw.MANAGER_ROLE(), await v3FundManager.getAddress())).to.be.true;
        expect(await v3Withdraw.hasRole(await v3Withdraw.MANAGER_ROLE(), poolManager.address)).to.be.true;
        expect(await v3Withdraw.shareToken()).to.be.equal(await csUSD.getAddress());
        expect(await v3Withdraw.underlyingToken()).to.be.equal(await dummy.getAddress());
        expect(await v3Withdraw.csigmaRouter()).to.be.equal(accounts[0].address);
        expect(await v3Withdraw.csigmaV3Pool()).to.be.equal(await v3Pool.getAddress());
        await expect(v3Withdraw.initialize(await dummy.getAddress(), await v3Pool.getAddress(), accounts[12].address)).to.be.reverted;
    });

    describe("Withdrawal Request", async function () {

        beforeEach(async function () {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function () {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should be able to directly withdraw when pool has enough reserve", async function () {
            await v3Pool.connect(accounts[0]).approve(await v3Withdraw.getAddress(), ethers.parseEther("1000"));
            totalSupplyBefore = await v3Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v3Withdraw.connect(accounts[0]).requestWithdrawal(ethers.parseUnits("1000",6), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v3Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(ethers.parseUnits("1000",6));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("1000"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseEther("0"));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(0);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(0);
        });

        it("Should be able to place a withdraw request when pool doesn't have enough reserve", async function () {
            await v3Pool.connect(accounts[0]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            totalSupplyBefore = await v3Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v3Withdraw.connect(accounts[0]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v3Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(ethers.parseUnits("4000",6));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("4000"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("1000", 6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",6),
                0,
                accounts[0].address,
                false
            ]);

            await v3Pool.connect(accounts[1]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            totalSupplyBefore = await v3Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v3Withdraw.connect(accounts[1]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await v3Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(ethers.parseUnits("0",6));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("0"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("6000",6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("5000",6),
                ethers.parseUnits("6000",6),
                0,
                accounts[1].address,
                false
            ]);
        });

        it("Should not allow to jump queue if new deposits replenishes the reserve", async function () {
            await v3Pool.connect(accounts[0]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            totalSupplyBefore = await v3Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v3Withdraw.connect(accounts[0]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v3Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(ethers.parseUnits("4000",6));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("4000"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("1000",6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",6),
                0,
                accounts[0].address,
                false
            ]);


            for (let i = 8; i < 10; i++) {
                await dummy.mint(accounts[i].address, ethers.parseEther("5000"));
                await dummy.connect(accounts[i]).approve(await v3Pool.getAddress(), ethers.parseEther("5000"));
                await v3Pool.connect(accounts[i]).deposit(ethers.parseEther("5000"), accounts[i].address);
            }

            await v3Pool.connect(accounts[1]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            totalSupplyBefore = await v3Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v3Withdraw.connect(accounts[1]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await v3Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(ethers.parseUnits("0",6));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("0"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("6000", 6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("5000",6),
                ethers.parseUnits("6000",6),
                0,
                accounts[1].address,
                false
            ]);
        });

        it("Should allow to partially withdraw if new deposits replenishes the reserve", async function () {
            await v3Pool.connect(accounts[0]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            totalSupplyBefore = await v3Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v3Withdraw.connect(accounts[0]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v3Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(ethers.parseUnits("4000",6));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("4000"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("1000",6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",6),
                0,
                accounts[0].address,
                false
            ]);


            for (let i = 8; i < 12; i++) {
                await dummy.mint(accounts[i].address, ethers.parseEther("5000"));
                await dummy.connect(accounts[i]).approve(await v3Pool.getAddress(), ethers.parseEther("5000"));
                await v3Pool.connect(accounts[i]).deposit(ethers.parseEther("5000"), accounts[i].address);
            }

            await v3Pool.connect(accounts[1]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            totalSupplyBefore = await v3Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v3Withdraw.connect(accounts[1]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[1].address, accounts[1].address);
            
            const count = await v3Withdraw.getUserRequestsCount(accounts[1].address);
            expect(count).to.equal(1);

            const userRequests = await v3Withdraw.getUserRequests(accounts[1].address);
            expect(userRequests.length).to.equal(1);

            for (let i = 0; i < userRequests.length; i++) {
                expect(userRequests[i].owner).to.equal(accounts[1].address);
            }

            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await v3Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(ethers.parseUnits("1000",6));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("1000"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("5000",6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("4000",6),
                ethers.parseUnits("5000",6),
                0,
                accounts[1].address,
                false
            ]);
        });

        it("Should return 0 if user has no requests", async function () {
            const count = await v3Withdraw.getUserRequestsCount(accounts[8].address);
            expect(count).to.equal(0);
        });
    });

    describe("Withdrawal Fulfillment", async function () {
        before(async function () {
            snapshot = await network.provider.send("evm_snapshot", []);
            await v3Pool.connect(accounts[0]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            await v3Withdraw.connect(accounts[0]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[0].address, accounts[0].address);
        });

        after(async function () {
            await network.provider.send("evm_revert", [snapshot]);
        });

        beforeEach(async function () {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function () {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should fulfill the request", async function () {
            balanceBefore = await dummy.balanceOf(await v3Withdraw.getAddress());
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("1000"), 1);
            // await v3Withdraw.repay(1, ethers.parseEther("1000"));
            balanceAfter = await dummy.balanceOf(await v3Withdraw.getAddress());
            expect(balanceAfter - balanceBefore).to.be.equal(ethers.parseEther("1000"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("0",6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(1);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(1);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",18),
                accounts[0].address,
                true
            ]);
        });

        it("Should revert if payment amount is 0", async function () {
            await expect(v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("0"), 0)).to.be.reverted;
        });

        it("Should succeed if paying in excess", async function () {
            await expect(v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("1000"), 1)).not.to.be.reverted;
        });

        it("Should fail if paying for 0th queue position", async function () {
            await expect(v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("1000"), 0)).to.be.reverted;
            // await expect(v3Withdraw.repay(0, ethers.parseEther("10"))).to.be.reverted;
        });

        it("Should fail to fulfill requests if not enough funds", async function () {
            await v3Pool.connect(accounts[2]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            await v3Withdraw.connect(accounts[2]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[2].address, accounts[2].address);
            await expect(v3Withdraw.repay(3, ethers.parseEther("1000"))).to.be.reverted;
        });

        it("Should fail to repay if caller does not have manager role", async function () {
            await v3Pool.connect(accounts[2]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            await v3Withdraw.connect(accounts[2]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[2].address, accounts[2].address);
            await expect(v3Withdraw.connect(accounts[10]).repay(3, ethers.parseEther("1000"))).to.be.reverted;
        });

        it("Should fail if trying to repay an already fulfilled position", async function () {
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("1000"), 1);
            await v3Withdraw.connect(poolManager).repay(1, ethers.parseEther("1000"));
            await expect(v3Withdraw.connect(poolManager).repay(0, ethers.parseEther("1000"))).to.be.revertedWith("Queue position is not valid");
        });

        it("Should be able to fulfill multiple requests", async function () {
            await v3Pool.connect(accounts[2]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            await v3Withdraw.connect(accounts[2]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[2].address, accounts[2].address);
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("5000"), 2);
            // await v3Withdraw.repay(2, ethers.parseEther("5000"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("1000",6));
            expect(await v3Withdraw.currentQueuePosition()).to.be.equal(2);
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(2);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",6),
                ethers.parseUnits("0",18),
                accounts[0].address,
                false
            ]);
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("6000",6),
                ethers.parseUnits("4000",18),
                accounts[2].address,
                true
            ]);
        });
    });

    describe("Claim Request", async function () {

        before(async function () {
            snapshot = await network.provider.send("evm_snapshot", []);
            await v3Pool.connect(accounts[0]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
            await v3Withdraw.connect(accounts[0]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[0].address, accounts[0].address);
        });

        beforeEach(async function () {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function () {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should fail to claim if request is not fulfilled", async function () {
            await expect(v3Withdraw.connect(accounts[0]).claim(1, 1)).to.be.revertedWith("Queue position is not fulfilled yet");
        });

        it("Should fail to claim if caller is blacklisted", async function() {
            // blacklist user
            await csUSD.connect(blacklistManager).addBlackList(accounts[0].address);

            await expect(
                v3Withdraw.connect(accounts[0]).claim(1, 1)
            ).to.be.revertedWith("Assets are frozen");
        });

        it("Should be able to claim if claim is fulfilled", async function () {
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("1000"), 1);
            // await v3Withdraw.repay(1, ethers.parseEther("1000"));
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            withdrawBalanceBefore = await dummy.balanceOf(await v3Withdraw.getAddress());
            await v3Withdraw.connect(accounts[0]).claim(1, 1000);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            withdrawBalanceAfter = await dummy.balanceOf(await v3Withdraw.getAddress());
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("1000"));
            expect(withdrawBalanceBefore - withdrawBalanceAfter).to.be.equal(ethers.parseEther("1000"));
        });

        it("Should be able to repay in excess", async function () {
            for (i = 1; i < 6; i++) {
                await v3Pool.connect(accounts[i]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
                await v3Withdraw.connect(accounts[i]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[i].address, accounts[i].address);
            }
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("26000", 6));

            await dummy.mint(await v3FundManager.getAddress(), ethers.parseEther("60000"));
            await expect(v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("60000"), 100)).not.to.be.reverted;
        });

        it("Should claim different requests", async function () {
            for (i = 1; i < 6; i++) {
                await v3Pool.connect(accounts[i]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
                await v3Withdraw.connect(accounts[i]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[i].address, accounts[i].address);
            }
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("26000",6));

            // repay 1,2
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("6000"), 2);
            // await v3Withdraw.repay(2, ethers.parseEther("6000"));
            expect(await v3Withdraw.getRepaymentData()).to.deep.equal([
                [0, 0],
                [1, ethers.parseEther("1")]
            ]);
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("20000",6));
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(2);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",6),
                0,
                accounts[0].address,
                false
            ]);
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("6000",6),
                ethers.parseUnits("5000",18),
                accounts[1].address,
                true
            ]);

            // repay 3, partial 4
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("8000"), 4);
            // await v3Withdraw.repay(4, ethers.parseEther("8000"));
            expect(await v3Withdraw.getRepaymentData()).to.deep.equal([
                [0, 0],
                [1, ethers.parseEther("1")],
                [3, ethers.parseEther("1")]
            ]);
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("12000", 6));
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(4);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",6),
                0,
                accounts[0].address,
                false
            ]);
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("6000",6),
                ethers.parseUnits("5000",18),
                accounts[1].address,
                true
            ]);
            expect(await v3Withdraw.withdrawalQueue(3)).to.deep.equal([
                ethers.parseUnits("5000",6),
                ethers.parseUnits("11000",6),
                0,
                accounts[2].address,
                false
            ]);
            expect(await v3Withdraw.withdrawalQueue(4)).to.deep.equal([
                ethers.parseUnits("2000",6),
                ethers.parseUnits("16000",6),
                ethers.parseUnits("3000",18),
                accounts[3].address,
                true
            ]);

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            await v3Withdraw.connect(accounts[3]).claim(4, 12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("3000"));
            expect(await v3Withdraw.withdrawalQueue(4)).to.deep.equal([
                ethers.parseUnits("2000",6),
                ethers.parseUnits("16000",6),
                ethers.parseUnits("0",18),
                accounts[3].address,
                true
            ]);

            // repay partial 4,5,6
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("12000"), 6);
            // await v3Withdraw.repay(6, ethers.parseEther("12000"));
            expect(await v3Withdraw.getRepaymentData()).to.deep.equal([
                [0, 0],
                [1, ethers.parseEther("1")],
                [3, ethers.parseEther("1")],
                [5, ethers.parseEther("1")]
            ]);
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(ethers.parseUnits("0",6));
            expect(await v3Withdraw.fulfilledQueuePosition()).to.be.equal(6);
            expect(await v3Withdraw.withdrawalQueue(1)).to.deep.equal([
                ethers.parseUnits("1000",6),
                ethers.parseUnits("1000",6),
                0,
                accounts[0].address,
                false
            ]);
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("6000",6),
                ethers.parseUnits("5000",18),
                accounts[1].address,
                true
            ]);
            expect(await v3Withdraw.withdrawalQueue(3)).to.deep.equal([
                ethers.parseUnits("5000",6),
                ethers.parseUnits("11000",6),
                0,
                accounts[2].address,
                false
            ]);
            expect(await v3Withdraw.withdrawalQueue(4)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("16000",6),
                ethers.parseUnits("2000",18),
                accounts[3].address,
                true
            ]);
            expect(await v3Withdraw.withdrawalQueue(5)).to.deep.equal([
                ethers.parseUnits("5000",6),
                ethers.parseUnits("21000",6),
                0,
                accounts[4].address,
                false
            ]);
            expect(await v3Withdraw.withdrawalQueue(6)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("26000",6),
                ethers.parseUnits("5000",18),
                accounts[5].address,
                true
            ]);

            // claim 6, 5
            userBalanceBefore = await dummy.balanceOf(accounts[5].address);
            await v3Withdraw.connect(accounts[5]).claim(6, 12345);
            userBalanceAfter = await dummy.balanceOf(accounts[5].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("5000"));
            expect(await v3Withdraw.withdrawalQueue(6)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("26000",6),
                ethers.parseUnits("0",18),
                accounts[5].address,
                true
            ]);

            userBalanceBefore = await dummy.balanceOf(accounts[4].address);
            await v3Withdraw.connect(accounts[4]).claim(5, 3);
            userBalanceAfter = await dummy.balanceOf(accounts[4].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("5000"));

            // claim 3
            userBalanceBefore = await dummy.balanceOf(accounts[2].address);
            await v3Withdraw.connect(accounts[2]).claim(3, 2);
            userBalanceAfter = await dummy.balanceOf(accounts[2].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("5000"));

            // claim 2, 1
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v3Withdraw.connect(accounts[1]).claim(2, 12345);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("5000"));
            expect(await v3Withdraw.withdrawalQueue(2)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("6000",6),
                ethers.parseUnits("0",18),
                accounts[1].address,
                true
            ]);

            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v3Withdraw.connect(accounts[0]).claim(1, 1);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("1000"));

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            
            // blacklist user 4
            await csUSD.connect(blacklistManager).addBlackList(accounts[3].address);

            await expect(
                v3Withdraw.connect(accounts[3]).claim(4, 12345)
            ).to.be.revertedWith("Assets are frozen");

            // remove  user 4 from blacklist 
            await csUSD.connect(blacklistManager).removeBlackList(accounts[3].address);
            await v3Withdraw.connect(accounts[3]).claim(4, 12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("2000"));
            expect(await v3Withdraw.withdrawalQueue(4)).to.deep.equal([
                ethers.parseUnits("0",6),
                ethers.parseUnits("16000",6),
                ethers.parseUnits("0",18),
                accounts[3].address,
                true
            ]);
        });

        it("Should fail to claim if repayment index provided is incorrect", async function () {
            for (i = 1; i < 6; i++) {
                await v3Pool.connect(accounts[i]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
                await v3Withdraw.connect(accounts[i]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("6000"), 2);
            // await v3Withdraw.repay(2, ethers.parseEther("6000"));

            // repay 3, partial 4
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("8000"), 4);
            // await v3Withdraw.repay(4, ethers.parseEther("8000"));

            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("12000"), 6);
            // await v3Withdraw.repay(6, ethers.parseEther("12000"));

            await expect(v3Withdraw.connect(accounts[2]).claim(3, 3)).to.be.revertedWith("Repayment data index is not valid");
            await expect(v3Withdraw.connect(accounts[0]).claim(1, 2)).to.be.revertedWith("Repayment data index is not valid");
            await expect(v3Withdraw.connect(accounts[2]).claim(3, 1)).to.be.revertedWith("Repayment data index is not valid");
            await expect(v3Withdraw.connect(accounts[0]).claim(1, 0)).to.be.reverted;
            await expect(v3Withdraw.connect(accounts[2]).claim(3, 4)).to.be.reverted;
        });

        it("Should fail to claim if already claimed", async function () {
            for (i = 1; i < 6; i++) {
                await v3Pool.connect(accounts[i]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
                await v3Withdraw.connect(accounts[i]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("6000"), 2);
            // await v3Withdraw.repay(2, ethers.parseEther("6000"));

            // repay 3, partial 4
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("8000"), 4);
            // await v3Withdraw.repay(4, ethers.parseEther("8000"));

            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("12000"), 6);
            // await v3Withdraw.repay(6, ethers.parseEther("12000"));

            await v3Withdraw.connect(accounts[5]).claim(6, 12345);

            beforeBalance = await dummy.balanceOf(accounts[5].address);
            await expect(v3Withdraw.connect(accounts[5]).claim(6, 12345)).to.be.reverted;
            afterBalance = await dummy.balanceOf(accounts[5].address);
            expect(afterBalance - beforeBalance).to.be.equal(0);

            await v3Withdraw.connect(accounts[4]).claim(5, 3);

            beforeBalance = await dummy.balanceOf(accounts[4].address);
            await expect(v3Withdraw.connect(accounts[4]).claim(5, 3)).to.be.reverted;
            afterBalance = await dummy.balanceOf(accounts[4].address);
            expect(afterBalance - beforeBalance).to.be.equal(0);
        });

        it("Should claim different requests with different exchange ratios", async function () {
            for (i = 1; i < 6; i++) {
                await v3Pool.connect(accounts[i]).approve(await v3Withdraw.getAddress(), ethers.parseEther("5000"));
                await v3Withdraw.connect(accounts[i]).requestWithdrawal(ethers.parseUnits("5000",6), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            // await dummy.mint(await v3FundManager.getAddress(), ethers.parseEther("1000"));
            exchangeRatio1 = await v3Pool.convertToAssets(ethers.parseUnits("1",6));

            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("6000") * exchangeRatio1 / ethers.parseEther("1"), 2);
            withdrawalObject2 = await v3Withdraw.withdrawalQueue(2);

            // await v3Withdraw.repay(2, ethers.parseEther("6000") * exchangeRatio1 / ethers.parseEther("1"));
            expect(await v3Withdraw.getRepaymentData()).to.deep.equal([
                [0, 0],
                [1, exchangeRatio1]
            ]);

            // repay 3, partial 4
            // await dummy.mint(await v3FundManager.getAddress(), ethers.parseEther("1000"));
            exchangeRatio2 = await v3Pool.convertToAssets(ethers.parseUnits("1",6));

            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("8000") * exchangeRatio2 / ethers.parseEther("1"), 4);
            withdrawalObject4 = await v3Withdraw.withdrawalQueue(4);

            // await v3Withdraw.repay(4, ethers.parseEther("8000") * exchangeRatio2 / ethers.parseEther("1"));
            expect(await v3Withdraw.getRepaymentData()).to.deep.equal([
                [0, 0],
                [1, exchangeRatio1],
                [3, exchangeRatio2]
            ]);

            // repay partial 4,5,6
            // await dummy.mint(await v3FundManager.getAddress(), ethers.parseEther("1000"));
            exchangeRatio3 = await v3Pool.convertToAssets(ethers.parseUnits("1",6));

            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("12000") * exchangeRatio3 / ethers.parseEther("1"), 6);

            // await v3Withdraw.repay(6, ethers.parseEther("12000") * exchangeRatio3 / ethers.parseEther("1"));
            expect(await v3Withdraw.getRepaymentData()).to.deep.equal([
                [0, 0],
                [1, exchangeRatio1],
                [3, exchangeRatio2],
                [5, exchangeRatio3]
            ]);

            // claim 6, 5
            userBalanceBefore = await dummy.balanceOf(accounts[5].address);
            await v3Withdraw.connect(accounts[5]).claim(6, 12345);
            userBalanceAfter = await dummy.balanceOf(accounts[5].address);
            withdrawalObject = await v3Withdraw.withdrawalQueue(6);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((ethers.parseEther("5000") - withdrawalObject[0]) * exchangeRatio3 / ethers.parseEther("1"));

            userBalanceBefore = await dummy.balanceOf(accounts[4].address);
            await v3Withdraw.connect(accounts[4]).claim(5, 3);
            userBalanceAfter = await dummy.balanceOf(accounts[4].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("5000") * exchangeRatio3 / ethers.parseEther("1"));

            // claim 1
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v3Withdraw.connect(accounts[0]).claim(1, 1);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("1000") * exchangeRatio1 / ethers.parseEther("1"));

            // claim 2
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v3Withdraw.connect(accounts[1]).claim(2, 12345);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((ethers.parseEther("5000") - withdrawalObject2[0]) * exchangeRatio1 / ethers.parseEther("1") + withdrawalObject2[0] * exchangeRatio2 / ethers.parseEther("1"));

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            await v3Withdraw.connect(accounts[3]).claim(4, 12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((ethers.parseEther("5000") - withdrawalObject4[0]) * exchangeRatio2 / ethers.parseEther("1") + withdrawalObject4[0] * exchangeRatio3 / ethers.parseEther("1"));

            // claim 3
            userBalanceBefore = await dummy.balanceOf(accounts[2].address);
            await v3Withdraw.connect(accounts[2]).claim(3, 2);
            userBalanceAfter = await dummy.balanceOf(accounts[2].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(ethers.parseEther("5000") * exchangeRatio2 / ethers.parseEther("1"));
            expect(await v3Withdraw.totalDueShareToken()).to.be.equal(withdrawalObject[0]);
        });
    });

    describe("Test router updated", async function() {
        it("Should update csigmaRouter address if called by v3Pool (impersonated)", async function () {
            const newRouter = accounts[10].address;
            const poolAddress = await v3Pool.getAddress();

            // Fund the contract with ETH if needed
            await network.provider.send("hardhat_setBalance", [
                poolAddress,
                "0x1000000000000000000", // 1 ETH in hex
            ]);

            // Impersonate the contract
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [poolAddress],
            });


            await v3Pool.connect(roleManager).updateCsigmaRouter(newRouter);
            expect(await v3Withdraw.csigmaRouter()).to.equal(newRouter);

            await network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [poolAddress],
            });
        });
        
        it("Should revert updateCsigmaRouter if called by non-admin", async function () {
            const newRouter = accounts[10].address;
            await expect(v3Withdraw.connect(accounts[1]).updateCsigmaRouter(newRouter)).to.be.revertedWith("AccessControl: account " + accounts[1].address.toLowerCase() + " is missing role " + await v3Withdraw.DEFAULT_ADMIN_ROLE());
        });

    })

     describe("Emergency Withdraw", async function() {
        it("Should emergency withdraw funds", async function() {
            await dummy.mint(await v3Withdraw.getAddress(),ethers.parseEther("5000"));
            WMbalanceBefore = await dummy.balanceOf(await v3Withdraw.getAddress());
            userbalanceBefore = await dummy.balanceOf(accounts[14].address);
            await expect(v3Pool.emergencyWithdrawTarget(await v3Withdraw.getAddress(), await dummy.getAddress(), accounts[14].address,ethers.parseEther("5000"))).to.emit(v3Withdraw, "EmergencyWithdraw").withArgs(await dummy.getAddress(), accounts[14].address,ethers.parseEther("5000"));
            expect(await dummy.balanceOf(await v3Withdraw.getAddress())).to.equal(WMbalanceBefore -ethers.parseEther("5000"));
            expect(await dummy.balanceOf(accounts[14].address)).to.equal(userbalanceBefore +ethers.parseEther("5000"));
        });

        it("Should fail if withdrawing without admin", async function(){
            await expect(v3Withdraw.connect(accounts[14]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address,ethers.parseEther("5"))).to.be.reverted;
        });
    })
});