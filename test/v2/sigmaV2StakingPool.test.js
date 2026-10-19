const {expect} = require("chai");
const {
    ethers: {
        parseEther,
        getContractFactory
    }
} = require("hardhat");

const {
    time: {
        latest,
        increase,
        duration: {days},
    },
} = require("@nomicfoundation/hardhat-network-helpers");

describe("V2-Staking-Pool", async function() {
    let accounts, v2Pool, v2StakingPool, sigma, v2Factory, dummy, chainalysis, slice;
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

        let stakingPoolTx = await v2Factory.createStakingPool(
            await v2Pool.getAddress(), accounts[0]
        );

        stakingPoolTx = await stakingPoolTx.wait();
        stakingPoolAddress = stakingPoolTx.logs[3].args._stakingPool;
        v2StakingPool = await ethers.getContractAt("CsigmaV2StakingPool", stakingPoolAddress);

        for(let i = 0; i < 10; i++) {
            await dummy.mint(accounts[i].address, parseEther("5000"));
            await dummy.connect(accounts[i]).approve(await v2Pool.getAddress(), parseEther("5000"));
            await v2Pool.connect(accounts[i]).deposit(parseEther("5000"), accounts[i].address);
            await v2Pool.connect(accounts[i]).approve(await v2StakingPool.getAddress(), parseEther("5000"));
        }

        await sigma.mint(await v2StakingPool.getAddress(), parseEther("10000000"));
        slice = 30 * 24 * 60 * 60;
    });

    it("Should have initialized the staking pool correctly", async function() {
        expect(await v2StakingPool.stakingToken()).to.equal(await v2Pool.getAddress());
        expect(await v2StakingPool.rewardToken()).to.equal(await sigma.getAddress());
        expect(await v2StakingPool.hasRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.be.true;
    });

    describe("Access Control", async function() {
        it("Should update the reward rate", async function() {
            await expect(v2StakingPool.updateRewardRate(parseEther("1"))).to.emit(v2StakingPool, "RewardRateUpdated").withArgs(0, parseEther("1"));
            expect(await v2StakingPool.rewardRate()).to.equal(parseEther("1"));
        });

        it("Should fail to update the reward rate if not called by the admin", async function() {
            await expect(v2StakingPool.connect(accounts[1]).updateRewardRate(parseEther("10"))).to.be.reverted;
        });

        it("Should update the slice period", async function() {
            await expect(v2StakingPool.updateSlicePeriod(7 * 24 * 60 * 60)).to.emit(v2StakingPool, "SlicePeriodUpdated").withArgs(days(30), 7 * 24 * 60 * 60);
            expect(await v2StakingPool.slice()).to.equal(7 * 24 * 60 * 60);
        });

        it("Should fail to update the slice period if not called by the admin", async function() {
            await expect(v2StakingPool.connect(accounts[1]).updateSlicePeriod(7 * 24 * 60 * 60)).to.be.reverted;
        });

        it("Should update reward info", async function() {
            await v2StakingPool.updateRewardInfo(parseEther("10"), 30 * 24 * 60 * 60);
            expect(await v2StakingPool.slice()).to.equal(30 * 24 * 60 * 60);
            expect(await v2StakingPool.rewardRate()).to.equal(parseEther("10"));
        });

        it("Should fail to update reward info if not called by the admin", async function() {
            await expect(v2StakingPool.connect(accounts[1]).updateRewardInfo(parseEther("10"), 30 * 24 * 60 * 60)).to.be.reverted;
        });

        it("Should emergency withdraw", async function() {
            await v2StakingPool.connect(accounts[0]).emergencyWithdraw(await sigma.getAddress(), accounts[0].address, parseEther("0.1"));
            expect(await sigma.balanceOf(await v2StakingPool.getAddress())).to.equal(parseEther("9999999.9"));
            expect(await sigma.balanceOf(accounts[0].address)).to.equal(parseEther("0.1"));
        });

        it("Should fail to emergency withdraw if not called by the admin", async function() {
            await expect(v2StakingPool.connect(accounts[1]).emergencyWithdraw(await sigma.getAddress(), accounts[0].address, parseEther("0.1"))).to.be.reverted;
        });

        it("Should update min-max stake allowed", async function() {
            await expect(v2StakingPool.updateMinMaxDurationAllowed(days(20), days(70))).to.emit(v2StakingPool, "MinMaxStakeDurationUpdated").withArgs(days(30), days(180), days(20), days(70));
            expect(await v2StakingPool.minStakeDurationAllowed()).to.equal(days(20));
            expect(await v2StakingPool.maxStakeDurationAllowed()).to.equal(days(70));
        });

        it("Should fail to update min-max stake allowed if not called by the admin", async function() {
            await expect(v2StakingPool.connect(accounts[1]).updateMinMaxDurationAllowed(days(30), days(200))).to.be.reverted;
        });

        it("Should update pool status", async function() {
            await expect(v2StakingPool.updatePoolStatus(1)).to.emit(v2StakingPool, "PoolStatusUpdated").withArgs(0, 1);
            expect(await v2StakingPool.status()).to.equal(1);
        });

        it("Should fail to update pool status if not called by the admin", async function() {
            await expect(v2StakingPool.connect(accounts[1]).updatePoolStatus(1)).to.be.reverted;
        });
    });

    describe("Grant Roles", async function() {
        it("Should grant roles", async function() {
            await expect(v2StakingPool.grantRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v2StakingPool, "RoleGranted").withArgs(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19].address, accounts[0].address);
            expect(await v2StakingPool.hasRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.true;
        });

        it("Should fail to grant roles if not admin", async function() {
            await expect(v2StakingPool.connect(accounts[8]).grantRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.reverted;
        });

        it("Should revoke roles", async function() {
            await expect(v2StakingPool.revokeRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v2StakingPool, "RoleRevoked").withArgs(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19].address, accounts[0].address);
            expect(await v2StakingPool.hasRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.false;
        });

        it("Should fail to revoke roles if not admin", async function() {
            await expect(v2StakingPool.connect(accounts[8]).revokeRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.reverted;
        });            

        it("Should transfer admin", async function() {
            await expect(v2StakingPool.transferAdmin(accounts[7].address)).to.emit(v2StakingPool, "AdminTransferred").withArgs(accounts[0].address, accounts[7].address);
            expect(await v2StakingPool.hasRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.be.false;
            expect(await v2StakingPool.hasRole(await v2StakingPool.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.be.true;
        });
    });

    describe("Staking", async function() {
        before(async function() {
            await v2StakingPool.connect(accounts[7]).updateMinMaxDurationAllowed(days(30), days(365));
        });

        it("Should stake", async function() {
            await expect(v2StakingPool.connect(accounts[0]).stake(parseEther("1000"), 2 * slice)).to.emit(v2StakingPool, "Staked").withArgs(accounts[0].address, parseEther("1000"), parseEther("1000"), (parseEther("1000") * await v2StakingPool.rewardRate() * 2n) / parseEther("1"), 2 * slice);
            expect(await v2Pool.balanceOf(accounts[0].address)).to.equal(parseEther("4000"));
            expect(await v2Pool.balanceOf(await v2StakingPool.getAddress())).to.equal(parseEther("1000"));
            timestamp = BigInt(await latest()) + BigInt(2 * slice);
            expect(await v2StakingPool.payableRewards(timestamp/86400n)).to.equal((2n * parseEther("1000") * await v2StakingPool.rewardRate()) / parseEther("1"));       
        });

        it("Multi-user stake", async function() {
            await v2StakingPool.connect(accounts[2]).stake(parseEther("1000"), 3 * slice);
            timestamp = BigInt(await latest()) + BigInt(3 * slice);
            expect(await v2StakingPool.payableRewards(timestamp/86400n)).to.equal((3n * parseEther("1000") * await v2StakingPool.rewardRate()) / parseEther("1"));
            await v2StakingPool.connect(accounts[3]).stake(parseEther("1000"), 4 * slice);
            timestamp = BigInt(await latest()) + BigInt(4 * slice);
            expect(await v2StakingPool.payableRewards(timestamp/86400n)).to.equal((4n * parseEther("1000") * await v2StakingPool.rewardRate()) / parseEther("1"));
            await v2StakingPool.connect(accounts[4]).stake(parseEther("1000"), 6 * slice);
            await v2StakingPool.connect(accounts[5]).stake(parseEther("1000"), 6 * slice);
            timestamp = BigInt(await latest()) + BigInt(6 * slice);
            expect(await v2StakingPool.payableRewards(timestamp/86400n)).to.equal((12n * parseEther("1000") * await v2StakingPool.rewardRate()) / parseEther("1"));
            await v2StakingPool.connect(accounts[6]).stake(parseEther("1000"), 8 * slice);
            await v2StakingPool.connect(accounts[7]).stake(parseEther("1000"), 8 * slice);
            timestamp = BigInt(await latest()) + BigInt(8 * slice);
            expect(await v2StakingPool.payableRewards(timestamp/86400n)).to.equal((16n * parseEther("1000") * await v2StakingPool.rewardRate()) / parseEther("1"));
            await v2StakingPool.connect(accounts[8]).stake(parseEther("1000"), 10 * slice);
            await v2StakingPool.connect(accounts[9]).stake(parseEther("1000"), 10 * slice);
            timestamp = BigInt(await latest()) + BigInt(10 * slice);
            expect(await v2StakingPool.payableRewards(timestamp/86400n)).to.equal((20n * parseEther("1000") * await v2StakingPool.rewardRate()) / parseEther("1"));
            expect(await v2Pool.balanceOf(await v2StakingPool.getAddress())).to.equal(parseEther("9000"));
        });

        it("Should fail if stake duration is less than minimum allowed", async function() {
            await expect(v2StakingPool.connect(accounts[0]).stake(parseEther("100"), days(29))).to.be.revertedWithCustomError(v2StakingPool, "InvalidInputs").withArgs(parseEther("100"), days(29));
        });

        it("Should fail if stake duration is greater than maximum allowed", async function() {
            await expect(v2StakingPool.connect(accounts[0]).stake(parseEther("200"), 30 * slice)).to.be.revertedWithCustomError(v2StakingPool, "InvalidInputs").withArgs(parseEther("200"), 30 * slice);
        });

        it("Should fail if lock period is not a multiple of slice", async function() {
            await expect(v2StakingPool.connect(accounts[0]).stake(parseEther("1000"), 1.5 * slice)).to.be.revertedWithCustomError(v2StakingPool, "InvalidInputs").withArgs(parseEther("1000"), 1.5 * slice);
        });

        it("Should fail if user has already staked", async function() {
            await expect(v2StakingPool.connect(accounts[0]).stake(parseEther("1000"), slice)).to.be.revertedWithCustomError(v2StakingPool, "AlreadyStaked").withArgs(accounts[0].address);
        });

        it("Should fail to stake if the user has insufficient balance", async function() {
            await expect(v2StakingPool.connect(accounts[14]).stake(parseEther("10000"), slice)).to.be.reverted;
        });

        it("Should fail to stake if the pool is not active", async function() {
            await v2StakingPool.connect(accounts[7]).updatePoolStatus(0);
            await expect(v2StakingPool.connect(accounts[3]).stake(parseEther("1000"), slice)).to.be.revertedWithCustomError(v2StakingPool, "PoolIsNotActive");
        });

        it("Should fail to unstake if lock duration not completed", async function() {
            await v2StakingPool.connect(accounts[7]).updatePoolStatus(1);
            await expect(v2StakingPool.connect(accounts[0]).unStake()).to.be.revertedWithCustomError(v2StakingPool, "NotUnlocked").withArgs(accounts[0].address);
        });

        it("Should unstake", async function() {
            await increase(3 * slice);
            await expect(v2StakingPool.connect(accounts[0]).unStake()).to.emit(v2StakingPool, "Unstaked").withArgs(accounts[0].address, parseEther("1000"), parseEther("20000"));
            expect(await v2Pool.balanceOf(accounts[0].address)).to.equal(parseEther("5000"));
            expect(await v2Pool.balanceOf(await v2StakingPool.getAddress())).to.equal(parseEther("8000"));
        });

        it("Should fail to unstake if the user has insufficient balance", async function() {
            await expect(v2StakingPool.connect(accounts[0]).unStake()).to.be.reverted;
        });

        it("Should fail to unstake if the pool is not active", async function() {
            await v2StakingPool.connect(accounts[7]).updatePoolStatus(0);
            await expect(v2StakingPool.connect(accounts[3]).unStake()).to.be.reverted;
        });
    });
});