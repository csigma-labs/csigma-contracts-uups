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

describe("Permissioned-Withdrawal Module", async function() {
    let accounts, permissionedPool, dummy, permissionedFactory, permissionedFundManager, permissionedWithdraw, snapshot, localSnapshot, diamondV1;
    
    const KYBStatus = {
        PENDING: 0,
        VERIFIED: 1,
        REJECTED: 2
    };
    
    before(async function() {
        accounts = await ethers.getSigners();
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await dummyFactory.deploy();

        let poolFactory = await getContractFactory("CsigmaPermissionedPool");
        poolImplementation = await (await poolFactory.deploy()).getAddress();
        
        let fundManagerFactory = await getContractFactory("CsigmaPermissionedFundManager");
        fundManagerImplementation = await (await fundManagerFactory.deploy()).getAddress();

        let v1DiamondFactory = await getContractFactory("MockV1");
        diamondV1 = await v1DiamondFactory.deploy();

        let withdrawFactory = await getContractFactory("CsigmaPermissionedWithdrawalManager");
        withdrawManagerImplementation = await (await withdrawFactory.deploy()).getAddress();
        
        factoryFactory = await getContractFactory("CsigmaPermissionedFactory");
        let factoryImpl = await factoryFactory.deploy();
        let proxyFactory = await getContractFactory("ERC1967Proxy");
        let proxy = await proxyFactory.deploy(await factoryImpl.getAddress(), "0x");
        permissionedFactory = await ethers.getContractAt("CsigmaPermissionedFactory", await proxy.getAddress());
        
        await permissionedFactory.initialize(
            accounts[0].address,
            accounts[0].address,
            fundManagerImplementation,
            poolImplementation,
            withdrawManagerImplementation,
            await diamondV1.getAddress()
        );
        
        await diamondV1.setPoolManagerData("PM1", accounts[17].address, KYBStatus.VERIFIED);
        
        await permissionedFactory.addPoolManager("PM1", accounts[17].address);
        await permissionedFactory.addTokenToWhitelist(await dummy.getAddress());

        let poolTx = await permissionedFactory.connect(accounts[17]).createPool(
            "Test Pool",
            "TP",
            "Lender1",
            await dummy.getAddress(),
            accounts[19].address,
            parseEther("1000000")
        );

        poolTx = await poolTx.wait();
        poolAddress = poolTx.logs[8].args._pool;
        permissionedPool = await ethers.getContractAt("CsigmaPermissionedPool", poolAddress);
        
        await permissionedFactory.activatePool(poolAddress);

        fundManagerAddress = poolTx.logs[8].args._fundManager;
        permissionedFundManager = await ethers.getContractAt("CsigmaPermissionedFundManager", fundManagerAddress);

        await permissionedPool.connect(accounts[17]).updateNonReservePercentage("9000");
        
        // Setup lenders in Diamond
        for(let i = 0; i < 13; i++) {
            await diamondV1.setLenderData(`LENDER00${i}`, accounts[i].address, KYBStatus.VERIFIED);
        }
        
        // Whitelist lenders and deposit
        for(let i = 0; i < 8; i++) {
            await permissionedPool.connect(accounts[17]).addWhitelistLender(`LENDER00${i}`, accounts[i].address);
            await dummy.mint(accounts[i].address, parseEther("5000"));
            await dummy.connect(accounts[i]).approve(await permissionedPool.getAddress(), parseEther("5000"));
            await permissionedPool.connect(accounts[i]).deposit(parseEther("5000"), accounts[i].address);
        }

        // Create withdrawal manager
        await permissionedFactory.connect(accounts[17]).createWithdrawalManager(poolAddress, accounts[12].address);
        const wmAddress = await permissionedPool.withdrawalManager();
        permissionedWithdraw = await ethers.getContractAt("CsigmaPermissionedWithdrawalManager", wmAddress);
        
        await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
    });

    it("Should have initialized correctly", async function() {
        expect(await permissionedWithdraw.LPToken()).to.be.equal(await permissionedPool.getAddress());
        expect(await permissionedWithdraw.underlyingToken()).to.be.equal(await dummy.getAddress());
        expect(await permissionedWithdraw.csigmaRouter()).to.be.equal(accounts[12].address);
        // repay() authorization is now sourced from Pool.fundManager() and Pool.poolManager() — verify those
        expect(await permissionedPool.fundManager()).to.be.equal(await permissionedFundManager.getAddress());
        expect(await permissionedPool.poolManager()).to.be.equal(accounts[17].address);
        expect(await permissionedWithdraw.hasRole(await permissionedWithdraw.DEFAULT_ADMIN_ROLE(), accounts[17].address)).to.be.true;
        await expect(permissionedWithdraw.initialize(dummy, poolAddress, accounts[12].address)).to.be.reverted;
    });

    describe("Withdrawal Request", async function() {

        beforeEach(async function() {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function() {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should be able to directly withdraw when pool has enough reserve", async function() {
            await permissionedPool.connect(accounts[0]).approve(await permissionedWithdraw.getAddress(), parseEther("1000"));
            totalSupplyBefore = await permissionedPool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await permissionedWithdraw.connect(accounts[0]).requestWithdrawal(parseEther("1000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await permissionedPool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("1000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("0"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(0);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(0);
        });

        it("Should be able to place a withdraw request when pool doesn't have enough reserve", async function() {
            await permissionedPool.connect(accounts[0]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await permissionedPool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await permissionedWithdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await permissionedPool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("4000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("4000"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);

            await permissionedPool.connect(accounts[1]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await permissionedPool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await permissionedWithdraw.connect(accounts[1]).requestWithdrawal(parseEther("5000"), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await permissionedPool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("0"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("0"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("6000"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("5000"),
                parseEther("6000"),
                0,
                accounts[1].address,
                false
            ]);
        });

        it("Should not allow to jump queue if new deposits replenishes the reserve", async function() {
            await permissionedPool.connect(accounts[0]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await permissionedPool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await permissionedWithdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await permissionedPool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("4000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("4000"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);

            
            for(let i = 8; i < 10; i++) {
                await diamondV1.setLenderData(`LENDER00${i}`, accounts[i].address, KYBStatus.VERIFIED);
                await permissionedPool.connect(accounts[17]).addWhitelistLender(`LENDER00${i}`, accounts[i].address);
                await dummy.mint(accounts[i].address, parseEther("5000"));
                await dummy.connect(accounts[i]).approve(await permissionedPool.getAddress(), parseEther("5000"));
                await permissionedPool.connect(accounts[i]).deposit(parseEther("5000"), accounts[i].address);
            }

            await permissionedPool.connect(accounts[1]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await permissionedPool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await permissionedWithdraw.connect(accounts[1]).requestWithdrawal(parseEther("5000"), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await permissionedPool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("0"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("0"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("6000"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("5000"),
                parseEther("6000"),
                0,
                accounts[1].address,
                false
            ]);
        });

        it("Should allow to partially withdraw if new deposits replenishes the reserve", async function() {
            await permissionedPool.connect(accounts[0]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await permissionedPool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await permissionedWithdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            totalSupplyAfter = await permissionedPool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("4000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("4000"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(1n);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);

            
            for(let i = 8; i < 12; i++) {
                await diamondV1.setLenderData(`LENDER00${i}`, accounts[i].address, KYBStatus.VERIFIED);
                await permissionedPool.connect(accounts[17]).addWhitelistLender(`LENDER00${i}`, accounts[i].address);
                await dummy.mint(accounts[i].address, parseEther("5000"));
                await dummy.connect(accounts[i]).approve(await permissionedPool.getAddress(), parseEther("5000"));
                await permissionedPool.connect(accounts[i]).deposit(parseEther("5000"), accounts[i].address);
            }

            await permissionedPool.connect(accounts[1]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            totalSupplyBefore = await permissionedPool.totalSupply();
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await permissionedWithdraw.connect(accounts[1]).requestWithdrawal(parseEther("5000"), accounts[1].address, accounts[1].address);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            totalSupplyAfter = await permissionedPool.totalSupply();
            expect(totalSupplyBefore - totalSupplyAfter).to.be.equal(parseEther("1000"));
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("5000"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(2n);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(0n);
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
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
            await permissionedPool.connect(accounts[0]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            await permissionedWithdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
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
            balanceBefore = await dummy.balanceOf(await permissionedWithdraw.getAddress());
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1);
            balanceAfter = await dummy.balanceOf(await permissionedWithdraw.getAddress());
            expect(balanceAfter - balanceBefore).to.be.equal(parseEther("1000"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("0"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(1);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(1);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("0"),
                parseEther("1000"),
                parseEther("1000"),
                accounts[0].address,
                true
            ]);
        });

        it("Should revert if payment amount is 0", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("0"), 0)).to.be.reverted;
        });

        it("Should succeed if paying in excess", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1)).not.to.be.reverted;
        });

        it("Should fail if paying for 0th queue position", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 0)).to.be.reverted;
        });

        it("Should fail to fulfill requests if not enough funds", async function() {
            await permissionedPool.connect(accounts[2]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            await permissionedWithdraw.connect(accounts[2]).requestWithdrawal(parseEther("5000"), accounts[2].address, accounts[2].address);
            await expect(permissionedWithdraw.repay(3, parseEther("1000"))).to.be.reverted;
        });

        it("Should fail to repay if caller is neither FundManager nor PoolManager", async function() {
            await permissionedPool.connect(accounts[2]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            await permissionedWithdraw.connect(accounts[2]).requestWithdrawal(parseEther("5000"), accounts[2].address, accounts[2].address);
            await expect(permissionedWithdraw.connect(accounts[10]).repay(3, parseEther("1000")))
                .to.be.revertedWithCustomError(permissionedWithdraw, "AccessDenied").withArgs(accounts[10].address);
        });

        it("Should fail if trying to repay an already fulfilled position", async function() {
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1);
            // repay must be called by the pool manager (accounts[17]) — direct call from accounts[0] is no longer authorized
            await permissionedWithdraw.connect(accounts[17]).repay(1, parseEther("1000"));
            await expect(permissionedWithdraw.connect(accounts[17]).repay(0, parseEther("1000"))).to.be.revertedWith("Queue position is not valid");
        });

        it("Should be able to fulfill multiple requests", async function() {
            await permissionedPool.connect(accounts[2]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            await permissionedWithdraw.connect(accounts[2]).requestWithdrawal(parseEther("5000"), accounts[2].address, accounts[2].address);
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("5000"), 2);
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("1000"));
            expect(await permissionedWithdraw.currentQueuePosition()).to.be.equal(2);
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(2);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                parseEther("0"),
                accounts[0].address,
                false
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
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
            await permissionedPool.connect(accounts[0]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
            await permissionedWithdraw.connect(accounts[0]).requestWithdrawal(parseEther("5000"), accounts[0].address, accounts[0].address);
        });

        beforeEach(async function() {
            localSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function() {
            await network.provider.send("evm_revert", [localSnapshot]);
        });

        it("Should fail to claim if request is not fulfilled", async function() {
            await expect(permissionedWithdraw.connect(accounts[0]).claim(1,1)).to.be.revertedWith("Queue position is not fulfilled yet");
        });

        it("Should fail to claim if caller is not whitelisted", async function() {
            // Remove lender from whitelist
            await permissionedPool.connect(accounts[17]).removeWhitelistLender(accounts[0].address);

            await expect(
                permissionedWithdraw.connect(accounts[0]).claim(1, 1)
            ).to.be.revertedWith("Assets are frozen");

            // Restore whitelist
            await permissionedPool.connect(accounts[17]).addWhitelistLender("LENDER000", accounts[0].address);
        });

        it("Should be able to claim if claim is fulfilled", async function() {
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("1000"), 1);
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            withdrawBalanceBefore = await dummy.balanceOf(await permissionedWithdraw.getAddress());
            await permissionedWithdraw.connect(accounts[0]).claim(1,1000);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            withdrawBalanceAfter = await dummy.balanceOf(await permissionedWithdraw.getAddress());
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));
            expect(withdrawBalanceBefore - withdrawBalanceAfter).to.be.equal(parseEther("1000"));
        });

        it("Should be able to repay in excess", async function() {
            for (i = 1; i < 6; i++) {
                await permissionedPool.connect(accounts[i]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
                await permissionedWithdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("26000"));

            await dummy.mint(await permissionedFundManager.getAddress(), parseEther("60000"));
            await expect(permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("60000"), 100)).not.to.be.reverted;
        });

        it("Should claim different requests", async function() {
            for (i = 1; i < 6; i++) {
                await permissionedPool.connect(accounts[i]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
                await permissionedWithdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("26000"));

            // repay 1,2
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000"), 2);
            expect(await permissionedWithdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,parseEther("1")]
            ]);
            expect(await permissionedWithdraw.getRepaymentDataLength()).to.be.equal(2);
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("20000"));
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(2);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("5000"),
                accounts[1].address,
                true
            ]);

            // repay 3, partial 4
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000"), 4);
            expect(await permissionedWithdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,parseEther("1")],
                [3,parseEther("1")]
            ]);
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("12000"));
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(4);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("5000"),
                accounts[1].address,
                true
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(3)).to.deep.equal([
                parseEther("5000"),
                parseEther("11000"),
                0,
                accounts[2].address,
                false
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("2000"),
                parseEther("16000"),
                parseEther("3000"),
                accounts[3].address,
                true
            ]);

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            
            // Remove user 4 from whitelist
            await permissionedPool.connect(accounts[17]).removeWhitelistLender(accounts[3].address);

            await expect(
                permissionedWithdraw.connect(accounts[3]).claim(4, 12345)
            ).to.be.revertedWith("Assets are frozen");

            // Add user 4 back to whitelist
            await permissionedPool.connect(accounts[17]).addWhitelistLender("LENDER003", accounts[3].address);

            await permissionedWithdraw.connect(accounts[3]).claim(4,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("3000"));
            expect(await permissionedWithdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("2000"),
                parseEther("16000"),
                parseEther("0"),
                accounts[3].address,
                true
            ]);
            
            // repay partial 4,5,6
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000"), 6);
            expect(await permissionedWithdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,parseEther("1")],
                [3,parseEther("1")],
                [5,parseEther("1")]
            ]);
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(parseEther("0"));
            expect(await permissionedWithdraw.fulfilledQueuePosition()).to.be.equal(6);
            expect(await permissionedWithdraw.withdrawalQueue(1)).to.deep.equal([
                parseEther("1000"),
                parseEther("1000"),
                0,
                accounts[0].address,
                false
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("5000"),
                accounts[1].address,
                true
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(3)).to.deep.equal([
                parseEther("5000"),
                parseEther("11000"),
                0,
                accounts[2].address,
                false
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("0"),
                parseEther("16000"),
                parseEther("2000"),
                accounts[3].address,
                true
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(5)).to.deep.equal([
                parseEther("5000"),
                parseEther("21000"),
                0,
                accounts[4].address,
                false
            ]);
            expect(await permissionedWithdraw.withdrawalQueue(6)).to.deep.equal([
                parseEther("0"),
                parseEther("26000"),
                parseEther("5000"),
                accounts[5].address,
                true
            ]);

            // claim 6, 5
            userBalanceBefore = await dummy.balanceOf(accounts[5].address);
            await permissionedWithdraw.connect(accounts[5]).claim(6,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[5].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));
            expect(await permissionedWithdraw.withdrawalQueue(6)).to.deep.equal([
                parseEther("0"),
                parseEther("26000"),
                parseEther("0"),
                accounts[5].address,
                true
            ]);

            userBalanceBefore = await dummy.balanceOf(accounts[4].address);
            await permissionedWithdraw.connect(accounts[4]).claim(5,3);
            userBalanceAfter = await dummy.balanceOf(accounts[4].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));

            // claim 3
            userBalanceBefore = await dummy.balanceOf(accounts[2].address);
            await permissionedWithdraw.connect(accounts[2]).claim(3,2);
            userBalanceAfter = await dummy.balanceOf(accounts[2].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));

            // claim 2, 1
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await permissionedWithdraw.connect(accounts[1]).claim(2,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000"));
            expect(await permissionedWithdraw.withdrawalQueue(2)).to.deep.equal([
                parseEther("0"),
                parseEther("6000"),
                parseEther("0"),
                accounts[1].address,
                true
            ]);

            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await permissionedWithdraw.connect(accounts[0]).claim(1,1);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000"));

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            await permissionedWithdraw.connect(accounts[3]).claim(4,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("2000"));
            expect(await permissionedWithdraw.withdrawalQueue(4)).to.deep.equal([
                parseEther("0"),
                parseEther("16000"),
                parseEther("0"),
                accounts[3].address,
                true
            ]);
        });

        it("Should fail to claim if repayment index provided is incorrect", async function() {
            for (i = 1; i < 6; i++) {
                await permissionedPool.connect(accounts[i]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
                await permissionedWithdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
                expect(await permissionedWithdraw.getUserRequestsCount(accounts[i].address)).to.be.equal(1);
            }

            // repay 1,2
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000"), 2);

            // repay 3, partial 4
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000"), 4);
            
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000"), 6);

            await expect(permissionedWithdraw.connect(accounts[2]).claim(3,3)).to.be.revertedWith("Repayment data index is not valid");
            await expect(permissionedWithdraw.connect(accounts[0]).claim(1,2)).to.be.revertedWith("Repayment data index is not valid");
            await expect(permissionedWithdraw.connect(accounts[2]).claim(3,1)).to.be.revertedWith("Repayment data index is not valid");
            await expect(permissionedWithdraw.connect(accounts[0]).claim(1,0)).to.be.reverted;
            await expect(permissionedWithdraw.connect(accounts[2]).claim(3,4)).to.be.reverted;           
        });

        it("Should fail to claim if already claimed", async function() {
            for (i = 1; i < 6; i++) {
                await permissionedPool.connect(accounts[i]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
                await permissionedWithdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000"), 2);

            // repay 3, partial 4
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000"), 4);
            
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000"), 6);
              
            await permissionedWithdraw.connect(accounts[5]).claim(6,12345);

            beforeBalance = await dummy.balanceOf(accounts[5].address);
            await expect(permissionedWithdraw.connect(accounts[5]).claim(6,12345)).to.be.reverted;
            afterBalance = await dummy.balanceOf(accounts[5].address);
            expect(afterBalance - beforeBalance).to.be.equal(0);

            await permissionedWithdraw.connect(accounts[4]).claim(5,3);

            beforeBalance = await dummy.balanceOf(accounts[4].address);
            await expect(permissionedWithdraw.connect(accounts[4]).claim(5,3)).to.be.reverted;
            afterBalance = await dummy.balanceOf(accounts[4].address);
            expect(afterBalance - beforeBalance).to.be.equal(0);
        });

        it("Should claim different requests with different exchange ratios", async function() {
            for (i = 1; i < 6; i++) {
                await permissionedPool.connect(accounts[i]).approve(await permissionedWithdraw.getAddress(), parseEther("5000"));
                await permissionedWithdraw.connect(accounts[i]).requestWithdrawal(parseEther("5000"), accounts[i].address, accounts[i].address);
            }

            // repay 1,2
            await dummy.mint(await permissionedFundManager.getAddress(), parseEther("1000"));
            exchangeRatio1 = await permissionedPool.convertToAssets(parseEther("1"));

            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("6000") * exchangeRatio1 / parseEther("1"), 2);
            withdrawalObject2 = await permissionedWithdraw.withdrawalQueue(2);
            
            expect(await permissionedWithdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,exchangeRatio1]
            ]);

            // repay 3, partial 4
            await dummy.mint(await permissionedFundManager.getAddress(), parseEther("1000"));
            exchangeRatio2 = await permissionedPool.convertToAssets(parseEther("1"));

            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("8000") * exchangeRatio2 / parseEther("1"), 4);
            withdrawalObject4 = await permissionedWithdraw.withdrawalQueue(4);

            expect(await permissionedWithdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,exchangeRatio1],
                [3,exchangeRatio2]
            ]);
            
            // repay partial 4,5,6
            await dummy.mint(await permissionedFundManager.getAddress(), parseEther("1000"));
            exchangeRatio3 = await permissionedPool.convertToAssets(parseEther("1"));

            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("12000") * exchangeRatio3 / parseEther("1"), 6);

            expect(await permissionedWithdraw.getRepaymentData()).to.deep.equal([
                [0,0],
                [1,exchangeRatio1],
                [3,exchangeRatio2],
                [5,exchangeRatio3]
            ]);

            // claim 6, 5
            userBalanceBefore = await dummy.balanceOf(accounts[5].address);
            await permissionedWithdraw.connect(accounts[5]).claim(6,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[5].address);
            withdrawalObject = await permissionedWithdraw.withdrawalQueue(6);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((parseEther("5000") - withdrawalObject[0]) * exchangeRatio3 / parseEther("1"));

            userBalanceBefore = await dummy.balanceOf(accounts[4].address);
            await permissionedWithdraw.connect(accounts[4]).claim(5,3);
            userBalanceAfter = await dummy.balanceOf(accounts[4].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000") * exchangeRatio3 / parseEther("1"));

            // claim 1
            userBalanceBefore = await dummy.balanceOf(accounts[0].address);
            await permissionedWithdraw.connect(accounts[0]).claim(1,1);
            userBalanceAfter = await dummy.balanceOf(accounts[0].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("1000") * exchangeRatio1 / parseEther("1"));

            // claim 2
            userBalanceBefore = await dummy.balanceOf(accounts[1].address);
            await permissionedWithdraw.connect(accounts[1]).claim(2,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[1].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((parseEther("5000") - withdrawalObject2[0]) * exchangeRatio1 / parseEther("1") + withdrawalObject2[0] * exchangeRatio2 / parseEther("1"));

            // claim 4
            userBalanceBefore = await dummy.balanceOf(accounts[3].address);
            await permissionedWithdraw.connect(accounts[3]).claim(4,12345);
            userBalanceAfter = await dummy.balanceOf(accounts[3].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal((parseEther("5000") - withdrawalObject4[0]) * exchangeRatio2 / parseEther("1") + withdrawalObject4[0] * exchangeRatio3 / parseEther("1"));

            // claim 3
            userBalanceBefore = await dummy.balanceOf(accounts[2].address);
            await permissionedWithdraw.connect(accounts[2]).claim(3,2);
            userBalanceAfter = await dummy.balanceOf(accounts[2].address);
            expect(userBalanceAfter - userBalanceBefore).to.be.equal(parseEther("5000") * exchangeRatio2 / parseEther("1"));
            expect(await permissionedWithdraw.totalDueLPToken()).to.be.equal(withdrawalObject[0]);
        });
    });

    describe("Update CsigmaRouter", async function() {
        it("Should update csigmaRouter address", async function() {
            const oldRouter = await permissionedWithdraw.csigmaRouter();
            const newRouter = accounts[15].address;
            
            await expect(permissionedWithdraw.connect(accounts[17]).updateCsigmaRouter(newRouter))
                .to.not.be.reverted;
            
            expect(await permissionedWithdraw.csigmaRouter()).to.equal(newRouter);
            expect(await permissionedWithdraw.csigmaRouter()).to.not.equal(oldRouter);
        });

        it("Should fail to update csigmaRouter if not admin", async function() {
            const newRouter = accounts[15].address;
            
            await expect(permissionedWithdraw.connect(accounts[10]).updateCsigmaRouter(newRouter))
                .to.be.reverted;
        });

        it("Should update router multiple times", async function() {
            const router1 = accounts[13].address;
            const router2 = accounts[14].address;
            const router3 = accounts[15].address;
            
            await permissionedWithdraw.connect(accounts[17]).updateCsigmaRouter(router1);
            expect(await permissionedWithdraw.csigmaRouter()).to.equal(router1);
            
            await permissionedWithdraw.connect(accounts[17]).updateCsigmaRouter(router2);
            expect(await permissionedWithdraw.csigmaRouter()).to.equal(router2);
            
            await permissionedWithdraw.connect(accounts[17]).updateCsigmaRouter(router3);
            expect(await permissionedWithdraw.csigmaRouter()).to.equal(router3);
        });

        it("Should allow setting router to zero address if needed", async function() {
            // This might be needed for migration or emergency scenarios
            await expect(permissionedWithdraw.connect(accounts[17]).updateCsigmaRouter(ethers.ZeroAddress))
                .to.not.be.reverted;
            
            expect(await permissionedWithdraw.csigmaRouter()).to.equal(ethers.ZeroAddress);
            
            // Restore to valid address
            await permissionedWithdraw.connect(accounts[17]).updateCsigmaRouter(accounts[12].address);
        });
    });
    
    describe("Emergency Withdraw", async function() {
        it("Should emergency withdraw funds", async function() {
            await dummy.mint(await permissionedWithdraw.getAddress(), parseEther("5000"));
            WMbalanceBefore = await dummy.balanceOf(await permissionedWithdraw.getAddress());
            userbalanceBefore = await dummy.balanceOf(accounts[14].address);
            await expect(permissionedWithdraw.connect(accounts[17]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5000")))
                .to.emit(permissionedWithdraw, "EmergencyWithdraw")
                .withArgs(await dummy.getAddress(), accounts[14].address, parseEther("5000"));
            expect(await dummy.balanceOf(await permissionedWithdraw.getAddress())).to.equal(WMbalanceBefore - parseEther("5000"));
            expect(await dummy.balanceOf(accounts[14].address)).to.equal(userbalanceBefore + parseEther("5000"));
        });

        it("Should fail if withdrawing without admin", async function(){
            await expect(permissionedWithdraw.connect(accounts[14]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5"))).to.be.reverted;
        });
    });

    describe("Repay Authorization", async function() {
        let repaySnapshot;

        before(async function() {
            await diamondV1.setPoolManagerData("PM2", accounts[18].address, KYBStatus.VERIFIED);
            await permissionedFactory.addPoolManager("PM2", accounts[18].address);
            repaySnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function() {
            await network.provider.send("evm_revert", [repaySnapshot]);
            repaySnapshot = await network.provider.send("evm_snapshot", []);
        });

        it("Should not expose MANAGER_ROLE constant", async function() {
            expect(permissionedWithdraw.MANAGER_ROLE).to.be.undefined;
        });

        it("Should allow current poolManager to call repay", async function() {
            // Authorization passes for the current PM; any later revert is from math/state, not auth.
            try {
                await permissionedWithdraw.connect(accounts[17]).repay(1, parseEther("100"));
            } catch (e) {
                expect(e.message || String(e)).to.not.include("AccessDenied");
            }
        });

        it("Should allow fundManager to call repay via sendToV2Reserve", async function() {
            try {
                await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("100"), 1);
            } catch (e) {
                expect(e.message || String(e)).to.not.include("AccessDenied");
            }
        });

        it("Should reject repay from a random account", async function() {
            await expect(permissionedWithdraw.connect(accounts[10]).repay(1, parseEther("100")))
                .to.be.revertedWithCustomError(permissionedWithdraw, "AccessDenied")
                .withArgs(accounts[10].address);
        });

        it("Should allow new PM to call repay after Pool.updatePoolManager", async function() {
            await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
            await permissionedPool.connect(accounts[0]).updatePoolManager(accounts[18].address);
            expect(await permissionedPool.poolManager()).to.equal(accounts[18].address);

            try {
                await permissionedWithdraw.connect(accounts[18]).repay(1, parseEther("100"));
            } catch (e) {
                expect(e.message || String(e)).to.not.include("AccessDenied");
            }
        });

        it("Should reject old PM from repay after rotation", async function() {
            await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
            await permissionedPool.connect(accounts[0]).updatePoolManager(accounts[18].address);

            await expect(permissionedWithdraw.connect(accounts[17]).repay(1, parseEther("100")))
                .to.be.revertedWithCustomError(permissionedWithdraw, "AccessDenied")
                .withArgs(accounts[17].address);
        });
    });

    describe("Implementation Initialization Lock", async function() {
        it("Should fail to re-initialize the WM implementation directly", async function() {
            const factory = await getContractFactory("CsigmaPermissionedWithdrawalManager");
            const impl = await factory.deploy();
            await expect(
                impl.initialize(await dummy.getAddress(), await permissionedPool.getAddress(), accounts[12].address)
            ).to.be.revertedWith("Initializable: contract is already initialized");
        });
    });
});