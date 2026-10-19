const {expect} = require("chai");
const {
    ethers: {
        parseEther,
        getContractFactory
    }
} = require("hardhat");

const {
    time: {
        increase,
        duration: {days},
    },
} = require("@nomicfoundation/hardhat-network-helpers");

describe("V2-Fund Manager", async function() {
    let accounts, v2Pool, v2FundManager, v2Factory, dummy, chainalysis;
    before(async function() {
        accounts = await ethers.getSigners();
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await dummyFactory.deploy();
        sigma = await dummyFactory.deploy();

        let v2PoolFactory = await getContractFactory("CsigmaV2Pool");
        poolImplementation = await (await v2PoolFactory.deploy()).getAddress();
        
        let v2StakingPoolFactory = await getContractFactory("CsigmaV2StakingPool");
        stakingPoolImplementation = await (await v2StakingPoolFactory.deploy()).getAddress();
        
        let v2FundManagerFactory = await getContractFactory("CsigmaV2FundManager");
        fundManagerImplementation = await (await v2FundManagerFactory.deploy()).getAddress();

        let v1DiamondFactory = await getContractFactory("MockV1");
        diamondV1 = await v1DiamondFactory.deploy();

        let chainAnalysisFactory = await getContractFactory("MockChainAnalysis");
        chainalysis = await chainAnalysisFactory.deploy();

        let withdrawFactory = await getContractFactory("MockWithdrawManager");
        withdrawManager = await withdrawFactory.deploy();
        
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

        await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
        await v2Pool.setWithdrawalManager(await withdrawManager.getAddress());
        
        fundManagerAddress = await poolTx.logs[9].args._fundManager;
        v2FundManager = await ethers.getContractAt("CsigmaV2FundManager", fundManagerAddress);

        for (let i = 0; i < 19; i++) {
            await dummy.mint(accounts[i].address, parseEther("10000"));
            await dummy.connect(accounts[i]).approve(v2Pool.getAddress(), parseEther("10000"));
        }
    });

    it("Should have initialized the fund manager correctly", async function() {
        expect(await v2FundManager.poolToken()).to.be.equal(await dummy.getAddress());
        expect(await v2FundManager.factory()).to.be.equal(await v2Factory.getAddress());
        expect(await v2FundManager.diamondV1()).to.be.equal(await diamondV1.getAddress());
        expect(await v2FundManager.fundManagerLenderId()).to.be.equal("Lender1");
        expect(await v2FundManager.hasRole(await v2FundManager.DEFAULT_ADMIN_ROLE(), await v2Factory.getAddress())).to.be.true;
        expect(await v2FundManager.totalV1Pools()).to.be.equal(0);
        expect(await v2FundManager.pool()).to.be.equal(await v2Pool.getAddress());
    });

    describe("Access Control Tests", async function() {
        it("Should grant roles", async function() {
            await expect(v2Factory.grantRoleTarget(await v2FundManager.getAddress(), await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v2FundManager, "RoleGranted").withArgs(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, await v2Factory.getAddress());
            expect(await v2FundManager.hasRole(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.true;
        });

        it("Should fail to grant roles if not admin", async function() {
            await expect(v2FundManager.connect(accounts[8]).grantRole(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.reverted;
        });

        it("Should revoke roles", async function() {
            await expect(v2Factory.revokeRoleTarget(await v2FundManager.getAddress(), await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v2FundManager, "RoleRevoked").withArgs(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, await v2Factory.getAddress());
            expect(await v2FundManager.hasRole(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.false;
        });

        it("Should fail to revoke roles if not admin", async function() {
            await expect(v2FundManager.connect(accounts[8]).revokeRole(await v2FundManager.DEFAULT_ADMIN_ROLE(), await v2Factory.getAddress())).to.be.reverted;
        });            

        it("Should transfer admin", async function() {
            await expect(v2Factory.grantRoleTarget(await v2FundManager.getAddress(), await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v2FundManager, "RoleGranted").withArgs(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, await v2Factory.getAddress());
            await expect(v2FundManager.connect(accounts[19]).transferAdmin(accounts[7].address)).to.emit(v2FundManager, "AdminTransferred").withArgs(accounts[19].address, accounts[7].address);
            expect(await v2FundManager.hasRole(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.be.false;
            expect(await v2FundManager.hasRole(await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.be.true;
        });

        it("Should fail to transfer admin if not admin", async function() {
            await expect(v2FundManager.connect(accounts[8]).transferAdmin(accounts[7].address)).to.be.reverted;
        });

        it("Should emergency withdraw", async function() {
            await dummy.mint(await v2FundManager.getAddress(), parseEther("100"));
            await expect(v2FundManager.connect(accounts[7]).emergencyWithdraw(dummy, accounts[10].address, parseEther("100"))).to.emit(v2FundManager, "EmergencyWithdraw").withArgs(await dummy.getAddress(), accounts[10].address, parseEther("100"));
        });

        it("Should fail to emergency withdraw if not admin", async function() {
            await expect(v2FundManager.connect(accounts[8]).emergencyWithdraw(dummy, accounts[10].address, parseEther("100"))).to.be.reverted;
        });
    });

    describe("Add/Remove/Update V1 Pools Tests", async function() {
        
        it("Should fail to add pool if not pool manager", async function() {
            await expect(v2FundManager.connect(accounts[18]).addPool("cPool 1", 10000)).to.be.revertedWithCustomError(v2FundManager, "AccessDenied").withArgs(accounts[18].address);
        });
        
        it("Should fail to add pool if pool is not active", async function() {
            await expect(v2FundManager.connect(accounts[17]).addPool("cPool 2", 10000)).to.be.revertedWithCustomError(v2FundManager, "V1PoolIsNotActive").withArgs("cPool 2");
        });
        
        it("Should fail to add pool if pool has different pool token", async function() {
            await diamondV1.setPoolStatus("cPool 1", 1);
            await expect(v2FundManager.connect(accounts[17]).addPool("cPool 1", 10000)).to.be.revertedWithCustomError(v2FundManager, "InvalidV1Pool").withArgs("cPool 1");
        });
        
        it("Should add pool", async function() {
            await diamondV1.setPoolToken(await dummy.getAddress());
            await expect(v2FundManager.connect(accounts[17]).addPool("cPool 1", 10000)).to.emit(v2FundManager, "V1PoolAdded").withArgs(accounts[17].address, 10000, "cPool 1");
        });

        it("Should fail to add pool if pool already exists", async function() {
            await expect(v2FundManager.connect(accounts[17]).addPool("cPool 1", 10000)).to.be.revertedWithCustomError(v2FundManager, "DuplicatePool").withArgs("cPool 1");
        });

        it("Should remove pool", async function() {
            await expect(v2FundManager.connect(accounts[17]).removePool(0)).to.emit(v2FundManager, "V1PoolRemoved").withArgs(accounts[17].address, 10000, "cPool 1");
            expect(await v2FundManager.totalV1Pools()).to.be.equal(0);
            expect(await v2FundManager.totalAllocation()).to.be.equal(0);
        });

        it("Should fail to remove pool if not pool manager", async function() {
            await expect(v2FundManager.connect(accounts[18]).removePool(0)).to.be.revertedWithCustomError(v2FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should update allocation", async function() {
            await diamondV1.setPoolStatus("cPool 1", 1);
            await v2FundManager.connect(accounts[17]).addPool("cPool 1", 10000);
            await expect(v2FundManager.connect(accounts[17]).updatePoolAllocation(0, 5000)).to.emit(v2FundManager, "V1PoolAllocationUpdated").withArgs(accounts[17].address, 10000, 5000, "cPool 1");
            expect(await v2FundManager.totalAllocation()).to.be.equal(5000);
        });

        it("Should fail to update allocation if not pool manager", async function() {
            await expect(v2FundManager.connect(accounts[18]).updatePoolAllocation(0, 5000)).to.be.revertedWithCustomError(v2FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should fail to update allocation if total exceeds 100%", async function() {
            await expect(v2FundManager.connect(accounts[17]).updatePoolAllocation(0, 20000)).to.be.revertedWithCustomError(v2FundManager, "InvalidAllocation").withArgs(20000);
        });
    });

    describe("Manage Funds Tests", async function() {
        before(async function() {
            await v2FundManager.connect(accounts[17]).updatePoolAllocation(0, 10000);
            await diamondV1.setPoolStatus("cPool 2", 1);
            await diamondV1.setPoolStatus("cPool 3", 1);
            await diamondV1.setPoolStatus("cPool 4", 1);
            await v2Pool.deposit(parseEther("100"), accounts[0]);
        });

        it("Should deploy funds in a single pool", async function() {
            await expect(v2FundManager.connect(accounts[17]).deployFunds()).to.emit(v2FundManager, "FundDeployed").withArgs(accounts[17].address, parseEther("95"));
            expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.be.equal(parseEther("0"));
        });

        it("Should deploy funds to multiple pool", async function() {
            await v2FundManager.connect(accounts[17]).updatePoolAllocation(0, 5000);
            await v2FundManager.connect(accounts[17]).addPool("cPool 2", 1000);
            await v2FundManager.connect(accounts[17]).addPool("cPool 3", 1000);
            await v2FundManager.connect(accounts[17]).addPool("cPool 4", 3000);
            await v2Pool.connect(accounts[7]).deposit(parseEther("200"), accounts[7].address);
            await expect(v2FundManager.connect(accounts[17]).deployFunds()).to.emit(v2FundManager, "FundDeployed").withArgs(accounts[17].address, parseEther("190"));
            expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.be.equal(parseEther("0"));
        });

        it("Should fail to deploy funds if not pool manager", async function() {
            await expect(v2FundManager.connect(accounts[18]).deployFunds()).to.be.revertedWithCustomError(v2FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should fail if total allocation is not 100%", async function() {
            await v2FundManager.connect(accounts[17]).updatePoolAllocation(1, 100);
            await expect(v2FundManager.connect(accounts[17]).deployFunds()).to.be.revertedWithCustomError(v2FundManager, "InvalidAllocation").withArgs(9100);
        });

        it("Should claim funds", async function() {
            paymentInfo = {
                amount: parseEther("100"),
                paymentType: 0,
            }
            request = {
                nonce: 1,
                roleId: "Lender1",
                poolId: "cPool 1",
                paymentInfo: [paymentInfo],
            }
            claimRequest = {
                request: request,
                sigR: ethers.encodeBytes32String(""),
                sigS: ethers.encodeBytes32String(""),
                sigV: 0,
            }
            await expect(v2FundManager.connect(accounts[17]).claimFunds([claimRequest,claimRequest,claimRequest,claimRequest])).to.emit(v2FundManager, "FundClaimed").withArgs(accounts[17].address, parseEther("285"));
        });

        it("Should fail to claim funds if not pool manager", async function() {
            await expect(v2FundManager.connect(accounts[18]).claimFunds([claimRequest,claimRequest,claimRequest,claimRequest])).to.be.revertedWithCustomError(v2FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should fail to send to v2 Reserve if not pool manager", async function() {
            await expect(v2FundManager.connect(accounts[18]).sendToV2Reserve(parseEther("100"), 1)).to.be.revertedWithCustomError(v2FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should send to v2 Reserve", async function() {
            await dummy.mint(await v2FundManager.getAddress(), parseEther("100"));
            balanceBefore = await dummy.balanceOf(await v2FundManager.getAddress());
            balanceBeforePool = await dummy.balanceOf(await v2Pool.getAddress());
            await v2FundManager.connect(accounts[17]).sendToV2Reserve(parseEther("100"), 1);
            expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.be.equal(balanceBefore - parseEther("100"));
            expect(await dummy.balanceOf(await v2Pool.getAddress())).to.be.equal(balanceBeforePool + parseEther("100"));
        });
    });

    describe("Pausability Tests", async function() {
        before(async function() {
            await v2Factory.grantRoleTarget(await v2FundManager.getAddress(), await v2FundManager.DEFAULT_ADMIN_ROLE(), accounts[0].address);
        });
        it("Should pause contract", async function() {
            await expect(v2FundManager.connect(accounts[0]).pause()).to.emit(v2FundManager, "Paused").withArgs(accounts[0].address);
            expect(await v2FundManager.paused()).to.be.true;
        });

        it("Should fail to execute functions if contract is paused", async function() {
            await expect(v2FundManager.connect(accounts[17]).deployFunds()).to.be.revertedWith("Pausable: paused");
            await expect(v2FundManager.connect(accounts[17]).claimFunds([claimRequest,claimRequest,claimRequest,claimRequest])).to.be.revertedWith("Pausable: paused");
            await expect(v2FundManager.connect(accounts[17]).addPool("cPool 1", 10000)).to.be.revertedWith("Pausable: paused");
            await expect(v2FundManager.connect(accounts[17]).removePool(0)).to.be.revertedWith("Pausable: paused");
            await expect(v2FundManager.connect(accounts[17]).updatePoolAllocation(0, 5000)).to.be.revertedWith("Pausable: paused");
        });

        it("Should fail to pause contract if not admin", async function() {
            await expect(v2FundManager.connect(accounts[8]).pause()).to.be.reverted;
        });

        it("Should unpause contract", async function() {
            await expect(v2FundManager.connect(accounts[0]).unpause()).to.emit(v2FundManager, "Unpaused").withArgs(accounts[0].address);
            expect(await v2FundManager.paused()).to.be.false;
        });

        it("Should fail to unpause contract if not admin", async function() {
            await expect(v2FundManager.connect(accounts[8]).unpause()).to.be.reverted;
        });
    });
});