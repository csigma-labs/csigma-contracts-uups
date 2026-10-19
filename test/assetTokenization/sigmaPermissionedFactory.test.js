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

describe("Permissioned-Factory", async function() {
    let accounts, permissionedFactory, poolImplementation, fundManagerImplementation, withdrawalManagerImplementation, diamondV1, dummy;
    let permissionedFundManager, permissionedPool, permissionedWithdrawalManager, timelock;
    
    const KYBStatus = {
        PENDING: 0,
        VERIFIED: 1,
        REJECTED: 2
    };

    before(async function() {
        accounts = await ethers.getSigners();
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await (await dummyFactory.deploy()).getAddress();

        let poolFactory = await getContractFactory("CsigmaPermissionedPool");
        poolImplementation = await (await poolFactory.deploy()).getAddress();
        
        let permissionedFundManagerFactory = await getContractFactory("CsigmaPermissionedFundManager");
        fundManagerImplementation = await (await permissionedFundManagerFactory.deploy()).getAddress();

        let permissionedWithdrawalManagerFactory = await getContractFactory("CsigmaPermissionedWithdrawalManager");
        withdrawalManagerImplementation = await (await permissionedWithdrawalManagerFactory.deploy()).getAddress();

        // Deploy mock Diamond V1 contract
        let v1DiamondFactory = await getContractFactory("MockV1");
        let mockDiamond = await v1DiamondFactory.deploy();
        diamondV1 = await mockDiamond.getAddress();

        // Deploy Timelock
        timelockFactory = await getContractFactory("CsigmaTimelock");
        timelock = await timelockFactory.deploy();
        await timelock.initialize(
            accounts[0].address, // super multi-sig admin (5/8)
            86400, // 1 day minimum delay
            [accounts[0].address, accounts[1].address], // proposer + canceller
            [accounts[0].address, accounts[1].address] // executor
        );
        
        // Deploy Factory
        factoryFactory = await getContractFactory("CsigmaPermissionedFactory");
        permissionedFactory = await factoryFactory.deploy();
        let proxyFactory = await getContractFactory("ERC1967Proxy");
        let proxy = await proxyFactory.deploy(await permissionedFactory.getAddress(), "0x");
        permissionedFactory = await ethers.getContractAt("CsigmaPermissionedFactory", await proxy.getAddress());

        poolFactory = await getContractFactory("CsigmaPermissionedPool");
        permissionedFundManagerFactory = await getContractFactory("CsigmaPermissionedFundManager");
        permissionedWithdrawalManagerFactory = await getContractFactory("CsigmaPermissionedWithdrawalManager");
        permissionedPool = await poolFactory.deploy();
        permissionedFundManager = await permissionedFundManagerFactory.deploy();
        permissionedWithdrawalManager = await permissionedWithdrawalManagerFactory.deploy();
        
        await permissionedFactory.initialize(
            accounts[0].address, // default admin (will transfer to timelock)
            accounts[0].address,
            await permissionedFundManager.getAddress(), // fundManagerImplementation
            await permissionedPool.getAddress(), // poolImplementation
            await permissionedWithdrawalManager.getAddress(), // withdrawalManagerImplementation
            diamondV1 // diamondv1
        );

        await permissionedFactory.transferAdmin(await timelock.getAddress());
    });

    it("Should initialize the factory", async function() {
        expect(await permissionedFactory.hasRole(await permissionedFactory.DEFAULT_ADMIN_ROLE(), await timelock.getAddress())).to.be.true;
        expect(await permissionedFactory.hasRole(await permissionedFactory.ROLE_CONFIG_MANAGER(), accounts[0].address)).to.be.true;
        expect(await permissionedFactory.fundManagerImplementation()).to.equal(await permissionedFundManager.getAddress());
        expect(await permissionedFactory.poolImplementation()).to.equal(await permissionedPool.getAddress());
        expect(await permissionedFactory.withdrawalManagerImplementation()).to.equal(await permissionedWithdrawalManager.getAddress());
        expect(await permissionedFactory.diamondV1()).to.equal(diamondV1);
        expect(await permissionedFactory.totalPools()).to.equal(0);
    });

    it("Should update pool implementation", async function() {
        let oldPoolImplementation = await permissionedFactory.poolImplementation();
        await expect(permissionedFactory.updatePoolImplementation(poolImplementation)).to.emit(permissionedFactory, "PoolImplementationUpdated").withArgs(oldPoolImplementation, poolImplementation);
        expect(await permissionedFactory.poolImplementation()).to.equal(poolImplementation);
    });

    it("Should fail to update pool implementation if not config manager", async function() {
        await expect(permissionedFactory.connect(accounts[1]).updatePoolImplementation(poolImplementation)).to.be.reverted;
    });

    it("Should fail to update pool implementation if zero address", async function() {
        await expect(permissionedFactory.updatePoolImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should update fund manager implementation", async function() {
        let oldFundManagerImplementation = await permissionedFactory.fundManagerImplementation();
        await expect(permissionedFactory.updateFundManagerImplementation(fundManagerImplementation)).to.emit(permissionedFactory, "FundManagerImplementationUpdated").withArgs(oldFundManagerImplementation, fundManagerImplementation);
        expect(await permissionedFactory.fundManagerImplementation()).to.equal(fundManagerImplementation);
    });

    it("Should fail to update fund manager implementation if not config manager", async function() {
        await expect(permissionedFactory.connect(accounts[1]).updateFundManagerImplementation(fundManagerImplementation)).to.be.reverted;
    });

    it("Should fail to update fund manager implementation if zero address", async function() {
        await expect(permissionedFactory.updateFundManagerImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    it("Should update withdrawal manager implementation", async function() {
        let oldWithdrawalManagerImplementation = await permissionedFactory.withdrawalManagerImplementation();
        await expect(permissionedFactory.updateWithdrawalManagerImplementation(withdrawalManagerImplementation)).to.emit(permissionedFactory, "WithdrawManagerImplementationUpdated").withArgs(oldWithdrawalManagerImplementation, withdrawalManagerImplementation);
        expect(await permissionedFactory.withdrawalManagerImplementation()).to.equal(withdrawalManagerImplementation);
    });

    it("Should fail to update withdrawal manager implementation if not config manager", async function() {
        await expect(permissionedFactory.connect(accounts[1]).updateWithdrawalManagerImplementation(withdrawalManagerImplementation)).to.be.reverted;
    });

    it("Should fail to update withdrawal manager implementation if zero address", async function() {
        await expect(permissionedFactory.updateWithdrawalManagerImplementation(ethers.ZeroAddress)).to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress").withArgs(ethers.ZeroAddress);
    });

    describe("Pool Manager Whitelisting", async function() {
        it("Should add pool manager with valid Diamond registry data", async function() {
            // Setup mock Diamond to return verified pool manager
            let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
            await mockDiamond.setPoolManagerData("PM001", accounts[7].address, KYBStatus.VERIFIED);
            
            await expect(permissionedFactory.addPoolManager("PM001", accounts[7].address))
                .to.emit(permissionedFactory, "PoolManagerAdded")
                .withArgs("PM001", accounts[7].address);
            expect(await permissionedFactory.isPoolManager(accounts[7].address)).to.be.true;
        });

        it("Should fail to add pool manager if not config manager", async function() {
            await expect(permissionedFactory.connect(accounts[1]).addPoolManager("PM002", accounts[8].address)).to.be.reverted;
        });

        it("Should fail to add pool manager if zero address", async function() {
            await expect(permissionedFactory.addPoolManager("PM002", ethers.ZeroAddress))
                .to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should fail to add pool manager if already whitelisted", async function() {
            await expect(permissionedFactory.addPoolManager("PM001", accounts[7].address))
                .to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress")
                .withArgs(accounts[7].address);
        });

        it("Should pass to add pool manager if wallet doesn't match Diamond registry", async function() {
            let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
            await mockDiamond.setPoolManagerData("PM003", accounts[9].address, KYBStatus.VERIFIED);
            
            // Try to add with different wallet
            await expect(permissionedFactory.addPoolManager("PM003", accounts[10].address)) 
                .to.be.not.reverted;
        });

        it("Should fail to add pool manager if KYB status is not VERIFIED", async function() {
            let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
            await mockDiamond.setPoolManagerData("PM004", accounts[11].address, KYBStatus.PENDING);
            
            await expect(permissionedFactory.addPoolManager("PM004", accounts[11].address))
                .to.be.revertedWithCustomError(permissionedFactory, "PoolManagerNotVerified")
                .withArgs("PM004");
        });

        it("Should fail to add pool manager if KYB status is REJECTED", async function() {
            let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
            await mockDiamond.setPoolManagerData("PM005", accounts[12].address, KYBStatus.REJECTED);
            
            await expect(permissionedFactory.addPoolManager("PM005", accounts[12].address))
                .to.be.revertedWithCustomError(permissionedFactory, "PoolManagerNotVerified")
                .withArgs("PM005");
        });

        it("Should remove pool manager", async function() {
            await expect(permissionedFactory.removePoolManager(accounts[7].address))
                .to.emit(permissionedFactory, "PoolManagerRemoved")
                .withArgs(accounts[7].address);
            expect(await permissionedFactory.isPoolManager(accounts[7].address)).to.be.false;
        });

        it("Should fail to remove pool manager if not config manager", async function() {
            await expect(permissionedFactory.connect(accounts[1]).removePoolManager(accounts[8].address)).to.be.reverted;
        });

        it("Should fail to remove pool manager if not whitelisted", async function() {
            await expect(permissionedFactory.removePoolManager(accounts[8].address))
                .to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress")
                .withArgs(accounts[8].address);
        });
    });

    describe("Token Whitelisting", async function() {
        it("Should add token to whitelist", async function() {
            await expect(permissionedFactory.addTokenToWhitelist(accounts[8].address))
                .to.emit(permissionedFactory, "PoolTokenAdded")
                .withArgs(accounts[8].address);
            expect(await permissionedFactory.isWhitelistedToken(accounts[8].address)).to.be.true;
        });

        it("Should fail to add token to whitelist if not config manager", async function() {
            await expect(permissionedFactory.connect(accounts[1]).addTokenToWhitelist(accounts[9].address)).to.be.reverted;
        });

        it("Should fail to add token to whitelist if zero address", async function() {
            await expect(permissionedFactory.addTokenToWhitelist(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress")
                .withArgs(ethers.ZeroAddress);
        });

        it("Should fail to add token to whitelist if already added", async function() {
            await expect(permissionedFactory.addTokenToWhitelist(accounts[8].address))
                .to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress")
                .withArgs(accounts[8].address);
        });

        it("Should remove token from whitelist", async function() {
            await expect(permissionedFactory.removeTokenFromWhitelist(accounts[8].address))
                .to.emit(permissionedFactory, "PoolTokenRemoved")
                .withArgs(accounts[8].address);
            expect(await permissionedFactory.isWhitelistedToken(accounts[8].address)).to.be.false;
        });

        it("Should fail to remove token from whitelist if not config manager", async function() {
            await expect(permissionedFactory.connect(accounts[1]).removeTokenFromWhitelist(accounts[9].address)).to.be.reverted;
        });

        it("Should fail to remove token from whitelist if not added", async function() {
            await expect(permissionedFactory.removeTokenFromWhitelist(accounts[8].address))
                .to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress")
                .withArgs(accounts[8].address);
        });
    });

    describe("Create a pool", async function() {
        let pool, fundManager, poolAddress, fundManagerAddress;
        
        before(async function() {
            // Setup pool manager
            let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
            await mockDiamond.setPoolManagerData("PM001", accounts[7].address, KYBStatus.VERIFIED);
            await permissionedFactory.addPoolManager("PM001", accounts[7].address);
            await permissionedFactory.addTokenToWhitelist(dummy);
        });

        it("Should create a pool by whitelisted pool manager", async function() {
            let poolTx = await permissionedFactory.connect(accounts[7]).createPool(
                "Test Pool",
                "TP",
                "Lender1",
                dummy,
                accounts[9].address,
                parseEther("10000")
            );

            poolTx = await poolTx.wait();
            poolAddress = poolTx.logs[8].args._pool;
            let poolManager = poolTx.logs[8].args._poolManager;
            fundManagerAddress = poolTx.logs[8].args._fundManager;
            let poolToken = poolTx.logs[8].args._poolToken;
            let oracleManager = poolTx.logs[8].args._oracleManager;
            let poolSize = poolTx.logs[8].args._poolSize;

            expect(poolManager).to.equal(accounts[7].address);
            expect(oracleManager).to.equal(accounts[9].address);
            expect(poolToken).to.equal(dummy);
            expect(poolSize).to.equal(parseEther("10000"));

            pool = await ethers.getContractAt("CsigmaPermissionedPool", poolAddress);
            expect(await pool.name()).to.equal("Test Pool");
            expect(await pool.symbol()).to.equal("TP");
            expect(await pool.factory()).to.equal(await permissionedFactory.getAddress());
            expect(await pool.hasRole(await pool.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.equal(true);
            expect(await pool.fundManager()).to.equal(fundManagerAddress);
            expect(await pool.poolSize()).to.equal(parseEther("10000"));

            fundManager = await ethers.getContractAt("CsigmaPermissionedFundManager", fundManagerAddress);
            expect(await fundManager.poolToken()).to.equal(dummy);
            expect(await fundManager.diamondV1()).to.equal(diamondV1);
            expect(await fundManager.fundManagerLenderId()).to.equal("Lender1");
            expect(await fundManager.pool()).to.equal(poolAddress);
            expect(await fundManager.hasRole(await fundManager.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.equal(true);
        });

        it("Should fail to create a pool if not whitelisted pool manager", async function() {
            await expect(permissionedFactory.connect(accounts[8]).createPool(
                "Test Pool 2",
                "TP2",
                "Lender1",
                dummy,
                accounts[9].address,
                parseEther("10000")
            )).to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress").withArgs(accounts[8].address);
        });

        it("Should fail to create a pool if token not whitelisted", async function() {
            await expect(permissionedFactory.connect(accounts[7]).createPool(
                "Test Pool 2",
                "TP2",
                "Lender1",
                accounts[8].address,
                accounts[9].address,
                parseEther("10000")
            )).to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress").withArgs(accounts[8].address);
        });

        it("Should fail to create a pool if pool name is used", async function() {
            await expect(permissionedFactory.connect(accounts[7]).createPool(
                "Test Pool",
                "TP",
                "Lender1",
                dummy,
                accounts[9].address,
                0
            )).to.be.revertedWithCustomError(permissionedFactory, "InvalidPoolName").withArgs("Test Pool");
        });

        describe("Create withdrawal manager", async function() {
            it("Should create a withdrawal manager by whitelisted pool manager", async function() {
                let withdrawalManagerTx = await permissionedFactory.connect(accounts[7]).createWithdrawalManager(
                    poolAddress,
                    accounts[10].address // csigmaRouter
                );

                withdrawalManagerTx = await withdrawalManagerTx.wait();
                // Find by event name (log index may shift if WM init grants change)
                const wmEventTopic = permissionedFactory.interface.getEvent("WithdrawalManagerCreated").topicHash;
                const wmLog = withdrawalManagerTx.logs.find(l => l.topics && l.topics[0] === wmEventTopic);
                const wmParsed = permissionedFactory.interface.parseLog(wmLog);
                let withdrawalManagerAddress = wmParsed.args._withdrawalManager;
                let poolAddr = wmParsed.args._pool;

                expect(poolAddr).to.equal(poolAddress);

                let withdrawalManager = await ethers.getContractAt("CsigmaPermissionedWithdrawalManager", withdrawalManagerAddress);

                expect(await withdrawalManager.underlyingToken()).to.equal(dummy);
                expect(await pool.withdrawalManager()).to.equal(withdrawalManagerAddress);
                expect(await withdrawalManager.LPToken()).to.equal(poolAddress);
                expect(await withdrawalManager.csigmaRouter()).to.equal(accounts[10].address);
                expect(await withdrawalManager.hasRole(await withdrawalManager.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.equal(true);
            });

            it("Should fail to create withdrawal manager if not whitelisted pool manager", async function() {
                await expect(permissionedFactory.connect(accounts[8]).createWithdrawalManager(
                    poolAddress,
                    accounts[10].address
                )).to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress").withArgs(accounts[8].address);
            });

            it("Should fail to create withdrawal manager from a verified PM who is not the pool's PM", async function() {
                const mockDiamondLocal = await ethers.getContractAt("MockV1", diamondV1);
                await mockDiamondLocal.setPoolManagerData("PM999", accounts[13].address, KYBStatus.VERIFIED);
                await permissionedFactory.addPoolManager("PM999", accounts[13].address);
                expect(await permissionedFactory.isPoolManager(accounts[13].address)).to.be.true;
                expect(await pool.poolManager()).to.equal(accounts[7].address);

                await expect(permissionedFactory.connect(accounts[13]).createWithdrawalManager(
                    poolAddress,
                    accounts[10].address
                )).to.be.revertedWithCustomError(permissionedFactory, "InvalidAddress")
                  .withArgs(accounts[13].address);

                const existingWM = await pool.withdrawalManager();
                expect(existingWM).to.not.equal(ethers.ZeroAddress);
            });
        });

        describe("Pool Activation", async function() {
            it("Should activate pool by config manager", async function() {
                await expect(permissionedFactory.activatePool(poolAddress))
                    .to.emit(pool, "PoolStatusUpdated")
                    .withArgs(await permissionedFactory.getAddress(), 0, 1);
                expect(await pool.status()).to.equal(1);
            });

            it("Should fail to activate pool if not config manager", async function() {
                await expect(permissionedFactory.connect(accounts[8]).activatePool(poolAddress)).to.be.reverted;
            });
        });

        describe("Admin Role Management with Timelock", async function() {
            it("Should grant roles via timelock", async function() {
                await timelock.schedule(await permissionedFactory.getAddress(), 0, permissionedFactory.interface.encodeFunctionData("grantRole", [await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await permissionedFactory.getAddress(), 0, permissionedFactory.interface.encodeFunctionData("grantRole", [await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash))
                    .to.emit(permissionedFactory, "RoleGranted")
                    .withArgs(await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19].address, await timelock.getAddress());
                expect(await permissionedFactory.hasRole(await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.true;
            });

            it("Should fail to grant roles if not admin", async function() {
                await expect(permissionedFactory.connect(accounts[8]).grantRole(await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.reverted;
            });

            it("Should revoke roles via timelock", async function() {
                await timelock.schedule(await permissionedFactory.getAddress(), 0, permissionedFactory.interface.encodeFunctionData("revokeRole", [await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await permissionedFactory.getAddress(), 0, permissionedFactory.interface.encodeFunctionData("revokeRole", [await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19].address]), ethers.ZeroHash, ethers.ZeroHash))
                    .to.emit(permissionedFactory, "RoleRevoked")
                    .withArgs(await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19].address, await timelock.getAddress());
                expect(await permissionedFactory.hasRole(await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.false;
            });

            it("Should fail to revoke roles if not admin", async function() {
                await expect(permissionedFactory.connect(accounts[8]).revokeRole(await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.reverted;
            });            
    
            it("Should transfer admin via timelock", async function() {
                await timelock.schedule(await permissionedFactory.getAddress(), 0, permissionedFactory.interface.encodeFunctionData("transferAdmin", [accounts[11].address]), ethers.ZeroHash, ethers.ZeroHash, 86401);
                await increase(days(2));
                await expect(timelock.execute(await permissionedFactory.getAddress(), 0, permissionedFactory.interface.encodeFunctionData("transferAdmin", [accounts[11].address]), ethers.ZeroHash, ethers.ZeroHash))
                    .to.emit(permissionedFactory, "AdminTransferred")
                    .withArgs(await timelock.getAddress(), accounts[11].address);
                expect(await permissionedFactory.hasRole(await permissionedFactory.DEFAULT_ADMIN_ROLE(), await timelock.getAddress())).to.be.false;
                expect(await permissionedFactory.hasRole(await permissionedFactory.DEFAULT_ADMIN_ROLE(), accounts[11].address)).to.be.true;
            });
        });
    });
});