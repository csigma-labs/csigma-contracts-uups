const {expect} = require("chai");
const {
    ethers: {
        parseEther,
        getContractFactory
    },
    network
} = require("hardhat");
const {
    time: {
        latest,
        increase,
        duration: {days},
    },
} = require("@nomicfoundation/hardhat-network-helpers");
const { parse } = require("dotenv");

describe("V2-Withdrawal Module", async function() {
    let accounts, v2Pool, dummy, v2Factory, chainAnalysis, v2FundManager, snapshot, localSnapshot;
    before(async function() {
        accounts = await ethers.getSigners();
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await dummyFactory.deploy();
        sigma = await dummyFactory.deploy();

        let v2PoolFactory = await getContractFactory("CsigmaV2Pool");
        poolImplementation = await (await v2PoolFactory.deploy()).getAddress();
        
        let v2StakingPoolFactory = await getContractFactory("CsigmaV2StakingPoolExtension");
        stakingPoolImplementation = await (await v2StakingPoolFactory.deploy()).getAddress();
        
        let v2FundManagerFactory = await getContractFactory("CsigmaV2FundManager");
        fundManagerImplementation = await (await v2FundManagerFactory.deploy()).getAddress();

        let v1DiamondFactory = await getContractFactory("MockV1");
        diamondV1 = await (await v1DiamondFactory.deploy()).getAddress();

        let chainAnalysisFactory = await getContractFactory("MockChainAnalysis");
        chainalysis = await chainAnalysisFactory.deploy();
        
        v2FactoryFactory = await getContractFactory("CsigmaV2Factory");
        v2Factory = await v2FactoryFactory.deploy();
        let proxyFactory = await getContractFactory("ERC1967Proxy");
        let proxy = await proxyFactory.deploy(await v2Factory.getAddress(), "0x");
        v2Factory = await ethers.getContractAt("CsigmaV2Factory", await proxy.getAddress());
        
        await v2Factory.initialize(
            accounts[0].address, // default admin
            fundManagerImplementation, // fundManagerImplementation
            stakingPoolImplementation, // stakingPoolImplementation
            poolImplementation, // poolImplementation
            diamondV1, // diamondv1
            await sigma.getAddress(), // sigmaToken
            chainalysis  // chainalysis
        );
        await v2Factory.grantRole(await v2Factory.ROLE_MANAGER(), accounts[0]);
        await v2Factory.addPoolManager(accounts[17].address);
        await v2Factory.addTokenToWhitelist(dummy);

        let poolTx = await v2Factory.createPool(
            "Test Pool",
            "TP",
            "Lender1",
            accounts[17].address,
            dummy,
            accounts[19].address,
            14,
            parseEther("1000000")
        );

        poolTx = await poolTx.wait();
        poolAddress = poolTx.logs[9].args._pool;
        v2Pool = await ethers.getContractAt("CsigmaV2Pool", poolAddress);
        await v2Pool.connect(accounts[17]).activatePool();

        fundManagerAddress = await poolTx.logs[9].args._fundManager;
        v2FundManager = await ethers.getContractAt("CsigmaV2FundManager", fundManagerAddress);

        await v2Pool.connect(accounts[17]).updateNonReservePercentage("9000");
        for(let i = 0; i < 8; i++) {
            await dummy.mint(accounts[i].address, parseEther("5000"));
            await dummy.connect(accounts[i]).approve(await v2Pool.getAddress(), parseEther("5000"));
            await v2Pool.connect(accounts[i]).deposit(parseEther("5000"), accounts[i].address);
        }

        // WM implementation now disables initializers in its constructor — must deploy via proxy
        withdrawalManagerFactory = await getContractFactory("CsigmaV2WithdrawalManager");
        const wmImpl = await withdrawalManagerFactory.deploy();
        const wmProxyFactory = await getContractFactory("ERC1967Proxy");
        const wmProxy = await wmProxyFactory.deploy(
            await wmImpl.getAddress(),
            wmImpl.interface.encodeFunctionData("initialize", [dummy.target, poolAddress, accounts[12].address])
        );
        v2Withdraw = await ethers.getContractAt("CsigmaV2WithdrawalManager", await wmProxy.getAddress());

        await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
        await v2Withdraw.grantRole(await v2Withdraw.MANAGER_ROLE(), accounts[0].address);
        await v2Pool.setWithdrawalManager(await v2Withdraw.getAddress());
    });
    
    it("Should have initialized correctly", async function() {
        expect(await v2Withdraw.LPToken()).to.be.equal(await v2Pool.getAddress());
        expect(await v2Withdraw.underlyingToken()).to.be.equal(await dummy.getAddress());
        await expect(v2Withdraw.initialize(dummy, poolAddress, poolAddress)).to.be.reverted;
    });

    describe("Withdrawal Request", async function() {

        beforeEach(async function() {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function() {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should be able to directly withdraw when pool has enough reserve", async function() {
            await v2Pool.connect(accounts[0]).approve(await v2Withdraw.getAddress(), parseEther("1000"));
            totalSupplyBefore = await v2Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v2Withdraw.connect(accounts[0]).requestWithdrawal(parseEther("1000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v2Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("1000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("0"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(0);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(0);
        });

        it("Should be able to place a withdraw request when pool doesn't have enough reserve", async function() {
            await v2Pool.connect(accounts[0]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await v2Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v2Withdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v2Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("4000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("4000"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);

            await v2Pool.connect(accounts[1]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await v2Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v2Withdraw.connect(accounts[1]).requestWithdrawal(parseEther("5000"), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await v2Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("0"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("0"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("6000"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("5000"),
                parseEther("6000"),
                0,
                accounts[1].address,
                false
            ]);
        });

        it("Should not allow to jump queue if new deposits replenishes the reserve", async function() {
            await v2Pool.connect(accounts[0]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await v2Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v2Withdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v2Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("4000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("4000"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);

            
            for(let i = 8; i < 10; i++) {
                await dummy.mint(accounts[i].address, parseEther("5000"));
                await dummy.connect(accounts[i]).approve(await v2Pool.getAddress(), parseEther("5000"));
                await v2Pool.connect(accounts[i]).deposit(parseEther("5000"), accounts[i].address);
            }

            await v2Pool.connect(accounts[1]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await v2Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v2Withdraw.connect(accounts[1]).requestWithdrawal(parseEther("5000"), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await v2Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("0"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("0"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("6000"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("5000"),
                parseEther("6000"),
                0,
                accounts[1].address,
                false
            ]);
        });

        it("Should allow to partially withdraw if new deposits replenishes the reserve", async function() {
            await v2Pool.connect(accounts[0]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await v2Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v2Withdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await v2Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("4000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("4000"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);

            
            for(let i = 8; i < 12; i++) {
                await dummy.mint(accounts[i].address, parseEther("5000"));
                await dummy.connect(accounts[i]).approve(await v2Pool.getAddress(), parseEther("5000"));
                await v2Pool.connect(accounts[i]).deposit(parseEther("5000"), accounts[i].address);
            }

            await v2Pool.connect(accounts[1]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await v2Pool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v2Withdraw.connect(accounts[1]).requestWithdrawal(parseEther("5000"), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await v2Pool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("1000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("5000"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("4000"),
                parseEther("5000"),
                0,
                accounts[1].address,
                false
            ]);
        });
    });

    describe("Withdrawal Fulfillment", async function() {
        before(async function() {
            snapshot = await network.provider.send("evm_snapshot", []);
            await v2Pool.connect(accounts[0]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            await v2Withdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
        });

        after(async function() {
            await network.provider.send("evm_revert", [snapshot]);
        });

        beforeEach(async function() {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function() {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should fulfill the request", async function() {
            balanceBefore = await dummy.balanceOf(await v2Withdraw.getAddress());
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1);
            // await v2Withdraw.repay(1, parseEther("1000"));
            balanceAfter = await dummy.balanceOf(await v2Withdraw.getAddress());
            expect(balanceAfter - balanceBefore).to.be.equal(parseEther("1000"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("0"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(1);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(1);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("0"),
                parseEther("1000"),
                parseEther("1000"),
                accounts[0].address,
                true
            ]);
        });

        it("Should revert if payment amount is 0", async function() {
            await expect(v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("0"), 0)).to.be.reverted;
        });

        it("Should succeed if paying in excess", async function() {
            await expect(v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1)).not.to.be.reverted;
        });

        it("Should fail if paying for 0th queue position", async function() {
            await expect(v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 0)).to.be.reverted;
            // await expect(v2Withdraw.repay(0, parseEther("10"))).to.be.reverted;
        });

        it("Should fail to fulfill requests if not enough funds", async function() {
            await v2Pool.connect(accounts[2]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            await v2Withdraw.connect(accounts[2]).requestWithdrawal(parseEther("5000"), accounts[2].address, accounts[2].address);
            await expect(v2Withdraw.repay(3, parseEther("1000"))).to.be.reverted;
        });

        it("Should fail to repay if caller does not have manager role", async function() {
            await v2Pool.connect(accounts[2]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            await v2Withdraw.connect(accounts[2]).requestWithdrawal(parseEther("5000"), accounts[2].address, accounts[2].address);
            await expect(v2Withdraw.connect(accounts[10]).repay(3, parseEther("1000"))).to.be.reverted;
        });

        it("Should fail if trying to repay an already fulfilled position", async function() {
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1);
            await v2Withdraw.repay(1, parseEther("1000"));
            await expect(v2Withdraw.repay(0, parseEther("1000"))).to.be.revertedWith("Queue position is not valid");
        });

        it("Should be able to fulfill multiple requests", async function() {
            await v2Pool.connect(accounts[2]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            await v2Withdraw.connect(accounts[2]).requestWithdrawal(parseEther("5000"), accounts[2].address, accounts[2].address);
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("5000"), 2);
            // await v2Withdraw.repay(2, parseEther("5000"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await v2Withdraw.currentQueuePosition()).to.be.equal(2);
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(2);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                parseEther("0"),
                accounts[0].address,
                false
            ]);
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("1000"),
                parseEther("6000"),
                parseEther("4000"),
                accounts[2].address,
                true
            ]);
        });
    });
    
    describe("Claim Request", async function() {   

        before(async function() {
            snapshot = await network.provider.send("evm_snapshot", []);
            await v2Pool.connect(accounts[0]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
            await v2Withdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
        });

        beforeEach(async function() {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function() {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should fail to claim if request is not fulfilled", async function() {
            await expect(v2Withdraw.connect(accounts[0]).claim(1,1)).to.be.revertedWith("Queue position is not fulfilled yet");
        });

        it("Should fail to claim if caller is blacklisted", async function() {
            // blacklist user
            await v2Pool.connect(accounts[17]).addBlackList(accounts[0].address);

            await expect(
                v2Withdraw.connect(accounts[0]).claim(1, 1)
            ).to.be.revertedWith("Assets are frozen");
        });


        it("Should be able to claim if claim is fulfilled", async function() {
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1);
            // await v2Withdraw.repay(1, parseEther("1000"));
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            withdrawBalanceBefore = await dummy.balanceOf(await v2Withdraw.getAddress());
            await v2Withdraw.connect(accounts[0]).claim(1,1000);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            withdrawBalanceAfter = await dummy.balanceOf(await v2Withdraw.getAddress());
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));
            expect(withdrawBalanceBefore - withdrawBalanceAfter).to.be.equal(parseEther("1000"));
        });

        it("Should be able to repay in excess", async function() {
            for (i = 1; i < 6; i++) {
                await v2Pool.connect(accounts[i]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
                await v2Withdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("26000"));

            await dummy.mint(await v2FundManager.getAddress(), parseEther("60000"));
            await expect(v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("60000"), 100)).not.to.be.reverted;
        });

        it("Should claim different requests", async function() {
            for (i = 1; i < 6; i++) {
                await v2Pool.connect(accounts[i]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
                await v2Withdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("26000"));

            // repay 1,2
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000"), 2);
            // await v2Withdraw.repay(2, parseEther("6000"));
            expect(await v2Withdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,parseEther("1")]
            ]);
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("20000"));
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(2);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("5000"),
                accounts[1].address,
                true
            ]);

            // repay 3, partial 4
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000"), 4);
            // await v2Withdraw.repay(4, parseEther("8000"));
            expect(await v2Withdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,parseEther("1")],
                [3,parseEther("1")]
            ]);
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("12000"));
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(4);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("5000"),
                accounts[1].address,
                true
            ]);
            expect(await v2Withdraw.withdrawalQueue(3)).to.deep.equal([
                parseEther("5000"),
                parseEther("11000"),
                0,
                accounts[2].address,
                false
            ]);
            expect(await v2Withdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("2000"),
                parseEther("16000"),
                parseEther("3000"),
                accounts[3].address,
                true
            ]);

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            
            // blacklist user 4
            await v2Pool.connect(accounts[17]).addBlackList(accounts[3].address);

            await expect(
                v2Withdraw.connect(accounts[3]).claim(4, 12345)
            ).to.be.revertedWith("Assets are frozen");

            // remove  user 4 from blacklist 
            await v2Pool.connect(accounts[17]).removeBlackList(accounts[3].address);

            await v2Withdraw.connect(accounts[3]).claim(4,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("3000"));
            expect(await v2Withdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("2000"),
                parseEther("16000"),
                parseEther("0"),
                accounts[3].address,
                true
            ]);
            
            // repay partial 4,5,6
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000"), 6);
            // await v2Withdraw.repay(6, parseEther("12000"));
            expect(await v2Withdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,parseEther("1")],
                [3,parseEther("1")],
                [5,parseEther("1")]
            ]);
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(parseEther("0"));
            expect(await v2Withdraw.fulfilledQueuePosition()).to.be.equal(6);
            expect(await v2Withdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("5000"),
                accounts[1].address,
                true
            ]);
            expect(await v2Withdraw.withdrawalQueue(3)).to.deep.equal([
                parseEther("5000"),
                parseEther("11000"),
                0,
                accounts[2].address,
                false
            ]);
            expect(await v2Withdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("0"),
                parseEther("16000"),
                parseEther("2000"),
                accounts[3].address,
                true
            ]);
            expect(await v2Withdraw.withdrawalQueue(5)).to.deep.equal([
                parseEther("5000"),
                parseEther("21000"),
                0,
                accounts[4].address,
                false
            ]);
            expect(await v2Withdraw.withdrawalQueue(6)).to.deep.equal([
                parseEther("0"),
                parseEther("26000"),
                parseEther("5000"),
                accounts[5].address,
                true
            ]);

            // claim 6, 5
            userBalanceBefore = await dummy.balanceOf(accounts[5].address);
            await v2Withdraw.connect(accounts[5]).claim(6,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[5].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));
            expect(await v2Withdraw.withdrawalQueue(6)).to.deep.equal([
                parseEther("0"),
                parseEther("26000"),
                parseEther("0"),
                accounts[5].address,
                true
            ]);

            userBalanceBefore = await dummy.balanceOf(accounts[4].address);
            await v2Withdraw.connect(accounts[4]).claim(5,3);
            userBalanceAfter = await dummy.balanceOf(accounts[4].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));

            // claim 3
            userBalanceBefore = await dummy.balanceOf(accounts[2].address);
            await v2Withdraw.connect(accounts[2]).claim(3,2);
            userBalanceAfter = await dummy.balanceOf(accounts[2].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));

            // claim 2, 1
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v2Withdraw.connect(accounts[1]).claim(2,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));
            expect(await v2Withdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("0"),
                accounts[1].address,
                true
            ]);

            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v2Withdraw.connect(accounts[0]).claim(1,1);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            await v2Withdraw.connect(accounts[3]).claim(4,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("2000"));
            expect(await v2Withdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("0"),
                parseEther("16000"),
                parseEther("0"),
                accounts[3].address,
                true
            ]);
        });

        it("Should fail to claim if repayment index provided is incorrect", async function() {
            for (i = 1; i < 6; i++) {
                await v2Pool.connect(accounts[i]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
                await v2Withdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000"), 2);
            // await v2Withdraw.repay(2, parseEther("6000"));

            // repay 3, partial 4
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000"), 4);
            // await v2Withdraw.repay(4, parseEther("8000"));
            
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000"), 6);
            // await v2Withdraw.repay(6, parseEther("12000"));

            await expect(v2Withdraw.connect(accounts[2]).claim(3,3)).to.be.revertedWith("Repayment data index is not valid");
            await expect(v2Withdraw.connect(accounts[0]).claim(1,2)).to.be.revertedWith("Repayment data index is not valid");
            await expect(v2Withdraw.connect(accounts[2]).claim(3,1)).to.be.revertedWith("Repayment data index is not valid");
            await expect(v2Withdraw.connect(accounts[0]).claim(1,0)).to.be.reverted;
            await expect(v2Withdraw.connect(accounts[2]).claim(3,4)).to.be.reverted;           
        });

        it("Should fail to claim if already claimed", async function() {
            for (i = 1; i < 6; i++) {
                await v2Pool.connect(accounts[i]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
                await v2Withdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000"), 2);
            // await v2Withdraw.repay(2, parseEther("6000"));

            // repay 3, partial 4
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000"), 4);
            // await v2Withdraw.repay(4, parseEther("8000"));
            
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000"), 6);
            // await v2Withdraw.repay(6, parseEther("12000"));
              
            await v2Withdraw.connect(accounts[5]).claim(6,12345);

            beforeBalance = await dummy.balanceOf(accounts[5].address);
            await expect(v2Withdraw.connect(accounts[5]).claim(6,12345)).to.be.reverted;
            afterBalance = await dummy.balanceOf(accounts[5].address);
            expect(afterBalance - beforeBalance).to.be.equal(0);

            await v2Withdraw.connect(accounts[4]).claim(5,3);

            beforeBalance = await dummy.balanceOf(accounts[4].address);
            await expect(v2Withdraw.connect(accounts[4]).claim(5,3)).to.be.reverted;
            afterBalance = await dummy.balanceOf(accounts[4].address);
            expect(afterBalance - beforeBalance).to.be.equal(0);
        });

        it("Should claim different requests with different exchange ratios", async function() {
            for (i = 1; i < 6; i++) {
                await v2Pool.connect(accounts[i]).approve(await v2Withdraw.getAddress(), parseEther("5000"));
                await v2Withdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            await dummy.mint(await v2FundManager.getAddress(), parseEther("1000"));
            exchangeRatio1 = await v2Pool.convertToAssets(parseEther("1"));

            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000") * exchangeRatio1 / parseEther("1"), 2);
            withdrawalObject2 = await v2Withdraw.withdrawalQueue(2);
            
            // await v2Withdraw.repay(2, parseEther("6000") * exchangeRatio1 / parseEther("1"));
            expect(await v2Withdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,exchangeRatio1]
            ]);

            // repay 3, partial 4
            await dummy.mint(await v2FundManager.getAddress(), parseEther("1000"));
            exchangeRatio2 = await v2Pool.convertToAssets(parseEther("1"));

            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000") * exchangeRatio2 / parseEther("1"), 4);
            withdrawalObject4 = await v2Withdraw.withdrawalQueue(4);

            // await v2Withdraw.repay(4, parseEther("8000") * exchangeRatio2 / parseEther("1"));
            expect(await v2Withdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,exchangeRatio1],
                [3,exchangeRatio2]
            ]);
            
            // repay partial 4,5,6
            await dummy.mint(await v2FundManager.getAddress(), parseEther("1000"));
            exchangeRatio3 = await v2Pool.convertToAssets(parseEther("1"));

            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000") * exchangeRatio3 / parseEther("1"), 6);

            // await v2Withdraw.repay(6, parseEther("12000") * exchangeRatio3 / parseEther("1"));
            expect(await v2Withdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,exchangeRatio1],
                [3,exchangeRatio2],
                [5,exchangeRatio3]
            ]);

            // claim 6, 5
            userBalanceBefore = await dummy.balanceOf(accounts[5].address);
            await v2Withdraw.connect(accounts[5]).claim(6,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[5].address);
            withdrawalObject = await v2Withdraw.withdrawalQueue(6);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((parseEther("5000") - withdrawalObject[0]) * exchangeRatio3 / parseEther("1"));

            userBalanceBefore = await dummy.balanceOf(accounts[4].address);
            await v2Withdraw.connect(accounts[4]).claim(5,3);
            userBalanceAfter = await dummy.balanceOf(accounts[4].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000") * exchangeRatio3 / parseEther("1"));

            // claim 1
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await v2Withdraw.connect(accounts[0]).claim(1,1);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000") * exchangeRatio1 / parseEther("1"));

            // claim 2
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await v2Withdraw.connect(accounts[1]).claim(2,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((parseEther("5000") - withdrawalObject2[0]) * exchangeRatio1 / parseEther("1") + withdrawalObject2[0] * exchangeRatio2 / parseEther("1"));

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            await v2Withdraw.connect(accounts[3]).claim(4,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((parseEther("5000") - withdrawalObject4[0]) * exchangeRatio2 / parseEther("1") + withdrawalObject4[0] * exchangeRatio3 / parseEther("1"));

            // claim 3
            userBalanceBefore = await dummy.balanceOf(accounts[2].address);
            await v2Withdraw.connect(accounts[2]).claim(3,2);
            userBalanceAfter = await dummy.balanceOf(accounts[2].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000") * exchangeRatio2 / parseEther("1"));
            expect(await v2Withdraw.totalDueLPToken()).to.be.equal(withdrawalObject[0]);
        });
    });
    
    describe("Emergency Withdraw", async function() {
        it("Should emergency withdraw funds", async function() {
            await dummy.mint(await v2Withdraw.getAddress(), parseEther("5000"));
            WMbalanceBefore = await dummy.balanceOf(await v2Withdraw.getAddress());
            userbalanceBefore = await dummy.balanceOf(accounts[14].address);
            await expect(v2Withdraw.emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5000"))).to.emit(v2Withdraw, "EmergencyWithdraw").withArgs(await dummy.getAddress(), accounts[14].address, parseEther("5000"));
            expect(await dummy.balanceOf(await v2Withdraw.getAddress())).to.equal(WMbalanceBefore - parseEther("5000"));
            expect(await dummy.balanceOf(accounts[14].address)).to.equal(userbalanceBefore + parseEther("5000"));
        });

        it("Should fail if withdrawing without admin", async function(){
            await expect(v2Withdraw.connect(accounts[14]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5"))).to.be.reverted;
        });
    });

    // -------------------------------------------------------------------------
    // _disableInitializers() verification — the V2 WM constructor now locks
    // the bare implementation so it cannot be initialized directly (prevents
    // the canonical UUPS implementation-self-destruct attack).
    // -------------------------------------------------------------------------
    describe("Implementation security (_disableInitializers)", async function () {
        it("V2 WM implementation cannot be initialized directly", async function () {
            const factory = await getContractFactory("CsigmaV2WithdrawalManager");
            const impl = await factory.deploy();
            await expect(
                impl.initialize(await dummy.getAddress(), await v2Pool.getAddress(), accounts[12].address)
            ).to.be.revertedWith("Initializable: contract is already initialized");
        });
    });
});