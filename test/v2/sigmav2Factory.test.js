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

describe("V2-Factory", async function() {
    let accounts, v2Factory, poolImplementation, stakingPoolImplementation, fundManagerImplementation, sigmaToken, diamondV1, chainalysis, dummy;
    let v2FundManager, v2StakingPool, v2Pool, timelock;
    before(async function() {
        accounts = await ethers.getSigners();
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await (await dummyFactory.deploy()).getAddress();

        let v2PoolFactory = await getContractFactory("CsigmaV2Pool");
        poolImplementation = await (await v2PoolFactory.deploy()).getAddress();
        
        let v2StakingPoolFactory = await getContractFactory("CsigmaV2StakingPool");
        stakingPoolImplementation = await (await v2StakingPoolFactory.deploy()).getAddress();
        
        let v2FundManagerFactory = await getContractFactory("CsigmaV2FundManager");
        fundManagerImplementation = await (await v2FundManagerFactory.deploy()).getAddress();

        let v1DiamondFactory = await getContractFactory("MockV1");
        diamondV1 = await (await v1DiamondFactory.deploy()).getAddress();

        timelockFactory = await getContractFactory("CsigmaTimelock");
        timelock = await timelockFactory.deploy();
        await timelock.initialize(
            accounts[0].address, // super multi-sig admin (5/8)
            86400, // 1 day minimum delay
            [accounts[0].address, accounts[1].address], // proposer + canceller
            [accounts[0].address, accounts[1].address] // executor
        );
        
        v2FactoryFactory = await getContractFactory("CsigmaV2Factory");
        v2Factory = await v2FactoryFactory.deploy();
        let proxyFactory = await getContractFactory("ERC1967Proxy");
        let proxy = await proxyFactory.deploy(await v2Factory.getAddress(), "0x");
        v2Factory = await ethers.getContractAt("CsigmaV2Factory", await proxy.getAddress());

        v2PoolFactory = await getContractFactory("CsigmaV2Pool");
        v2StakingPoolFactory = await getContractFactory("CsigmaV2StakingPool");
        v2FundManagerFactory = await getContractFactory("CsigmaV2FundManager");
        v2Pool = await v2PoolFactory.deploy();
        v2StakingPool = await v2StakingPoolFactory.deploy();
        v2FundManager = await v2FundManagerFactory.deploy();
        
        await v2Factory.initialize(
            accounts[0].address, // default admin
            await v2FundManager.getAddress(), // fundManagerImplementation
            await v2StakingPool.getAddress(), // stakingPoolImplementation
            await v2Pool.getAddress(), // poolImplementation
            diamondV1, // diamondv1
            accounts[5].address, // sigmaToken
            accounts[6].address  // chainalysis
        );

        sigmaToken = accounts[5].address;
        chainalysis = accounts[6].address;
        await v2Factory.grantRole(await v2Factory.ROLE_MANAGER(), accounts[0].address);
        await v2Factory.transferAdmin(await timelock.getAddress());
    });

    it("Should initialize the factory", async function() {
        expect(await v2Factory.hasRole(await v2Factory.DEFAULT_ADMIN_ROLE(), await timelock.getAddress())).to.be.true;
        expect(await v2Factory.fundManagerImplementation()).to.equal(await v2FundManager.getAddress());
        expect(await v2Factory.stakingPoolImplementation()).to.equal(await v2StakingPool.getAddress());
        expect(await v2Factory.poolImplementation()).to.equal(await v2Pool.getAddress());
        expect(await v2Factory.diamondV1()).to.equal(diamondV1);
        expect(await v2Factory.sigmaToken()).to.equal(accounts[5].address);
        expect(await v2Factory.chainalysis()).to.equal(accounts[6].address);
        expect(await v2Factory.totalPools()).to.equal(0);
    });

    it("Should update pool implementation", async function() {
        let oldPoolImplementation = await v2Factory.poolImplementation();
        await expect(v2Factory.updatePoolImplementation(poolImplementation)).to.emit(v2Factory, "PoolImplementationUpdated").withArgs(oldPoolImplementation, poolImplementation);
        expect(await v2Factory.poolImplementation()).to.equal(poolImplementation);
    });

    it("Should fail to update pool implementation if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).updatePoolImplementation(poolImplementation)).to.be.reverted;
    });

    it("Should fail to update pool implementation if zero address", async function() {
        await expect(v2Factory.updatePoolImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should update fund manager implementation", async function() {
        let oldFundManagerImplementation = await v2Factory.fundManagerImplementation();
        await expect(v2Factory.updateFundManagerImplementation(fundManagerImplementation)).to.emit(v2Factory, "FundManagerImplementationUpdated").withArgs(oldFundManagerImplementation, fundManagerImplementation);
        expect(await v2Factory.fundManagerImplementation()).to.equal(fundManagerImplementation);
    });

    it("Should fail to update fund manager implementation if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).updateFundManagerImplementation(fundManagerImplementation)).to.be.reverted;
    });

    it("Should fail to update fund manager implementation if zero address", async function() {
        await expect(v2Factory.updateFundManagerImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should update staking pool implementation", async function() {
        let oldStakingPoolImplementation = await v2Factory.stakingPoolImplementation();
        await expect(v2Factory.updateStakingPoolImplementation(stakingPoolImplementation)).to.emit(v2Factory, "StakingPoolImplementationUpdated").withArgs(oldStakingPoolImplementation, stakingPoolImplementation);
        expect(await v2Factory.stakingPoolImplementation()).to.equal(stakingPoolImplementation);
    });

    it("Should fail to update staking pool implementation if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).updateStakingPoolImplementation(stakingPoolImplementation)).to.be.reverted;
    });

    it("Should fail to update staking pool implementation if zero address", async function() {
        await expect(v2Factory.updateStakingPoolImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should update chainalysis", async function() {
        let newChainalysis = accounts[10].address;
        let oldChainalysis = await v2Factory.chainalysis();
        await expect(v2Factory.updateChainalysisAddress(newChainalysis)).to.emit(v2Factory, "ChainalysisAddressUpdated").withArgs(oldChainalysis, newChainalysis);
        expect(await v2Factory.chainalysis()).to.equal(newChainalysis);
    });

    it("Should fail to update chainalysis if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).updateChainalysisAddress(accounts[10].address)).to.be.reverted;
    });

    it("Should fail to update chainalysis if zero address", async function() {
        await expect(v2Factory.updateChainalysisAddress(ethers.ZeroAddress)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should add pool manager", async function() {
        await expect(v2Factory.addPoolManager(accounts[7].address)).to.emit(v2Factory, "PoolManagerAdded").withArgs(accounts[7].address);
        expect(await v2Factory.isPoolManager(accounts[7].address)).to.be.true;
    });

    it("Should fail to add pool manager if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).addPoolManager(accounts[8].address)).to.be.reverted;
    });

    it("Should fail to add pool manager if zero address", async function() {
        await expect(v2Factory.addPoolManager(ethers.ZeroAddress)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should fail to add pool manager if already added", async function() {
        await expect(v2Factory.addPoolManager(accounts[7].address)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(accounts[7].address);
    });

    it("Should remove pool manager", async function() {
        await expect(v2Factory.removePoolManager(accounts[7].address)).to.emit(v2Factory, "PoolManagerRemoved").withArgs(accounts[7].address);
        expect(await v2Factory.isPoolManager(accounts[7].address)).to.be.false;
    });

    it("Should fail to remove pool manager if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).removePoolManager(accounts[8].address)).to.be.reverted;
    });

    it("Should fail to remove pool manager if not added", async function() {
        await expect(v2Factory.removePoolManager(accounts[7].address)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(accounts[7].address);
    });

    it("Should add token to whitelist", async function() {
        await expect(v2Factory.addTokenToWhitelist(accounts[8].address)).to.emit(v2Factory, "PoolTokenAdded").withArgs(accounts[8].address);
        expect(await v2Factory.isWhitelistedToken(accounts[8].address)).to.be.true;
    });

    it("Should fail to add token to whitelist if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).addTokenToWhitelist(accounts[9].address)).to.be.reverted;
    });

    it("Should fail to add token to whitelist if zero address", async function() {
        await expect(v2Factory.addTokenToWhitelist(ethers.ZeroAddress)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should fail to add token to whitelist if already added", async function() {
        await expect(v2Factory.addTokenToWhitelist(accounts[8].address)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(accounts[8].address);
    });

    it("Should remove token from whitelist", async function() {
        await expect(v2Factory.removeTokenFromWhitelist(accounts[8].address)).to.emit(v2Factory, "PoolTokenRemoved").withArgs(accounts[8].address);
        expect(await v2Factory.isWhitelistedToken(accounts[8].address)).to.be.false;
    });

    it("Should fail to remove token from whitelist if not admin", async function() {
        await expect(v2Factory.connect(accounts[1]).removeTokenFromWhitelist(accounts[9].address)).to.be.reverted;
    });

    it("Should fail to remove token from whitelist if not added", async function() {
        await expect(v2Factory.removeTokenFromWhitelist(accounts[8].address)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(accounts[8].address);
    });

    describe("Create a pool", async function() {
        let pool, fundManager;
        before(async function() {
            await v2Factory.addPoolManager(accounts[7].address);
            await v2Factory.addTokenToWhitelist(dummy);
        });

        it("Should create a pool", async function() {
            let poolTx = await v2Factory.createPool(
                "Test Pool",
                "TP",
                "Lender1",
                accounts[7].address,
                dummy,
                accounts[9].address,
                14,
                parseEther("10000")
            );

            poolTx = await poolTx.wait();
            poolAddress = poolTx.logs[9].args._pool;
            poolManager = poolTx.logs[9].args._poolManager;
            fundManagerAddress = poolTx.logs[9].args._fundManager;
            poolToken = poolTx.logs[9].args._poolToken;
            oracleManager = poolTx.logs[9].args._oracleManager;
            poolAPY = poolTx.logs[9].args._poolAPY;
            poolSize = poolTx.logs[9].args._poolSize;

            expect(poolManager).to.equal(accounts[7].address);
            expect(oracleManager).to.equal(accounts[9].address);
            expect(poolToken).to.equal(dummy);
            expect(poolAPY).to.equal(14);
            expect(poolSize).to.equal(parseEther("10000"));

            pool = await ethers.getContractAt("CsigmaV2Pool", poolAddress);
            expect(await pool.name()).to.equal("cTest Pool");
            expect(await pool.symbol()).to.equal("cTP");
            expect(await pool.factory()).to.equal(await v2Factory.getAddress());
            expect(await pool.poolManager()).to.equal(accounts[7].address);
            expect(await pool.fundManager()).to.equal(fundManagerAddress);
            expect(await pool.projectedAPY()).to.equal(14);
            expect(await pool.poolSize()).to.equal(parseEther("10000"));

            fundManager = await ethers.getContractAt("CsigmaV2FundManager", fundManagerAddress);
            expect(await fundManager.factory()).to.equal(await v2Factory.getAddress());
            expect(await fundManager.poolToken()).to.equal(dummy);
            expect(await fundManager.diamondV1()).to.equal(diamondV1);
            expect(await fundManager.fundManagerLenderId()).to.equal("Lender1");
        });

        it("Should fail to create a pool if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).createPool(
                "Test Pool",
                "TP",
                "Lender1",
                accounts[7].address,
                dummy,
                accounts[9].address,
                14,
                parseEther("10000")
            )).to.be.reverted;
        });

        it("Should fail to create a pool if pool manager not added", async function() {
            await expect(v2Factory.createPool(
                "Test Pool",
                "TP",
                "Lender1",
                accounts[8].address,
                dummy,
                accounts[9].address,
                14,
                parseEther("10000")
            )).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(accounts[8].address);
        });

        it("Should fail to create a pool if token not whitelisted", async function() {
            await expect(v2Factory.createPool(
                "Test Pool",
                "TP",
                "Lender1",
                accounts[7].address,
                accounts[8].address,
                accounts[9].address,
                14,
                parseEther("10000")
            )).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(accounts[8].address);
        });

        it("Should fail to create a pool if pool name is used", async function() {
            await expect(v2Factory.createPool(
                "Test Pool",
                "TP",
                "Lender1",
                accounts[7].address,
                dummy,
                accounts[9].address,
                14,
                0
            )).to.be.revertedWithCustomError(v2Factory, "InvalidPoolName").withArgs("Test Pool");
        });

        describe("Create staking pool", async function() {
            it("Should create a staking pool", async function() {
                let stakingPoolTx = await v2Factory.createStakingPool(
                    await pool.getAddress(), accounts[0]
                );

                stakingPoolTx = await stakingPoolTx.wait();
                poolTokenAddress = stakingPoolTx.logs[3].args._pool;
                stakingPoolAddress = stakingPoolTx.logs[3].args._stakingPool;

                expect(poolTokenAddress).to.equal(await pool.getAddress());

                stakingPool = await ethers.getContractAt("CsigmaV2StakingPool", stakingPoolAddress);

                expect(await stakingPool.stakingToken()).to.equal(await pool.getAddress());
                expect(await stakingPool.rewardToken()).to.equal(sigmaToken);
                expect(await stakingPool.factory()).to.equal(await v2Factory.getAddress());
                expect(await stakingPool.hasRole(await stakingPool.DEFAULT_ADMIN_ROLE(), accounts[0])).to.be.true;
            });

            it("Should fail to create a staking pool if not admin", async function() {
                await expect(v2Factory.connect(accounts[8]).createStakingPool(await pool.getAddress(), accounts[0])).to.be.reverted;
            });

            it("Should fail to create a staking pool already exists for the pool", async function() {
                await expect(v2Factory.createStakingPool(await pool.getAddress(), accounts[0])).to.be.revertedWithCustomError(v2Factory, "StakingPoolExist").withArgs(await pool.getAddress());
            });
        });

        describe("Roles on target", async function() {
            it("Should Grant Roles on target", async function() {
                await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("grantRoleTarget", [await pool.getAddress(), await pool.ROLE_ORACLE_MANAGER(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("grantRoleTarget", [await pool.getAddress(), await pool.ROLE_ORACLE_MANAGER(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(pool, "RoleGranted").withArgs(await pool.ROLE_ORACLE_MANAGER(), accounts[19].address, await v2Factory.getAddress());
                await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("grantRoleTarget", [await pool.getAddress(), await pool.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("grantRoleTarget", [await pool.getAddress(), await pool.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(pool, "RoleGranted").withArgs(await pool.DEFAULT_ADMIN_ROLE(), accounts[19].address, await v2Factory.getAddress());
                expect(await pool.isOracleManager(accounts[19])).to.be.true;
            });

            it("Should fail to grant roles on target if not admin", async function() {
                await expect(v2Factory.connect(accounts[8]).grantRoleTarget(await pool.getAddress(), await pool.ROLE_ORACLE_MANAGER(), accounts[19].address)).to.be.reverted;
            });

            it("Should revoke roles on target", async function() {
                await expect(v2Factory.revokeRoleTarget(await pool.getAddress(), await pool.ROLE_ORACLE_MANAGER(), accounts[19].address)).to.emit(pool, "RoleRevoked").withArgs(await pool.ROLE_ORACLE_MANAGER(), accounts[19].address, await v2Factory.getAddress());
                await expect(v2Factory.revokeRoleTarget(await pool.getAddress(), await pool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(pool, "RoleRevoked").withArgs(await pool.DEFAULT_ADMIN_ROLE(), accounts[19].address, await v2Factory.getAddress());
                expect(await pool.isOracleManager(accounts[19])).to.be.false;
            });

            it("Should fail to revoke roles on target if not admin", async function() {
                await expect(v2Factory.connect(accounts[8]).revokeRoleTarget(await pool.getAddress(), await pool.ROLE_ORACLE_MANAGER(), accounts[19].address)).to.be.reverted;
            });
        });

        describe("Pause/Unpause target", async function() {
            it("Should pause target", async function() {
                await expect(v2Factory.pauseTarget(await pool.getAddress())).to.emit(pool, "Paused").withArgs(await v2Factory.getAddress());
                expect(await pool.paused()).to.be.true;
            });

            it("Should fail to pause target if not admin", async function() {
                await expect(v2Factory.connect(accounts[8]).pauseTarget(await pool.getAddress())).to.be.reverted;
            });

            it("Should unpause target", async function() {
                await expect(v2Factory.unpauseTarget(await pool.getAddress())).to.emit(pool, "Unpaused").withArgs(await v2Factory.getAddress());
                expect(await pool.paused()).to.be.false;
            });

            it("Should fail to unpause target if not admin", async function() {
                await expect(v2Factory.connect(accounts[8]).unpauseTarget(await pool.getAddress())).to.be.reverted;
            });
        });

        it("Should emergency withdraw from target", async function() {
            await (await ethers.getContractAt("MockERC20", dummy)).mint(await pool.getAddress(), parseEther("100"));
            await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("emergencyWithdraw", [await pool.getAddress(), dummy, accounts[10].address, parseEther("100")]), ethers.ZeroHash, ethers.ZeroHash, 86401);
            await increase(days(2));
            await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("emergencyWithdraw", [await pool.getAddress(), dummy, accounts[10].address, parseEther("100")]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(pool, "EmergencyWithdraw").withArgs(dummy, accounts[10].address, parseEther("100"));
        });

        it("Should fail to emergency withdraw from target if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).emergencyWithdraw(await pool.getAddress(), dummy, accounts[10].address, parseEther("100"))).to.be.reverted;
        });

        it("Should emergency update AUM on target", async function() {
            await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("emergencyUpdateAUM", [await pool.getAddress(), parseEther("100")]), ethers.ZeroHash, ethers.ZeroHash, 86401);
            await increase(days(2));
            await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("emergencyUpdateAUM", [await pool.getAddress(), parseEther("100")]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(pool, "AssetUnderManagementUpdated").withArgs(await v2Factory.getAddress(), 0, parseEther("100"));
        });

        it("Should fail to emergency update AUM on target if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).emergencyUpdateAUM(await pool.getAddress(), parseEther("100"))).to.be.reverted;
        });

        it("Should update pool manager", async function() {
            await expect(v2Factory.updatePoolManager(await pool.getAddress(), accounts[8].address)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(accounts[8].address);
            await v2Factory.addPoolManager(accounts[8].address);
            await expect(v2Factory.updatePoolManager(await pool.getAddress(), accounts[8].address)).to.emit(v2Factory, "PoolManagerUpdated").withArgs(await pool.getAddress(), accounts[7].address, accounts[8].address);
            expect(await pool.poolManager()).to.equal(accounts[8].address);
        });

        it("Should update minimum investment limit", async function() {
            await expect(v2Factory.updatePoolInvestmentLimit(await pool.getAddress(), parseEther("1000"))).to.emit(pool, "MinimumInvestmentLimitUpdated").withArgs(await v2Factory.getAddress(), parseEther("0"), parseEther("1000"));
            expect(await pool.minimumInvestmentLimit()).to.equal(parseEther("1000"));
        });

        it("Should fail to update minimum investment limit if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).updatePoolInvestmentLimit(await pool.getAddress(), parseEther("1000"))).to.be.reverted;
        });

        it("Should update sigma token", async function() {
            await expect(v2Factory.updateSigmaTokenAddress(accounts[8].address)).to.emit(v2Factory, "SigmaTokenAddressUpdated").withArgs(sigmaToken, accounts[8].address);
            expect(await v2Factory.sigmaToken()).to.equal(accounts[8].address);
            sigmaToken = accounts[8].address;
        });

        it("Should fail to update sigma token if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).updateSigmaTokenAddress(accounts[9].address)).to.be.reverted;
        });

        it("Should fail to update sigma token if zero address", async function() {
            await expect(v2Factory.updateSigmaTokenAddress(ethers.ZeroAddress)).to.be.revertedWithCustomError(v2Factory, "InvalidAddress").withArgs(ethers.ZeroAddress);
        });

        it("Should close pool", async function() {
            await expect(v2Factory.closePool(await pool.getAddress())).to.emit(pool, "PoolStatusUpdated").withArgs(await v2Factory.getAddress(), 0, 2);
            expect(await pool.status()).to.equal(2);
        });

        it("Should fail to close pool if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).closePool(await pool.getAddress())).to.be.reverted;
        });

        it("Should upgrade target implementation", async function() {
            let newPoolImplementation = await (await getContractFactory("CsigmaV2Pool")).deploy();
            await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("upgradeTarget", [await pool.getAddress(), await newPoolImplementation.getAddress()]), ethers.ZeroHash, ethers.ZeroHash, 86401);
            await increase(days(2));
            await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("upgradeTarget", [await pool.getAddress(), await newPoolImplementation.getAddress()]), ethers.ZeroHash, ethers.ZeroHash)).not.to.be.reverted;
        });

        it("Should fail to upgrade target implementation if not admin", async function() {
            let newPoolImplementation = await (await getContractFactory("CsigmaV2Pool")).deploy();
            await expect(v2Factory.connect(accounts[8]).upgradeTarget(await pool.getAddress(), await newPoolImplementation.getAddress())).to.be.reverted;
        });

        it("Should fail to update pool manager if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).updatePoolManager(await pool.getAddress(), accounts[7].address)).to.be.reverted;
        });

        it("Should update pool size", async function() {
            await expect(v2Factory.updatePoolSize(await pool.getAddress(), parseEther("20000"))).to.emit(v2Factory, "PoolSizeUpdated").withArgs(await pool.getAddress(), parseEther("10000"), parseEther("20000"));
            expect(await pool.poolSize()).to.equal(parseEther("20000"));
        });

        it("Should fail to update pool size if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).updatePoolSize(await pool.getAddress(), parseEther("10000"))).to.be.reverted;
        });

        it("Should add oracle manager", async function() {
            // replace with timelock
            await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("addOracleManager", [await pool.getAddress(), accounts[8].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
            await increase(days(2));
            await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("addOracleManager", [await pool.getAddress(), accounts[8].address]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(pool, "OracleManagerAdded").withArgs(accounts[8].address);
            expect(await pool.isOracleManager(accounts[8].address)).to.be.true;
        });

        it("Should fail to add oracle manager if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).addOracleManager(await pool.getAddress(), accounts[9].address)).to.be.reverted;
        });

        it("Should remove oracle manager", async function() {
            await expect(v2Factory.removeOracleManager(await pool.getAddress(), accounts[8].address)).to.emit(pool, "OracleManagerRemoved").withArgs(accounts[8].address);
            expect(await pool.isOracleManager(accounts[8].address)).to.be.false;
        });

        it("Should fail to remove oracle manager if not admin", async function() {
            await expect(v2Factory.connect(accounts[8]).removeOracleManager(await pool.getAddress(), accounts[9].address)).to.be.reverted;
        });

        describe("Grant Roles", async function() {
            it("Should grant roles", async function() {
                await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("grantRole", [await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("grantRole", [await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(v2Factory, "RoleGranted").withArgs(await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address, await timelock.getAddress());
                expect(await v2Factory.hasRole(await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.true;
            });

            it("Should fail to grant roles if not admin", async function() {
                await expect(v2Factory.connect(accounts[8]).grantRole(await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.reverted;
            });

            it("Should revoke roles", async function() {
                await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("revokeRole", [await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("revokeRole", [await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(v2Factory, "RoleRevoked").withArgs(await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address, await timelock.getAddress());
                expect(await v2Factory.hasRole(await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.false;
            });

            it("Should fail to revoke roles if not admin", async function() {
                await expect(v2Factory.connect(accounts[8]).revokeRole(await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.reverted;
            });            
    
            it("Should transfer admin", async function() {
                await timelock.schedule(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("transferAdmin", [accounts[11].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await v2Factory.getAddress(), 0, v2Factory.interface.encodeFunctionData("transferAdmin", [accounts[11].address]), ethers.ZeroHash, ethers.ZeroHash)).to.emit(v2Factory, "AdminTransferred").withArgs(await timelock.getAddress(), accounts[11].address);
                expect(await v2Factory.hasRole(await v2Factory.DEFAULT_ADMIN_ROLE(), await timelock.getAddress())).to.be.false;
                expect(await v2Factory.hasRole(await v2Factory.DEFAULT_ADMIN_ROLE(), accounts[11].address)).to.be.true;
            });
        });
    });
});