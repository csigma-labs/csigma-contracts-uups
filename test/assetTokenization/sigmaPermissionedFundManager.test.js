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

describe("Permissioned-Fund Manager", async function() {
    let accounts, permissionedPool, permissionedFundManager, permissionedFactory, dummy, diamondV1;
    
    const KYBStatus = {
        PENDING: 0,
        VERIFIED: 1,
        REJECTED: 2
    };

    before(async function() {
        accounts = await ethers.getSigners();
        
        // Deploy tokens
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await dummyFactory.deploy();

        // Deploy implementations
        let poolFactory = await getContractFactory("CsigmaPermissionedPool");
        poolImplementation = await (await poolFactory.deploy()).getAddress();
        
        let fundManagerFactory = await getContractFactory("CsigmaPermissionedFundManager");
        fundManagerImplementation = await (await fundManagerFactory.deploy()).getAddress();

        // Deploy Diamond V1
        let v1DiamondFactory = await getContractFactory("MockV1");
        diamondV1 = await v1DiamondFactory.deploy();

        // Deploy withdrawal manager
        let withdrawFactory = await getContractFactory("CsigmaPermissionedWithdrawalManager");
        withdrawManagerTmplementation = await (await withdrawFactory.deploy()).getAddress();
        
        // Deploy Permissioned Factory (with proxy, same as old test)
        let factoryFactory = await getContractFactory("CsigmaPermissionedFactory");
        let factoryImpl = await factoryFactory.deploy();
        let proxyFactory = await getContractFactory("ERC1967Proxy");
        let proxy = await proxyFactory.deploy(await factoryImpl.getAddress(), "0x");
        permissionedFactory = await ethers.getContractAt("CsigmaPermissionedFactory", await proxy.getAddress());
        
        // Initialize factory
        await permissionedFactory.initialize(
            accounts[0].address, // default admin
            accounts[0].address,
            fundManagerImplementation,
            poolImplementation,
            withdrawManagerTmplementation,
            await diamondV1.getAddress()
        );
        
        // Setup Diamond with pool manager KYB data (IMPORTANT - must be VERIFIED)
        await diamondV1.setPoolManagerData("PM1", accounts[17].address, KYBStatus.VERIFIED);
        await diamondV1.setDiamondOwner(accounts[9].address);

        // Grant roles and whitelist
        await permissionedFactory.addPoolManager("PM1", accounts[17].address);
        await permissionedFactory.addTokenToWhitelist(await dummy.getAddress());

        // Create pool (same pattern as old test - createPool creates both pool and fund manager)
        let poolTx = await permissionedFactory.connect(accounts[17]).createPool(
            "Test Pool",
            "TP",
            "Lender1",
            await dummy.getAddress(),
            accounts[19].address, // oracle manager
            parseEther("1000000") // pool size
        );

        poolTx = await poolTx.wait();
        
        // Get addresses from event logs (same pattern as old test)
        poolAddress = poolTx.logs[8].args._pool;
        permissionedPool = await ethers.getContractAt("CsigmaPermissionedPool", poolAddress);
        
        // Activate pool
        await permissionedFactory.activatePool(poolAddress);

        // Grant admin role to accounts[0] for setup
        await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
        await permissionedFactory.connect(accounts[17]).createWithdrawalManager(poolAddress, accounts[10].address);
        
        // Get fund manager address from event
        fundManagerAddress = await poolTx.logs[8].args._fundManager;
        permissionedFundManager = await ethers.getContractAt("CsigmaPermissionedFundManager", fundManagerAddress);

        // Mint and approve tokens
        for (let i = 0; i < 19; i++) {
            await dummy.mint(accounts[i].address, parseEther("10000"));
            await dummy.connect(accounts[i]).approve(permissionedPool.getAddress(), parseEther("10000"));
        }
        
        // Setup Diamond with lender data
        for(let i = 0; i < 19; i++) {
            await diamondV1.setLenderData(`LENDER00${i}`, accounts[i].address, KYBStatus.VERIFIED);
        }
        
        // Whitelist lenders in pool — addWhitelistLender is onlyPoolManager (accounts[17])
        for(let i = 0; i < 10; i++) {
            await permissionedPool.connect(accounts[17]).addWhitelistLender(`LENDER00${i}`, accounts[i].address);
        }
    });

    it("Should have initialized the fund manager correctly", async function() {
        expect(await permissionedFundManager.poolToken()).to.be.equal(await dummy.getAddress());
        expect(await permissionedFundManager.factory()).to.be.equal(await permissionedFactory.getAddress());
        expect(await permissionedFundManager.diamondV1()).to.be.equal(await diamondV1.getAddress());
        expect(await permissionedFundManager.fundManagerLenderId()).to.be.equal("Lender1");
        expect(await permissionedFundManager.hasRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[17].address)).to.be.true;
        expect(await permissionedFundManager.totalV1Pools()).to.be.equal(0);
        expect(await permissionedFundManager.pool()).to.be.equal(await permissionedPool.getAddress());
        expect(await permissionedFundManager.totalAllocation()).to.be.equal(0);
    });

    describe("Access Control Tests", async function() {
        it("Should grant roles", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).grantRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address))
                .to.emit(permissionedFundManager, "RoleGranted")
                .withArgs(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, accounts[17].address);
            expect(await permissionedFundManager.hasRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.true;
        });

        it("Should fail to grant roles if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[8]).grantRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.reverted;
        });

        it("Should revoke roles", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).revokeRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address))
                .to.emit(permissionedFundManager, "RoleRevoked")
                .withArgs(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, accounts[17].address);
            expect(await permissionedFundManager.hasRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.false;
        });

        it("Should fail to revoke roles if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[8]).revokeRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[17].address)).to.be.reverted;
        });            

        it("Should transfer admin", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).grantRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address))
                .to.emit(permissionedFundManager, "RoleGranted");
            await expect(permissionedFundManager.connect(accounts[19]).transferAdmin(accounts[7].address))
                .to.emit(permissionedFundManager, "AdminTransferred")
                .withArgs(accounts[19].address, accounts[7].address);
            expect(await permissionedFundManager.hasRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.false;
            expect(await permissionedFundManager.hasRole(await permissionedFundManager.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.be.true;
            // Transfer back to pool manager
            await permissionedFundManager.connect(accounts[7]).transferAdmin(accounts[17].address);
        });

        it("Should fail to transfer admin if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[8]).transferAdmin(accounts[7].address)).to.be.reverted;
        });

        it("Should emergency withdraw", async function() {
            await dummy.mint(await permissionedFundManager.getAddress(), parseEther("100"));
            await expect(permissionedFundManager.connect(accounts[17]).emergencyWithdraw(dummy, accounts[10].address, parseEther("100")))
                .to.emit(permissionedFundManager, "EmergencyWithdraw")
                .withArgs(await dummy.getAddress(), accounts[10].address, parseEther("100"));
        });

        it("Should fail to emergency withdraw if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[8]).emergencyWithdraw(dummy, accounts[10].address, parseEther("100"))).to.be.reverted;
        });
    });

    describe("Add/Remove/Update V1 Pools Tests", async function() {
        
        it("Should fail to add pool if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[18]).addPool("cPool 1", 10000, accounts[20].address))
                .to.be.reverted;
        });
        
        it("Should fail to add pool if pool is not active", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).addPool("cPool 2", 10000, accounts[20].address))
                .to.be.revertedWithCustomError(permissionedFundManager, "V1PoolIsNotActive")
                .withArgs("cPool 2");
        });
        
        it("Should fail to add pool if pool has different pool token", async function() {
            await diamondV1.setPoolStatus("cPool 1", 1);
            await expect(permissionedFundManager.connect(accounts[17]).addPool("cPool 1", 10000, accounts[20].address))
                .to.be.revertedWithCustomError(permissionedFundManager, "InvalidV1Pool")
                .withArgs("cPool 1");
        });
        
        it("Should fail to add pool if zero address wallet", async function() {
            await diamondV1.setPoolToken(await dummy.getAddress());
            await expect(permissionedFundManager.connect(accounts[17]).addPool("cPool 1", 10000, ethers.ZeroAddress))
                .to.be.revertedWith("address cannot be zero");
        });

        it("Should add pool with dedicated wallet", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).addPool("cPool 1", 10000, accounts[20].address))
                .to.emit(permissionedFundManager, "V1PoolAdded")
                .withArgs(accounts[17].address, 10000, "cPool 1", accounts[20].address);
            expect(await permissionedFundManager.totalAllocation()).to.be.equal(10000);
            
            const poolInfo = await permissionedFundManager.v1Pools(0);
            expect(poolInfo.v1PoolId).to.equal("cPool 1");
            expect(poolInfo.allocation).to.equal(10000);
            expect(await permissionedFundManager.dedicatedWallet("cPool 1")).to.equal(accounts[20].address);
        });

        it("Should fail to add pool if pool already exists", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).addPool("cPool 1", 10000, accounts[21].address))
                .to.be.revertedWithCustomError(permissionedFundManager, "DuplicatePool")
                .withArgs("cPool 1");
        });

        it("Should fail to add pool if total allocation exceeds 100%", async function() {
            await diamondV1.setPoolStatus("cPool 5", 1);
            await expect(permissionedFundManager.connect(accounts[17]).addPool("cPool 5", 5000, accounts[21].address))
                .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAllocation");
        });

        it("Should update pool wallet", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).updatePoolWallet("cPool 1", accounts[21].address))
                .to.emit(permissionedFundManager, "PoolWalletUpdated")
                .withArgs(accounts[17].address, accounts[20].address, accounts[21].address, "cPool 1");
            
            expect(await permissionedFundManager.dedicatedWallet("cPool 1")).to.equal(accounts[21].address);
        });

        it("Should fail to update pool wallet if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[18]).updatePoolWallet("cPool 1", accounts[22].address))
                .to.be.reverted;
        });

        it("Should fail to update pool with invalid pool id", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).updatePoolWallet("cPool 6", accounts[21].address))
                .to.be.reverted;
        });

        it("Should fail to update pool wallet if zero address", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).updatePoolWallet("cPool 1", ethers.ZeroAddress))
                .to.be.revertedWith("address cannot be zero");
        });

        it("Should remove pool", async function() {
            expect(await permissionedFundManager.totalV1Pools()).to.be.equal(1);
            await expect(permissionedFundManager.connect(accounts[17]).removePool(0))
                .to.emit(permissionedFundManager, "V1PoolRemoved")
                .withArgs(accounts[17].address, 10000, "cPool 1");
            expect(await permissionedFundManager.totalV1Pools()).to.be.equal(0);
            expect(await permissionedFundManager.totalAllocation()).to.be.equal(0);
        });

        it("Should fail to remove pool if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[18]).removePool(0))
                .to.be.reverted;
        });

        it("Should update allocation", async function() {
            await diamondV1.setPoolStatus("cPool 1", 1);
            await permissionedFundManager.connect(accounts[17]).addPool("cPool 1", 10000, accounts[20].address);
            await expect(permissionedFundManager.connect(accounts[17]).updatePoolAllocation(0, 5000))
                .to.emit(permissionedFundManager, "V1PoolAllocationUpdated")
                .withArgs(accounts[17].address, 10000, 5000, "cPool 1");
            expect(await permissionedFundManager.totalAllocation()).to.be.equal(5000);
        });

        it("Should fail to update allocation if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[18]).updatePoolAllocation(0, 5000))
                .to.be.reverted;
        });

        it("Should fail to update allocation if total exceeds 100%", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).updatePoolAllocation(0, 20000))
                .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAllocation")
                .withArgs(20000);
        });
    });

    describe("Manage Funds Tests", async function() {
        before(async function() {
            await permissionedFundManager.connect(accounts[17]).updatePoolAllocation(0, 10000);
            await diamondV1.setPoolStatus("cPool 2", 1);
            await diamondV1.setPoolStatus("cPool 3", 1);
            await diamondV1.setPoolStatus("cPool 4", 1);
            await permissionedPool.connect(accounts[0]).deposit(parseEther("100"), accounts[0]);
        });

        it("Should deploy funds to a single dedicated wallet", async function() {
            const walletBalanceBefore = await dummy.balanceOf(accounts[20].address);
            
            const tx = await permissionedFundManager.connect(accounts[17]).deployFunds();
            await expect(tx)
                .to.emit(permissionedFundManager, "FundDeployed")
                .withArgs(accounts[17].address, parseEther("95"));
            await expect(tx)
                .to.emit(permissionedFundManager, "FundDeployedToChildPool")
                .withArgs(accounts[20].address, "cPool 1", parseEther("95"));
            
            expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.be.equal(parseEther("0"));
            expect(await dummy.balanceOf(accounts[20].address)).to.be.equal(walletBalanceBefore + parseEther("95"));
        });

        it("Should deploy funds to multiple dedicated wallets", async function() {
            await permissionedFundManager.connect(accounts[17]).updatePoolAllocation(0, 5000);
            await permissionedFundManager.connect(accounts[17]).addPool("cPool 2", 1000, accounts[21].address);
            await permissionedFundManager.connect(accounts[17]).addPool("cPool 3", 1000, accounts[22].address);
            await permissionedFundManager.connect(accounts[17]).addPool("cPool 4", 3000, accounts[23].address);
            
            await permissionedPool.connect(accounts[7]).deposit(parseEther("200"), accounts[7].address);
            
            const wallet20Before = await dummy.balanceOf(accounts[20].address);
            const wallet21Before = await dummy.balanceOf(accounts[21].address);
            const wallet22Before = await dummy.balanceOf(accounts[22].address);
            const wallet23Before = await dummy.balanceOf(accounts[23].address);
            
            const tx = await permissionedFundManager.connect(accounts[17]).deployFunds();
            
            // Check FundDeployed event (overall)
            await expect(tx)
                .to.emit(permissionedFundManager, "FundDeployed")
                .withArgs(accounts[17].address, parseEther("190"));
            
            await expect(tx)
                .to.emit(permissionedFundManager, "FundDeployedToChildPool")
                .withArgs(accounts[20].address, "cPool 1", parseEther("95")); // 50%
            
            await expect(tx)
                .to.emit(permissionedFundManager, "FundDeployedToChildPool")
                .withArgs(accounts[21].address, "cPool 2", parseEther("19")); // 10%
            
            await expect(tx)
                .to.emit(permissionedFundManager, "FundDeployedToChildPool")
                .withArgs(accounts[22].address, "cPool 3", parseEther("19")); // 10%
            
            await expect(tx)
                .to.emit(permissionedFundManager, "FundDeployedToChildPool")
                .withArgs(accounts[23].address, "cPool 4", parseEther("57")); // 30%
            
            expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.be.equal(parseEther("0"));
            expect(await dummy.balanceOf(accounts[20].address)).to.be.equal(wallet20Before + parseEther("95")); // 50%
            expect(await dummy.balanceOf(accounts[21].address)).to.be.equal(wallet21Before + parseEther("19")); // 10%
            expect(await dummy.balanceOf(accounts[22].address)).to.be.equal(wallet22Before + parseEther("19")); // 10%
            expect(await dummy.balanceOf(accounts[23].address)).to.be.equal(wallet23Before + parseEther("57")); // 30%
        });

        it("Should fail to deploy funds if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[18]).deployFunds())
                .to.be.reverted;
        });

        it("Should fail if total allocation is not 100%", async function() {
            await permissionedFundManager.connect(accounts[17]).updatePoolAllocation(1, 100);
            await expect(permissionedFundManager.connect(accounts[17]).deployFunds())
                .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAllocation")
                .withArgs(9100);
            // Restore
            await permissionedFundManager.connect(accounts[17]).updatePoolAllocation(1, 1000);
        });

        it("Should fail to deploy if pool status is not ACTIVE", async function() {
            await diamondV1.setPoolStatus("cPool 2", 0); // Set to PENDING
            await permissionedPool.connect(accounts[1]).deposit(parseEther("50"), accounts[1]);
            
            await expect(permissionedFundManager.connect(accounts[17]).deployFunds())
                .to.be.revertedWithCustomError(permissionedFundManager, "V1PoolIsNotActive")
                .withArgs("cPool 2");
            
            // Restore
            await diamondV1.setPoolStatus("cPool 2", 1);
        });

        describe("Pay Function Tests", async function() {

            it("Should allow dedicated wallet to pay back funds with zero fee", async function() {
                const amount = parseEther("50");
                const fee = 0n;

                await dummy.mint(accounts[20].address, amount);
                await dummy.connect(accounts[20]).approve(await permissionedFundManager.getAddress(), amount);

                const fmBalanceBefore = await dummy.balanceOf(await permissionedFundManager.getAddress());
                const aumBefore = await permissionedPool.assetUnderManagement();
                const diamondOwner = await diamondV1.owner();
                const diamondBalanceBefore = await dummy.balanceOf(diamondOwner);

                await expect(
                    permissionedFundManager.connect(accounts[20]).pay("cPool 1", amount, fee)
                )
                    .to.emit(permissionedFundManager, "FundsPaid")
                    .withArgs(accounts[20].address, "cPool 1", amount);

                expect(await dummy.balanceOf(await permissionedFundManager.getAddress()))
                    .to.equal(fmBalanceBefore + amount);

                expect(await permissionedPool.assetUnderManagement())
                    .to.equal(aumBefore - amount);

                expect(await dummy.balanceOf(diamondOwner))
                    .to.equal(diamondBalanceBefore);
            });

            it("Should allow dedicated wallet to pay back funds with fee", async function() {
                const amount = parseEther("50");
                const fee = parseEther("5");
                const netAmount = amount - fee;

                await dummy.mint(accounts[20].address, amount);
                await dummy.connect(accounts[20]).approve(await permissionedFundManager.getAddress(), amount);

                const fmBalanceBefore = await dummy.balanceOf(await permissionedFundManager.getAddress());
                const aumBefore = await permissionedPool.assetUnderManagement();
                const diamondOwner = await diamondV1.owner();
                const diamondBalanceBefore = await dummy.balanceOf(diamondOwner);

                const tx = await permissionedFundManager.connect(accounts[20]).pay("cPool 1", amount, fee);

                await expect(tx)
                    .to.emit(permissionedFundManager, "FundsPaid")
                    .withArgs(accounts[20].address, "cPool 1", netAmount);

                await expect(tx)
                    .to.emit(permissionedFundManager, "FeePaidToDiamond")
                    .withArgs(accounts[20].address, "cPool 1", fee, accounts[9].address);

                expect(await dummy.balanceOf(await permissionedFundManager.getAddress()))
                    .to.equal(fmBalanceBefore + netAmount);

                expect(await dummy.balanceOf(diamondOwner))
                    .to.equal(diamondBalanceBefore + fee);

                expect(await permissionedPool.assetUnderManagement())
                    .to.equal(aumBefore - netAmount);
            });

            it("Should fail pay if pool is not active", async function() {
                await diamondV1.setPoolStatus("cPool 1", 0);

                await dummy.mint(accounts[20].address, parseEther("10"));
                await dummy.connect(accounts[20]).approve(await permissionedFundManager.getAddress(), parseEther("10"));

                await expect(
                    permissionedFundManager.connect(accounts[20]).pay("cPool 1", parseEther("10"), 0)
                )
                    .to.be.revertedWithCustomError(permissionedFundManager, "V1PoolIsNotActive")
                    .withArgs("cPool 1");

                await diamondV1.setPoolStatus("cPool 1", 1);
            });
        });

        describe("PM Repay Functions Tests", async function() {
            before(async function() {
                
                // Ensure fund manager has liquidity
                await dummy.mint(await permissionedFundManager.getAddress(), parseEther("500"));
            });

            it("Should allow admin to repay specific lender", async function() {
                const lender = accounts[0].address;
                const assetsToRepay = parseEther("10");
                const expectedShares = await permissionedPool.convertToShares(assetsToRepay);
                
                const lenderLPBefore = await permissionedPool.balanceOf(lender);
                const lenderAssetsBefore = await dummy.balanceOf(lender);
                
                await expect(permissionedFundManager.connect(accounts[17]).pmRepayLender(lender, assetsToRepay))
                    .to.emit(permissionedFundManager, "PMLenderRepaid")
                    .withArgs(lender, assetsToRepay, expectedShares);
                
                expect(await permissionedPool.balanceOf(lender)).to.be.equal(lenderLPBefore - expectedShares);
                expect(await dummy.balanceOf(lender)).to.be.closeTo(lenderAssetsBefore + assetsToRepay, 5n);

            });

            it("Should fail if lender has zero shares", async function () {
                const lender = accounts[15].address; // not deposited

                await expect(
                    permissionedFundManager.connect(accounts[17])
                        .pmRepayLender(lender, parseEther("10"))
                ).to.be.reverted;
            });

            it("Should fail if fund manager has insufficient liquidity", async function () {
                const lender = accounts[0].address;

                // Drain FM liquidity
                const fmBalance = await dummy.balanceOf(await permissionedFundManager.getAddress());
                if (fmBalance > 0n) {
                    await permissionedFundManager.connect(accounts[17])
                        .sendToV2Reserve(fmBalance, 1);
                }

                await expect(
                    permissionedFundManager.connect(accounts[17])
                        .pmRepayLender(lender, parseEther("1000"))
                ).to.be.reverted;
            });

            it("Should fully burn lender shares when repaying full assets", async function () {
                const lender = accounts[1].address;

                const lenderShares = await permissionedPool.balanceOf(lender);
                
                // Calculate assets needed
                const assetsNeeded = await permissionedPool.convertToAssets(lenderShares);
                
                // PROPER FLOW: Deposit → Deploy → Pay back → Repay
                // 1. Deposit more into pool to get funds to fund manager
                await permissionedPool.connect(accounts[0]).deposit(assetsNeeded, accounts[0].address);
                
                // 2. Deploy funds to dedicated wallets
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                
                // 3. Dedicated wallet pays back to fund manager
                const dedicatedWallet = accounts[20]; // From pool index 0
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                // 4. Now fund manager has liquidity and totalAssets is properly maintained
                // Repay the lender
                await permissionedFundManager.connect(accounts[17])
                    .pmRepayLender(lender, assetsNeeded);

                const lenderSharesAfter = await permissionedPool.balanceOf(lender);

                expect(lenderSharesAfter).to.be.closeTo(0n, 5n);
            });

            it("Should handle 10 wei repayment correctly", async function () {
                const lender = accounts[0].address;

                await dummy.mint(await permissionedFundManager.getAddress(), 1n);

                const lenderLPBefore = await permissionedPool.balanceOf(lender);

                await permissionedFundManager.connect(accounts[17])
                    .pmRepayLender(lender, 10n);

                const lenderLPAfter = await permissionedPool.balanceOf(lender);

                expect(lenderLPAfter).to.be.lte(lenderLPBefore);
            });

            it("Should handle multiple consecutive repayments", async function () {
                const lender = accounts[0].address;
                
                const repayAmount1 = parseEther("10");
                const repayAmount2 = parseEther("5");
                const totalRepayAmount = repayAmount1 + repayAmount2;
                
                await permissionedPool.connect(accounts[0]).deposit(totalRepayAmount, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);

                // Get initial state
                const totalSupplyInitial = await permissionedPool.totalSupply();
                const lenderLPInitial = await permissionedPool.balanceOf(lender);
                const lenderAssetsInitial = await dummy.balanceOf(lender);
                const expectedShares1 = await permissionedPool.convertToShares(repayAmount1);
                
                // First repayment
                await permissionedFundManager.connect(accounts[17]).pmRepayLender(lender, repayAmount1);
                
                const totalSupplyAfter1 = await permissionedPool.totalSupply();
                const lenderLPAfter1 = await permissionedPool.balanceOf(lender);
                const lenderAssetsAfter1 = await dummy.balanceOf(lender);
                
                const actualSharesBurned1 = lenderLPInitial - lenderLPAfter1;
                const assetsReceived1 = lenderAssetsAfter1 - lenderAssetsInitial;
                
                expect(actualSharesBurned1).to.be.closeTo(expectedShares1, parseEther("0.01"));
                expect(assetsReceived1).to.be.closeTo(repayAmount1, 5n);
                expect(totalSupplyAfter1).to.equal(totalSupplyInitial - actualSharesBurned1);
                expect(lenderLPAfter1).to.equal(lenderLPInitial - actualSharesBurned1);

                const expectedShares2 = await permissionedPool.convertToShares(repayAmount2);
                await permissionedFundManager.connect(accounts[17]).pmRepayLender(lender, repayAmount2);
                
                const totalSupplyAfter2 = await permissionedPool.totalSupply();
                const lenderLPAfter2 = await permissionedPool.balanceOf(lender);
                const lenderAssetsAfter2 = await dummy.balanceOf(lender);
                
                const actualSharesBurned2 = lenderLPAfter1 - lenderLPAfter2;
                const assetsReceived2 = lenderAssetsAfter2 - lenderAssetsAfter1;

                // Verify second repayment
                expect(actualSharesBurned2).to.be.closeTo(expectedShares2, parseEther("0.01"));
                expect(assetsReceived2).to.be.closeTo(repayAmount2, 5n);
                expect(totalSupplyAfter2).to.equal(totalSupplyAfter1 - actualSharesBurned2);
                expect(lenderLPAfter2).to.equal(lenderLPAfter1 - actualSharesBurned2);
                
                // Verify cumulative results
                const totalSharesBurned = actualSharesBurned1 + actualSharesBurned2;
                const totalAssetsReceived = assetsReceived1 + assetsReceived2;

                expect(totalSupplyAfter2).to.equal(totalSupplyInitial - totalSharesBurned);
                expect(lenderLPAfter2).to.equal(lenderLPInitial - totalSharesBurned);
                expect(totalAssetsReceived).to.be.closeTo(totalRepayAmount, 10n);
            });

            it("Should decrease totalSupply after repay", async function () {
                const lender = accounts[0].address;
                const amount = parseEther("20");

                await dummy.mint(await permissionedFundManager.getAddress(), amount);

                const totalSupplyBefore = await permissionedPool.totalSupply();

                await permissionedFundManager.connect(accounts[17])
                    .pmRepayLender(lender, amount);

                const totalSupplyAfter = await permissionedPool.totalSupply();

                expect(totalSupplyAfter).to.be.lt(totalSupplyBefore);
            });

            it("Should fail if repay amount exceeds lender assets", async function () {
                const lender = accounts[0].address;

                const lenderAssets = await permissionedPool.maxWithdraw(lender);

                await dummy.mint(await permissionedFundManager.getAddress(), lenderAssets + parseEther("1"));

                await expect(
                    permissionedFundManager.connect(accounts[17])
                        .pmRepayLender(lender, lenderAssets + parseEther("1"))
                ).to.be.reverted;
            });

            it("Event shares should match actual burned shares", async function () {
                const lender = accounts[0].address;
                const amount = parseEther("10");

                await dummy.mint(await permissionedFundManager.getAddress(), amount);

                const lenderLPBefore = await permissionedPool.balanceOf(lender);

                const tx = await permissionedFundManager.connect(accounts[17])
                    .pmRepayLender(lender, amount);

                const receipt = await tx.wait();
                const event = receipt.logs.find(
                    log => log.fragment?.name === "PMLenderRepaid"
                );

                const sharesFromEvent = event.args[2];

                const lenderLPAfter = await permissionedPool.balanceOf(lender);
                const actualBurned = lenderLPBefore - lenderLPAfter;

                expect(actualBurned).to.be.closeTo(sharesFromEvent, 5n);
            });

            it("Should fail pmRepayLender if not admin", async function() {
                await expect(permissionedFundManager.connect(accounts[18]).pmRepayLender(accounts[0].address, parseEther("10")))
                    .to.be.reverted;
            });

            it("Should fail pmRepayLender with zero amount", async function() {
                await expect(permissionedFundManager.connect(accounts[17]).pmRepayLender(accounts[0].address, 0))
                    .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAmount")
                    .withArgs(0);
            });

            it("Should allow admin to proportionally repay multiple lenders", async function () {
                await permissionedPool.connect(accounts[1]).deposit(parseEther("100"), accounts[1].address);
                const lenders = [accounts[0].address, accounts[1].address, accounts[7].address];

                const totalAssets = parseEther("50");
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();

                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);

                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);

                const totalSupplyBefore = await permissionedPool.totalSupply();
                const totalAssetsBefore = await permissionedPool.totalAssets();

                const lender0LPBefore = await permissionedPool.balanceOf(lenders[0]);
                const lender1LPBefore = await permissionedPool.balanceOf(lenders[1]);
                const lender7LPBefore = await permissionedPool.balanceOf(lenders[2]);

                const expectedTotalSharesBurn = totalAssets * totalSupplyBefore / totalAssetsBefore;
                
                const expectedLender0Burn = expectedTotalSharesBurn * lender0LPBefore / totalSupplyBefore;
                const expectedLender1Burn = expectedTotalSharesBurn * lender1LPBefore / totalSupplyBefore;
                const expectedLender7Burn = expectedTotalSharesBurn * lender7LPBefore / totalSupplyBefore;

                const lpBalances = await Promise.all(
                    lenders.map(l => permissionedPool.balanceOf(l))
                );

                const lpAmountToSettle = lpBalances.reduce((a,b) => a + b, 0n);

                await expect(permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle))
                    .to.emit(permissionedFundManager, "PMProportionalRepayExecuted");

                const lender0LPAfter = await permissionedPool.balanceOf(lenders[0]);
                const lender1LPAfter = await permissionedPool.balanceOf(lenders[1]);
                const lender7LPAfter = await permissionedPool.balanceOf(lenders[2]);

                const totalSupplyAfter = await permissionedPool.totalSupply();

                const lender0Burned = lender0LPBefore - lender0LPAfter;
                const lender1Burned = lender1LPBefore - lender1LPAfter;
                const lender7Burned = lender7LPBefore - lender7LPAfter;

                const totalBurned = lender0Burned + lender1Burned + lender7Burned;

                expect(totalBurned).to.be.closeTo(expectedTotalSharesBurn, 100n);
                if (lender0LPBefore > 0n) {
                    expect(lender0Burned).to.be.closeTo(expectedLender0Burn, 50n);
                    expect(lender0Burned).to.be.gt(0n);
                }
                
                if (lender1LPBefore > 0n) {
                    expect(lender1Burned).to.be.closeTo(expectedLender1Burn, 50n);
                    expect(lender1Burned).to.be.gt(0n);
                }
                
                if (lender7LPBefore > 0n) {
                    expect(lender7Burned).to.be.closeTo(expectedLender7Burn, 50n);
                    expect(lender7Burned).to.be.gt(0n);
                }

                // Verify total supply decreased correctly
                expect(totalSupplyAfter).to.equal(totalSupplyBefore - totalBurned);

                const lender0Percentage = lender0LPBefore * 10000n / totalSupplyBefore;
                const lender1Percentage = lender1LPBefore * 10000n / totalSupplyBefore;
                const lender7Percentage = lender7LPBefore * 10000n / totalSupplyBefore;

                const lender0BurnPercentage = lender0Burned * 10000n / totalBurned;
                const lender1BurnPercentage = lender1Burned * 10000n / totalBurned;
                const lender7BurnPercentage = lender7Burned * 10000n / totalBurned;

                expect(lender0BurnPercentage).to.be.equal(lender0Percentage);
                expect(lender1BurnPercentage).to.be.equal(lender1Percentage);
                expect(lender7BurnPercentage).to.be.equal(lender7Percentage);
            });

            it("Should handle proportional repay with single lender", async function() {
                const lenders = [accounts[0].address];
                const repayAmount = parseEther("20");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(repayAmount, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const lenderLPBefore = await permissionedPool.balanceOf(lenders[0]);
                const lenderAssetsBefore = await dummy.balanceOf(lenders[0]);
                const totalSupplyBefore = await permissionedPool.totalSupply();

                const lpBalances = await Promise.all(
                    lenders.map(l => permissionedPool.balanceOf(l))
                );

                const lpAmountToSettle = lpBalances.reduce((a,b) => a + b, 0n);
                
                await permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, repayAmount, lpAmountToSettle);
                
                const lenderLPAfter = await permissionedPool.balanceOf(lenders[0]);
                const lenderAssetsAfter = await dummy.balanceOf(lenders[0]);
                const totalSupplyAfter = await permissionedPool.totalSupply();
                
                expect(lenderLPAfter).to.be.lt(lenderLPBefore);
                
                const assetsReceived = lenderAssetsAfter - lenderAssetsBefore;
                expect(assetsReceived).to.be.gt(0);
                
                expect(totalSupplyAfter).to.be.lt(totalSupplyBefore);

                const sharesBurned = lenderLPBefore - lenderLPAfter;
                const totalSharesBurned = totalSupplyBefore - totalSupplyAfter;
                expect(sharesBurned).to.equal(totalSharesBurned);
            });

            it("Should skip lenders with zero balance in proportional repay", async function() {
                const lenders = [accounts[0].address, accounts[15].address, accounts[7].address]; // accounts[15] has no LP
                const totalAssets = parseEther("30");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const lender0LPBefore = await permissionedPool.balanceOf(lenders[0]);
                const lender15LPBefore = await permissionedPool.balanceOf(lenders[1]);
                const lender7LPBefore = await permissionedPool.balanceOf(lenders[2]);
                
                expect(lender15LPBefore).to.equal(0n); // Verify accounts[15] has no LP

                const lpAmountToSettle = lender0LPBefore + lender15LPBefore + lender7LPBefore;
                
                await expect(permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle))
                    .to.emit(permissionedFundManager, "PMProportionalRepayExecuted");
                
                // Lenders with balance should decrease
                expect(await permissionedPool.balanceOf(lenders[0])).to.be.lt(lender0LPBefore);
                expect(await permissionedPool.balanceOf(lenders[1])).to.equal(0n);
                expect(await permissionedPool.balanceOf(lenders[2])).to.be.lt(lender7LPBefore);
            });

            it("Should correctly distribute proportional amounts based on LP ownership", async function() {
                // Setup: Make accounts[2] have 2x the LP of accounts[3]
                await permissionedPool.connect(accounts[2]).deposit(parseEther("200"), accounts[2].address);
                await permissionedPool.connect(accounts[3]).deposit(parseEther("100"), accounts[3].address);
                
                const lenders = [accounts[2].address, accounts[3].address];
                const totalAssets = parseEther("90");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const lender2LPBefore = await permissionedPool.balanceOf(lenders[0]);
                const lender3LPBefore = await permissionedPool.balanceOf(lenders[1]);

                const lpAmountToSettle = lender2LPBefore + lender3LPBefore;
                
                await permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle);
                
                const lender2LPAfter = await permissionedPool.balanceOf(lenders[0]);
                const lender3LPAfter = await permissionedPool.balanceOf(lenders[1]);
                
                const lender2Burned = lender2LPBefore - lender2LPAfter;
                const lender3Burned = lender3LPBefore - lender3LPAfter;
                
                // accounts[2] should have ~2x the shares burned as accounts[3]
                // Allow some tolerance for rounding
                expect(lender2Burned).to.be.closeTo(lender3Burned * 2n, 5n);
            });

            it("Should handle proportional repay with very small amounts", async function() {
                const lenders = [accounts[0].address, accounts[1].address];
                const totalAssets = 100n; // Very small amount
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(parseEther("1"), accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const totalSupplyBefore = await permissionedPool.totalSupply();

                const lpBalances = await Promise.all(
                    lenders.map(l => permissionedPool.balanceOf(l))
                );

                const lpAmountToSettle = lpBalances.reduce((a,b) => a + b, 0n);
                
                await permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle);
                
                const totalSupplyAfter = await permissionedPool.totalSupply();
                
                // Total supply should decrease (even if by a tiny amount)
                expect(totalSupplyAfter).to.be.lte(totalSupplyBefore);
            });

            it("Should handle proportional repay when one lender owns majority of LP", async function() {
                // accounts[4] deposits a huge amount to own majority
                await permissionedPool.connect(accounts[4]).deposit(parseEther("5000"), accounts[4].address);
                
                const lenders = [accounts[0].address, accounts[4].address, accounts[7].address];
                const totalAssets = parseEther("100");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const lender0LPBefore = await permissionedPool.balanceOf(lenders[0]);
                const lender4LPBefore = await permissionedPool.balanceOf(lenders[1]);
                const lender7LPBefore = await permissionedPool.balanceOf(lenders[2]);

                const lpAmountToSettle = lender0LPBefore + lender4LPBefore + lender7LPBefore;
                
                await permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle);
                
                const lender0Burned = lender0LPBefore - await permissionedPool.balanceOf(lenders[0]);
                const lender4Burned = lender4LPBefore - await permissionedPool.balanceOf(lenders[1]);
                const lender7Burned = lender7LPBefore - await permissionedPool.balanceOf(lenders[2]);
                
                // accounts[4] should have burned significantly more shares
                expect(lender4Burned).to.be.gt(lender0Burned);
                expect(lender4Burned).to.be.gt(lender7Burned);
            });

            it("Should handle proportional repay across many lenders", async function() {
                // Test with 5 lenders
                const lenders = [
                    accounts[0].address,
                    accounts[1].address,
                    accounts[2].address,
                    accounts[3].address,
                    accounts[4].address
                ];
                const totalAssets = parseEther("150");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const lendersBefore = await Promise.all(
                    lenders.map(lender => permissionedPool.balanceOf(lender))
                );

                const lpAmountToSettle = lendersBefore.reduce((a,b) => a + b, 0n);
                
                await expect(permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle))
                    .to.emit(permissionedFundManager, "PMProportionalRepayExecuted");
                
                const lendersAfter = await Promise.all(
                    lenders.map(lender => permissionedPool.balanceOf(lender))
                );
                
                // All lenders with non-zero balance should have decreased
                for (let i = 0; i < lenders.length; i++) {
                    if (lendersBefore[i] > 0n) {
                        expect(lendersAfter[i]).to.be.lt(lendersBefore[i]);
                    }
                }
            });

            it("Should emit correct event data for proportional repay", async function() {
                const lenders = [accounts[0].address, accounts[1].address];
                const totalAssets = parseEther("40");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const expectedShares = await permissionedPool.convertToShares(totalAssets);

                const lpBalances = await Promise.all(
                    lenders.map(l => permissionedPool.balanceOf(l))
                );

                const lpAmountToSettle = lpBalances.reduce((a,b) => a + b, 0n);
                
                const tx = await permissionedFundManager.connect(accounts[17])
                    .pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle);
                
                const receipt = await tx.wait();
                const event = receipt.logs.find(
                    log => log.fragment?.name === "PMProportionalRepayExecuted"
                );
                
                expect(event.args[0]).to.equal(totalAssets); // Total assets repaid
                expect(event.args[1]).to.equal(lpAmountToSettle); // Total assets repaid
                expect(event.args[2]).to.be.closeTo(expectedShares, parseEther("0.01")); // Total shares burned
            });

            it("Should handle proportional repay with unequal LP distributions", async function() {
                // Create scenario with very unequal distributions
                // accounts[5]: 10 LP, accounts[6]: 1000 LP, accounts[8]: 50 LP
                await permissionedPool.connect(accounts[5]).deposit(parseEther("10"), accounts[5].address);
                await permissionedPool.connect(accounts[6]).deposit(parseEther("1000"), accounts[6].address);
                await permissionedPool.connect(accounts[8]).deposit(parseEther("50"), accounts[8].address);
                
                const lenders = [accounts[5].address, accounts[6].address, accounts[8].address];
                const totalAssets = parseEther("100");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const lender5Before = await permissionedPool.balanceOf(lenders[0]);
                const lender6Before = await permissionedPool.balanceOf(lenders[1]);
                const lender8Before = await permissionedPool.balanceOf(lenders[2]);

                const lpAmountToSettle = lender5Before + lender6Before +lender8Before;
                
                await permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle);
                
                const lender5Burned = lender5Before - await permissionedPool.balanceOf(lenders[0]);
                const lender6Burned = lender6Before - await permissionedPool.balanceOf(lenders[1]);
                const lender8Burned = lender8Before - await permissionedPool.balanceOf(lenders[2]);
                
                // accounts[6] should have most burned (largest holder)
                expect(lender6Burned).to.be.gt(lender5Burned);
                expect(lender6Burned).to.be.gt(lender8Burned);
                
                // accounts[8] should have more burned than accounts[5]
                expect(lender8Burned).to.be.gt(lender5Burned);
            });

            it("Should fail proportional repay if fund manager has insufficient balance", async function() {
                const lenders = [accounts[0].address, accounts[1].address];
                const totalAssets = parseEther("10000"); // More than FM has
                
                const fmBalance = await dummy.balanceOf(await permissionedFundManager.getAddress());
                
                // Verify FM doesn't have enough
                expect(fmBalance).to.be.lt(totalAssets);

                const lpBalances = await Promise.all(
                    lenders.map(l => permissionedPool.balanceOf(l))
                );

                const lpAmountToSettle = lpBalances.reduce((a,b) => a + b, 0n);
                
                await expect(
                    permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, lpAmountToSettle)
                ).to.be.reverted;
            });

            it("Should handle proportional repay when lender list has duplicates", async function() {
                // Contract should handle this - burning the same lender twice
                const lenders = [accounts[0].address, accounts[0].address]; // Duplicate
                const totalAssets = parseEther("20");
                
                // Ensure fund manager has liquidity
                await permissionedPool.connect(accounts[0]).deposit(totalAssets, accounts[0].address);
                await permissionedFundManager.connect(accounts[17]).deployFunds();
                const dedicatedWallet = accounts[20];
                const walletBalance = await dummy.balanceOf(dedicatedWallet.address);
                await dummy.connect(dedicatedWallet).approve(await permissionedFundManager.getAddress(), walletBalance);
                await permissionedFundManager.connect(dedicatedWallet).pay("cPool 1", walletBalance, 0);
                
                const lenderBefore = await permissionedPool.balanceOf(accounts[0].address);
                
                // Should process both (same lender gets repaid proportionally twice)
                await permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn(lenders, totalAssets, await permissionedPool.balanceOf(accounts[0].address));
                
                const lenderAfter = await permissionedPool.balanceOf(accounts[0].address);
                
                // Balance should decrease
                expect(lenderAfter).to.be.lt(lenderBefore);
            });

            it("Should fail pmProportionalRepayAndBurn if not admin", async function() {
                await expect(permissionedFundManager.connect(accounts[18]).pmProportionalRepayAndBurn([accounts[0].address], parseEther("10"), await permissionedPool.balanceOf(accounts[0].address)))
                    .to.be.reverted;
            });

            it("Should fail pmProportionalRepayAndBurn with no lenders", async function() {
                await expect(permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn([], parseEther("10"), parseEther("10")))
                    .to.be.revertedWith("No lenders");
            });

            it("Should fail pmProportionalRepayAndBurn with asset as zero amount", async function() {
                await expect(permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn([accounts[0].address], 0, parseEther("10")))
                    .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAmount")
                    .withArgs(0);
            });

            it("Should fail pmProportionalRepayAndBurn with lpAmountToSettle as zero amount", async function() {
                await expect(permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn([accounts[0].address], parseEther("10"), 0))
                    .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAmount")
                    .withArgs(0);
            });

            it("Should revert if lpAmountToSettle does not match lenders LP sum", async function () {
                const lenders = [accounts[0].address, accounts[1].address];
                const totalAssets = parseEther("10");

                const wrongLpAmount = parseEther("1000");

                await expect(
                    permissionedFundManager
                        .connect(accounts[17])
                        .pmProportionalRepayAndBurn(lenders, totalAssets, wrongLpAmount)
                ).to.be.revertedWithCustomError(permissionedFundManager, "InvalidAmount");
            });
        });

        it("Should fail to send to permissioned Reserve if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[18]).sendToV2Reserve(parseEther("100"), 1))
                .to.be.reverted;
        });

        it("Should send to permissioned Reserve", async function() {
            await dummy.mint(await permissionedFundManager.getAddress(), parseEther("100"));
            balanceBefore = await dummy.balanceOf(await permissionedFundManager.getAddress());
            balanceBeforePool = await dummy.balanceOf(await permissionedPool.getAddress());
            await permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("100"), 1);
            expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.be.equal(balanceBefore - parseEther("100"));
            expect(await dummy.balanceOf(await permissionedPool.getAddress())).to.be.equal(balanceBeforePool + parseEther("100"));
        });
    });

    describe("Pausability Tests", async function() {
        it("Should pause contract", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).pause())
                .to.emit(permissionedFundManager, "Paused")
                .withArgs(accounts[17].address);
            expect(await permissionedFundManager.paused()).to.be.true;
        });

        it("Should fail to execute functions if contract is paused", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).deployFunds()).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[20]).pay("cPool 1", parseEther("10"), 0)).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[17]).addPool("cPool 5", 1000, accounts[24].address)).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[17]).removePool(0)).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[17]).updatePoolAllocation(0, 5000)).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[17]).updatePoolWallet("cPool 1", accounts[25].address)).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[17]).sendToV2Reserve(parseEther("10"), 1)).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[17]).pmRepayLender(accounts[0].address, parseEther("10"))).to.be.revertedWith("Pausable: paused");
            await expect(permissionedFundManager.connect(accounts[17]).pmProportionalRepayAndBurn([accounts[0].address], parseEther("10"), parseEther("10"))).to.be.revertedWith("Pausable: paused");
        });

        it("Should fail to pause contract if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[8]).pause()).to.be.reverted;
        });

        it("Should unpause contract", async function() {
            await expect(permissionedFundManager.connect(accounts[17]).unpause())
                .to.emit(permissionedFundManager, "Unpaused")
                .withArgs(accounts[17].address);
            expect(await permissionedFundManager.paused()).to.be.false;
        });

        it("Should fail to unpause contract if not admin", async function() {
            await expect(permissionedFundManager.connect(accounts[8]).unpause()).to.be.reverted;
        });
    });

    describe("Total Assets Tests", async function() {
        it("Should return correct total assets", async function() {
            const fmBalance = await dummy.balanceOf(await permissionedFundManager.getAddress());
            const totalAssets = await permissionedFundManager.totalAssets();
            expect(totalAssets).to.be.equal(fmBalance);
        });

        it("Should not include V1 Diamond balance", async function() {
            // In new contract, totalAssets only returns token balance of fund manager
            // NOT V1 Diamond vault balance
            const totalAssets = await permissionedFundManager.totalAssets();
            const fmBalance = await dummy.balanceOf(await permissionedFundManager.getAddress());
            expect(totalAssets).to.equal(fmBalance);
        });
    });

    describe("Pool Manager Rotation Propagation", async function() {
        let rotSnapshot;

        before(async function() {
            await diamondV1.setPoolManagerData("PM2", accounts[18].address, KYBStatus.VERIFIED);
            await permissionedFactory.addPoolManager("PM2", accounts[18].address);
            rotSnapshot = await network.provider.send("evm_snapshot", []);
        });

        afterEach(async function() {
            await network.provider.send("evm_revert", [rotSnapshot]);
            rotSnapshot = await network.provider.send("evm_snapshot", []);
        });

        it("Should fail FM ops from a verified PM who is not the pool's current PM", async function() {
            await expect(permissionedFundManager.connect(accounts[18]).pause())
                .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAccount")
                .withArgs(accounts[18].address);
        });

        it("Should allow new PM to call FM ops after Pool.updatePoolManager", async function() {
            await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
            await permissionedPool.connect(accounts[0]).updatePoolManager(accounts[18].address);
            await expect(permissionedFundManager.connect(accounts[18]).pause())
                .to.emit(permissionedFundManager, "Paused")
                .withArgs(accounts[18].address);
        });

        it("Should reject old PM from FM ops after rotation", async function() {
            await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
            await permissionedPool.connect(accounts[0]).updatePoolManager(accounts[18].address);
            await expect(permissionedFundManager.connect(accounts[17]).pause())
                .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAccount")
                .withArgs(accounts[17].address);
        });

        it("Should reject FM ops from admin that is not the current PM", async function() {
            await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
            await permissionedPool.connect(accounts[0]).updatePoolManager(accounts[18].address);
            await expect(permissionedFundManager.connect(accounts[17]).pause())
                .to.be.revertedWithCustomError(permissionedFundManager, "InvalidAccount")
                .withArgs(accounts[17].address);
        });

        it("Should keep emergencyWithdraw admin-gated independently of PM rotation", async function() {
            await permissionedPool.connect(accounts[17]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
            await permissionedPool.connect(accounts[0]).updatePoolManager(accounts[18].address);
            await expect(permissionedFundManager.connect(accounts[18]).emergencyWithdraw(await dummy.getAddress(), accounts[18].address, 1))
                .to.be.reverted;
        });
    });

    describe("Implementation Initialization Lock", async function() {
        it("Should fail to re-initialize the FM implementation directly", async function() {
            const factory = await getContractFactory("CsigmaPermissionedFundManager");
            const impl = await factory.deploy();
            await expect(
                impl.initialize(await dummy.getAddress(), await diamondV1.getAddress(), "X", await permissionedPool.getAddress(), accounts[0].address)
            ).to.be.revertedWith("Initializable: contract is already initialized");
        });
    });
});