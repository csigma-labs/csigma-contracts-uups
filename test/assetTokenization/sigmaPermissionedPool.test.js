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

describe("Permissioned-Pool", async function() {
    let accounts, permissionedPool, dummy, permissionedFactory, permissionedFundManager, diamondV1, snapshot;
    
    const KYBStatus = {
        PENDING: 0,
        VERIFIED: 1,
        REJECTED: 2
    };

    before(async function() {
        accounts = await ethers.getSigners();
        
        // Deploy pool
        let poolFactory = await getContractFactory("CsigmaPermissionedPool");
        permissionedPool = await poolFactory.deploy();
        let proxyFactory = await getContractFactory("ERC1967Proxy");
        let proxy = await proxyFactory.deploy(await permissionedPool.getAddress(), "0x");
        permissionedPool = await ethers.getContractAt("CsigmaPermissionedPool", await proxy.getAddress());
        
        // Deploy dummy token
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await dummyFactory.deploy();
        
        // Deploy withdrawal manager
        let withdrawFactory = await getContractFactory("MockWithdrawManager");
        withdrawManager = await withdrawFactory.deploy();
        
        // Deploy fund manager
        let fundManagerFactory = await getContractFactory("MockFundManager");
        permissionedFundManager = await fundManagerFactory.deploy(await dummy.getAddress());
        
        // Deploy factory
        let factoryFactory = await getContractFactory("MockFactory");
        permissionedFactory = await factoryFactory.deploy();
        
        // Deploy Diamond V1
        let v1DiamondFactory = await getContractFactory("MockV1");
        let mockDiamond = await v1DiamondFactory.deploy();
        diamondV1 = await mockDiamond.getAddress();
        
        // Set diamond in factory
        await permissionedFactory.setDiamondV1(diamondV1);
        
        // Initialize pool (NO projectedAPY parameter)
        await permissionedFactory.initializePermissionedPool(
            await permissionedPool.getAddress(),
            "Dummy Pool",
            "DPT",
            accounts[0].address, // pool manager gets admin role
            await permissionedFundManager.getAddress(),
            await dummy.getAddress(),
            accounts[2].address, // oracle manager
            parseEther("10000") // pool size
        );
        
        await permissionedFactory.setWithdrawalManager(await permissionedPool.getAddress(), await withdrawManager.getAddress());
        // Operational setters are now onlyPoolManager; accounts[0] is the PM (set as admin AND PM at init via initializePermissionedPool)
        await permissionedPool.updateNonReservePercentage(8000);
        expect(await permissionedPool.nonReservePercentage()).to.equal(8000);
        await permissionedPool.updateNonReservePercentage(9000);
    });

    it("Should have initialized correctly", async function() {
        expect(await permissionedPool.factory()).to.be.equal(await permissionedFactory.getAddress());
        expect(await permissionedPool.fundManager()).to.be.equal(await permissionedFundManager.getAddress());
        expect(await permissionedPool.asset()).to.be.equal(await dummy.getAddress());
        expect(await permissionedPool.poolSize()).to.be.equal(parseEther("10000"));
        expect(await permissionedPool.AUMChangeThresholdPercentage()).to.be.equal("10080");
        expect(await permissionedPool.AUMUpdateCooldownPeriod()).to.be.equal("2700");
        expect(await permissionedPool.nonReservePercentage()).to.be.equal("9000");
        expect(await permissionedPool.pauseDuration()).to.be.equal("1800");
        expect(await permissionedPool.hasRole(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[2].address)).to.be.true;
        expect(await permissionedPool.hasRole(await permissionedPool.ROLE_ORACLE_MANAGER(), await permissionedFundManager.getAddress())).to.be.true;
        expect(await permissionedPool.hasRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.be.true;
    });

    describe("cSigma Permissioned Pool", async function() {
        before(async function () {
            for(i = 0; i < 6; i++)
                await dummy.mint(accounts[i].address, parseEther("10000"));
            
            // Setup Diamond with lender data
            let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
            for(i = 0; i < 6; i++) {
                await mockDiamond.setLenderData(`LENDER00${i}`, accounts[i].address, KYBStatus.VERIFIED);
            }
        });

        it("Should fail when activator is not factory", async function() {
            await expect(permissionedPool.connect(accounts[10]).activatePool()).to.be.revertedWithCustomError(permissionedPool, "AccessDenied").withArgs(accounts[10].address);
        });

        it("Should Activate Pool using factory", async function() {
            await expect(permissionedFactory.activatePool(await permissionedPool.getAddress())).to.emit(permissionedPool, "PoolStatusUpdated");
            expect(await permissionedPool.status()).to.equal(1);
            snapshot = await network.provider.request({method: "evm_snapshot", params:[]});            
        });

        it("Should fail if pool not in pending state", async function() {
            await expect(permissionedFactory.activatePool(await permissionedPool.getAddress())).to.be.revertedWithCustomError(permissionedPool, "InvalidStatusUpdate");
        });

        describe("Lender Whitelisting", async function() {
            it("Should add whitelisted lender with valid Diamond data", async function() {
                await expect(permissionedPool.addWhitelistLender("LENDER000", accounts[0].address))
                    .to.emit(permissionedPool, "LenderAdded")
                    .withArgs("LENDER000", accounts[0].address);
                expect(await permissionedPool.isLenderWhitelisted(accounts[0].address)).to.be.true;
            });

            it("Should fail to add lender if not admin", async function() {
                await expect(permissionedPool.connect(accounts[1]).addWhitelistLender("LENDER001", accounts[1].address)).to.be.reverted;
            });

            it("Should fail to add lender if zero address", async function() {
                await expect(permissionedPool.addWhitelistLender("LENDER002", ethers.ZeroAddress))
                    .to.be.revertedWithCustomError(permissionedPool, "InvalidAddress")
                    .withArgs(ethers.ZeroAddress);
            });

            it("Should fail to add lender if already whitelisted", async function() {
                await expect(permissionedPool.addWhitelistLender("LENDER000", accounts[0].address))
                    .to.be.revertedWithCustomError(permissionedPool, "InvalidAddress")
                    .withArgs(accounts[0].address);
            });

            it("Should pass to add lender if wallet doesn't match Diamond", async function() {
                let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
                await mockDiamond.setLenderData("LENDER007", accounts[7].address, KYBStatus.VERIFIED);
                
                await expect(permissionedPool.addWhitelistLender("LENDER007", accounts[27].address))
                    .to.be.not.reverted;
            });

            it("Should fail to add lender if KYB status not VERIFIED", async function() {
                let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
                await mockDiamond.setLenderData("LENDER008", accounts[8].address, KYBStatus.PENDING);
                
                await expect(permissionedPool.addWhitelistLender("LENDER008", accounts[8].address))
                    .to.be.revertedWithCustomError(permissionedPool, "LenderNotVerified")
                    .withArgs("LENDER008");
            });

            it("Should remove whitelisted lender", async function() {
                await expect(permissionedPool.removeWhitelistLender(accounts[0].address))
                    .to.emit(permissionedPool, "LenderRemoved")
                    .withArgs(accounts[0].address);
                expect(await permissionedPool.isLenderWhitelisted(accounts[0].address)).to.be.false;
            });

            it("Should fail to remove lender if not whitelisted", async function() {
                await expect(permissionedPool.removeWhitelistLender(accounts[0].address))
                    .to.be.revertedWithCustomError(permissionedPool, "InvalidAddress")
                    .withArgs(accounts[0].address);
            });

            it("Should update lender wallet (wallet rotation)", async function() {
                // Re-add lender
                await permissionedPool.addWhitelistLender("LENDER000", accounts[0].address);
                
                // Update Diamond to new wallet
                let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
                await mockDiamond.setLenderData("LENDER000", accounts[10].address, KYBStatus.VERIFIED);

                await permissionedPool.removeWhitelistLender(accounts[0].address);
                await permissionedPool.addWhitelistLender("LENDER000",accounts[10].address);
                
                // await expect(permissionedPool.updateWhitelistLender("LENDER000", accounts[0].address, accounts[10].address))
                //     .to.emit(permissionedPool, "LenderRemoved")
                //     .withArgs(accounts[0].address)
                //     .and.to.emit(permissionedPool, "LenderAdded")
                //     .withArgs("LENDER000", accounts[10].address);
                
                expect(await permissionedPool.isLenderWhitelisted(accounts[0].address)).to.be.false;
                expect(await permissionedPool.isLenderWhitelisted(accounts[10].address)).to.be.true;
                
                // Restore for subsequent tests
                await mockDiamond.setLenderData("LENDER000", accounts[0].address, KYBStatus.VERIFIED);
                // await permissionedPool.updateWhitelistLender("LENDER000", accounts[10].address, accounts[0].address);
                await permissionedPool.removeWhitelistLender(accounts[10].address);
                await permissionedPool.addWhitelistLender("LENDER000",accounts[0].address);
            });

            // Whitelist all test lenders for subsequent tests
            before(async function() {
                for(i = 0; i < 6; i++) {
                    if (i === 0) continue; // already whitelisted above
                    await permissionedPool.addWhitelistLender(`LENDER00${i}`, accounts[i].address);
                }
            });
        });

        describe("Deposit", async function() {
            before(async function() {
                // Pool manager grants roles directly
                await permissionedPool.grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[9].address);
                await permissionedPool.grantRole(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[13].address);
            });
            
            it("Users can deposit/mint", async function() {
                await dummy.approve(await permissionedPool.getAddress(), parseEther("1000"));
                await expect(permissionedPool.deposit(parseEther("200"), accounts[0].address)).to.emit(permissionedPool, "Deposit").withArgs(accounts[0].address, accounts[0].address, parseEther("200"), parseEther("200"));
                // NO updateInitialDepositTime in new contract
                expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.equal(parseEther("180"));
                expect(await dummy.balanceOf(await permissionedPool.getAddress())).to.equal(parseEther("20"));
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("200"));

                await dummy.connect(accounts[3]).approve(await permissionedPool.getAddress(), parseEther("5000"));
                await expect(permissionedPool.connect(accounts[3]).mint(parseEther("5000"), accounts[3].address)).to.emit(permissionedPool, "Deposit").withArgs(accounts[3].address, accounts[3].address, parseEther("5000"), parseEther("5000"));
                expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.equal(parseEther("4680"));
                expect(await dummy.balanceOf(await permissionedPool.getAddress())).to.equal(parseEther("520"));
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("5200"));
            });

            it("Should fail deposit from non-whitelisted address", async function() {
                let mockDiamond = await ethers.getContractAt("MockV1", diamondV1);
                await mockDiamond.setLenderData("LENDER099", accounts[12].address, KYBStatus.VERIFIED);
                
                await dummy.mint(accounts[12].address, parseEther("1000"));
                await dummy.connect(accounts[12]).approve(await permissionedPool.getAddress(), parseEther("100"));
                await expect(permissionedPool.connect(accounts[12]).deposit(parseEther("100"), accounts[12].address))
                    .to.be.revertedWithCustomError(permissionedPool, "AccessDenied")
                    .withArgs(accounts[12].address);

                await expect(permissionedPool.connect(accounts[12]).deposit(parseEther("100"), accounts[12].address))
                    .to.be.revertedWithCustomError(permissionedPool, "AccessDenied")
                    .withArgs(accounts[12].address);
            });

            it("Should fail when updating AUM without oracle manager", async function () {
                await expect(permissionedPool.updateAssetUnderManagement(parseEther("100"))).to.be.reverted;
            });

            it("Should fail to update asset under management if threshold exceeds", async function() {
                await expect(permissionedPool.connect(accounts[2]).updateAssetUnderManagement(parseEther("100"))).to.be.revertedWith("Threshold not met");
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("5200"));
                // PM (accounts[0]) tunes the threshold — updateAUMChangeThresholdPercentage is onlyPoolManager
                await permissionedPool.updateAUMChangeThresholdPercentage(10000);
            });

            it("Should update asset under management", async function() {
                await permissionedFundManager.updateAUM(parseEther("50"), await permissionedPool.getAddress());
                await expect(permissionedPool.connect(accounts[2]).updateAssetUnderManagement(parseEther("50"))).to.emit(permissionedPool, "AssetUnderManagementUpdated").withArgs(accounts[2].address, parseEther("50"), parseEther("50"));
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("5250"));
            });

            it("Should allow to update asset under management within threshold limits", async function () {
                await increase(2 * 86400);
                await permissionedPool.emergencyUpdateAUM(ethers.parseEther("100"));
                await expect(permissionedPool.connect(accounts[1]).emergencyUpdateAUM(ethers.parseEther("100"))).to.be.reverted;
                // PM (accounts[0]) tunes the threshold — onlyPoolManager
                await permissionedPool.updateAUMChangeThresholdPercentage(5000);

                // Should fail if outside bounds
                await expect(permissionedPool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("151"))).to.be.revertedWith("Threshold not met");
                await expect(permissionedPool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("49"))).to.be.revertedWith("Threshold not met");
                
                // Should succeed within bounds
                await permissionedPool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("150"));
                expect(await permissionedPool.totalAssets()).to.equal(ethers.parseEther("5350"));
                
                await increase(2 * 86400);
                await permissionedPool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("100"));
                expect(await permissionedPool.totalAssets()).to.equal(ethers.parseEther("5300"));

                await permissionedPool.updateAUMChangeThresholdPercentage(10000);
            });

            it("Should fail to update asset under management if cooldown period is not met", async function() {
                await expect(permissionedPool.connect(accounts[2]).updateAssetUnderManagement(parseEther("100"))).to.be.revertedWith("Cooldown period not elapsed");
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("5300"));
            });

            it("Should update asset under management after cooldown period", async function() {
                await increase(2 * 86400);
                await permissionedPool.emergencyUpdateAUM(ethers.parseEther("50"));
                await expect(permissionedPool.connect(accounts[2]).updateAssetUnderManagement(parseEther("100"))).to.emit(permissionedPool, "AssetUnderManagementUpdated").withArgs(accounts[2].address, parseEther("50"), parseEther("100"));
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("5300"));
            });

            it("Users can deposit after share/asset imbalance", async function() {
                shares = await permissionedPool.convertToShares(parseEther("200"));
                await expect(permissionedPool.deposit(parseEther("200"), accounts[0].address)).to.emit(permissionedPool, "Deposit").withArgs(accounts[0].address, accounts[0].address, parseEther("200"), shares);
                expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.equal(parseEther("4860"));
                expect(await dummy.balanceOf(await permissionedPool.getAddress())).to.equal(parseEther("540"));
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("5500"));

                assets = await permissionedPool.convertToAssets(parseEther("1000")) + 1n;
                await dummy.connect(accounts[3]).approve(await permissionedPool.getAddress(), assets);
                await expect(permissionedPool.connect(accounts[3]).mint(parseEther("1000"), accounts[3].address)).to.emit(permissionedPool, "Deposit").withArgs(accounts[3].address, accounts[3].address, assets, parseEther("1000"));
                expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.equal(parseEther("4860") + (assets * 9n) / 10n);
                expect(await dummy.balanceOf(await permissionedPool.getAddress())).to.equal(parseEther("540") + assets / 10n);
                expect(await permissionedPool.totalAssets()).to.equal(parseEther("5500") + assets);
            });

            it("Deposit should revert if it exceeds pool size", async function() {
                await dummy.connect(accounts[4]).approve(await permissionedPool.getAddress(), parseEther("10000"));
                await expect(permissionedPool.connect(accounts[4]).deposit(parseEther("10000"), accounts[4].address)).to.be.revertedWith("ERC4626: deposit more than max");
            });

            it("Deposit should revert if less than minimum deposit", async function(){
                await permissionedPool.updateMinimumInvestmentLimit(parseEther("10"));
                await dummy.connect(accounts[4]).approve(await permissionedPool.getAddress(), parseEther("7000"));
                await expect(permissionedPool.connect(accounts[4]).deposit(7, accounts[4].address)).to.be.revertedWithCustomError(permissionedPool, "InvalidDepositAmount").withArgs(7);
                await expect(permissionedPool.connect(accounts[4]).mint(7, accounts[4].address)).to.be.revertedWithCustomError(permissionedPool, "InvalidDepositAmount").withArgs(8);
            });

            it("Deposit after change of reserve percentage", async function() {
                initialFundManagerBalance = await dummy.balanceOf(await permissionedFundManager.getAddress());
                initialPoolBalance = await dummy.balanceOf(await permissionedPool.getAddress());
                initialTotalAssets = await permissionedPool.totalAssets();
                // PM (accounts[0]) tunes the reserve percentage — onlyPoolManager
                await permissionedPool.updateNonReservePercentage(7000);
                await dummy.connect(accounts[4]).approve(await permissionedPool.getAddress(), parseEther("1000"));
                await permissionedPool.connect(accounts[4]).deposit(parseEther("1000"), accounts[4].address);
                expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.equal(initialFundManagerBalance + parseEther("700"));
                expect(await dummy.balanceOf(await permissionedPool.getAddress())).to.equal(initialPoolBalance + parseEther("300"));
                expect(await permissionedPool.totalAssets()).to.equal(initialTotalAssets + parseEther("1000"));
            });
        });

        describe("PM Repay and Burn", async function () {
            let lenderShares;

            before(async function () {
                lenderShares = await permissionedPool.balanceOf(accounts[3].address);
                expect(lenderShares).to.be.gt(0);
            });

            it("Should fail pmRepayAndBurn if caller is not fund manager", async function () {
                await expect(
                    permissionedPool.pmRepayAndBurn(accounts[3].address, parseEther("10"))
                ).to.be.revertedWithCustomError(permissionedPool, "AccessDenied").withArgs(accounts[0].address);
            });

            it("Should allow fund manager to pmRepayAndBurn", async function () {
                const burnAmount = parseEther("100");
                const assetsRepaid = await permissionedPool.convertToAssets(burnAmount);
                const totalSupplyBefore = await permissionedPool.totalSupply();
                const balanceBefore = await permissionedPool.balanceOf(accounts[3].address);
                const lenderAssetBalanceBefore = await dummy.balanceOf(accounts[3].address);
                const poolAssetBalanceBefore = await dummy.balanceOf(await permissionedPool.getAddress());

                await expect(
                    permissionedFundManager.pmRepayAndBurn(await permissionedPool.getAddress(), accounts[3].address, burnAmount)
                )
                    .to.emit(permissionedPool, "PMRepayAndBurn")
                    .withArgs(accounts[3].address, burnAmount, assetsRepaid);

                expect(await permissionedPool.balanceOf(accounts[3].address)).to.equal(balanceBefore - burnAmount);
                expect(await permissionedPool.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
                // Lender receives assets from pool
                expect(await dummy.balanceOf(accounts[3].address)).to.equal(lenderAssetBalanceBefore + assetsRepaid);
                // Pool balance decreases
                expect(await dummy.balanceOf(await permissionedPool.getAddress())).to.equal(poolAssetBalanceBefore - assetsRepaid);
            });

            it("Should fail pmRepayAndBurn if lender not whitelisted", async function () {
                await expect(
                    permissionedFundManager.pmRepayAndBurn(await permissionedPool.getAddress(), accounts[14].address, parseEther("10"))
                ).to.be.revertedWithCustomError(permissionedPool, "AccessDenied").withArgs(accounts[14].address);
            });

            it("Should fail pmRepayAndBurn if insufficient LP balance", async function () {
                const balance = await permissionedPool.balanceOf(accounts[3].address);
                await expect(
                    permissionedFundManager.pmRepayAndBurn(await permissionedPool.getAddress(), accounts[3].address, balance + 1n)
                ).to.be.revertedWithCustomError(permissionedPool, "InsufficientLPTokens")
                    .withArgs(accounts[3].address, balance + 1n, balance);
            });

            it("Should fail pmRepayAndBurn with zero amount", async function () {
                await expect(
                    permissionedFundManager.pmRepayAndBurn(await permissionedPool.getAddress(), accounts[3].address, 0)
                ).to.be.revertedWithCustomError(permissionedPool, "ZeroAmount");
            });

            it("Should fail pmRepayAndBurn if caller is not fund manager", async function () {
                await expect(
                    permissionedPool.connect(accounts[1]).pmRepayAndBurn(accounts[3].address, parseEther("10"))
                ).to.be.revertedWithCustomError(permissionedPool, "AccessDenied").withArgs(accounts[1].address);
            });
        });

        describe("Burn From Compromised", async function () {
            let compromisedUser;
            let burnAmount;

            before(async function () {
                compromisedUser = accounts[4].address;
                burnAmount = parseEther("50");
                expect(await permissionedPool.balanceOf(compromisedUser)).to.be.gte(burnAmount);
            });

            it("Should allow admin to burn LP from compromised address", async function () {
                const totalSupplyBefore = await permissionedPool.totalSupply();
                const balanceBefore = await permissionedPool.balanceOf(compromisedUser);

                await expect(
                    permissionedPool.burnFromCompromissed(compromisedUser, burnAmount)
                )
                    .to.emit(permissionedPool, "BurnFromCompromissedExecuted")
                    .withArgs(await permissionedPool.getAddress(), compromisedUser, burnAmount);

                expect(await permissionedPool.balanceOf(compromisedUser)).to.equal(balanceBefore - burnAmount);
                expect(await permissionedPool.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
            });

            it("Should fail burnFromCompromissed if not admin", async function () {
                await expect(
                    permissionedPool.connect(accounts[1]).burnFromCompromissed(compromisedUser, 1)
                ).to.be.reverted;
            });
        });

        describe("Withdraw", async function() {
            it("Should be able to withdraw/redeem", async function() {
                shares = await permissionedPool.balanceOf(accounts[0].address);
                dummyBalance = await dummy.balanceOf(accounts[0].address);
                usedShares = await permissionedPool.convertToShares(parseEther("100")) + 1n;
                await expect(permissionedPool.withdraw(parseEther("100"), accounts[0].address, accounts[0].address)).to.emit(permissionedPool, "Withdraw").withArgs(accounts[0].address, accounts[0].address, accounts[0].address, parseEther("100"), usedShares);
                expect(await permissionedPool.balanceOf(accounts[0].address)).to.equal(shares - usedShares);
                expect(await dummy.balanceOf(accounts[0].address)).to.equal(dummyBalance + parseEther("100"));

                dummyBalance = await dummy.balanceOf(accounts[3].address);
                shares = await permissionedPool.balanceOf(accounts[3].address);
                assets = await permissionedPool.convertToAssets(parseEther("400"));
                await expect(permissionedPool.connect(accounts[3]).redeem(parseEther("400"), accounts[3].address, accounts[3].address)).to.emit(permissionedPool, "Withdraw").withArgs(accounts[3].address, accounts[3].address, accounts[3].address, assets, parseEther("400"));
                expect(await permissionedPool.balanceOf(accounts[3].address)).to.equal(shares - parseEther("400"));
                expect(await dummy.balanceOf(accounts[3].address)).to.equal(dummyBalance + assets);
            });

            it("Should fail if insufficient balance", async function () {
                await expect(permissionedPool.connect(accounts[3]).redeem(await permissionedPool.balanceOf(accounts[3]) + 20n, accounts[3], accounts[3])).to.be.reverted;
            });

            it("Should fail if insufficient pool balance", async function () {
                await expect(permissionedPool.connect(accounts[3]).redeem(await permissionedPool.balanceOf(accounts[3]), accounts[3], accounts[3])).to.be.reverted;
            });

            it("Should fail withdraw from non-whitelisted address", async function() {
                await expect(permissionedPool.connect(accounts[12]).withdraw(parseEther("10"), accounts[12].address, accounts[12].address))
                    .to.be.revertedWithCustomError(permissionedPool, "AccessDenied")
                    .withArgs(accounts[12].address);
            });
        });

        describe("LP Token Transfer Restrictions", async function () {
            it("Should allow transfer between whitelisted lenders", async function () {
                const transferAmount = parseEther("10");
                const balanceBefore = await permissionedPool.balanceOf(accounts[1].address);
                
                await permissionedPool.connect(accounts[0]).transfer(accounts[1].address, transferAmount);
                
                expect(await permissionedPool.balanceOf(accounts[1].address)).to.equal(balanceBefore + transferAmount);
            });

            it("Should fail transfer to non-whitelisted address", async function () {
                await expect(
                    permissionedPool.connect(accounts[0]).transfer(accounts[12].address, parseEther("1"))
                ).to.be.revertedWithCustomError(permissionedPool, "AccessDenied").withArgs(accounts[12].address);
            });

            it("Should fail transfer from non-whitelisted address", async function () {
                await expect(
                    permissionedPool.connect(accounts[12]).transfer(accounts[0].address, parseEther("1"))
                ).to.be.revertedWithCustomError(permissionedPool, "AccessDenied").withArgs(accounts[12].address);
            });
        });

        describe("Access Control Tests", async function () {

            it("Should Grant ROLE_ORACLE_MANAGER using Admin", async function() {
                await expect(permissionedPool.grantRole(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[19].address))
                    .to.emit(permissionedPool, "RoleGranted")
                    .withArgs(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[19].address, accounts[0].address);
                expect(await permissionedPool.isOracleManager(accounts[19])).to.be.true;
                expect(await permissionedPool.isOracleManager(accounts[0])).to.be.false;
            });
    
            it("Should Grant DEFAULT_ADMIN_ROLE", async function() {
                await expect(permissionedPool.grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[19].address))
                    .to.emit(permissionedPool, "RoleGranted")
                    .withArgs(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[19].address, accounts[0].address);
            });
    
            it("Should fail to grant role if not admin", async function () {
                await expect(permissionedPool.connect(accounts[1]).grantRole(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[18].address)).to.be.reverted;
                await expect(permissionedPool.connect(accounts[1]).grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.reverted;
            });
    
            it("Should Revoke role", async function () {
                await expect(permissionedPool.revokeRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[19].address))
                    .to.emit(permissionedPool, "RoleRevoked")
                    .withArgs(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[19].address, accounts[0].address);
                await expect(permissionedPool.revokeRole(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[19].address))
                    .to.emit(permissionedPool, "RoleRevoked")
                    .withArgs(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[19].address, accounts[0].address);
            });
    
            it("Should update pool size", async function() {
                await permissionedPool.updatePoolSize(parseEther("20000"));
                expect(await permissionedPool.poolSize()).to.equal(parseEther("20000"));
            });
    
            it("Update pool size should fail if not admin", async function() {
                await expect(permissionedPool.connect(accounts[11]).updatePoolSize(parseEther("30000"))).to.be.reverted;
                expect(await permissionedPool.poolSize()).to.equal(parseEther("20000"));
            });

            it("Should update pool's AUM update threshold", async function() {
                await permissionedPool.updateAUMChangeThresholdPercentage(20000);
                expect(await permissionedPool.AUMChangeThresholdPercentage()).to.equal(30000);
            });
    
            it("Update pool's AUM update threshold should fail if not admin", async function() {
                await expect(permissionedPool.connect(accounts[11]).updateAUMChangeThresholdPercentage(30000)).to.be.reverted;
                expect(await permissionedPool.AUMChangeThresholdPercentage()).to.equal(30000);
            });

            it("Should update pool's AUM update cooldown period", async function() {
                await permissionedPool.updateAUMUpdateCooldownPeriod(2*86400);
                expect(await permissionedPool.AUMUpdateCooldownPeriod()).to.equal(2 * 86400);
            });
    
            it("Update pool's AUM update cooldown period should fail if not admin", async function() {
                await expect(permissionedPool.connect(accounts[11]).updateAUMUpdateCooldownPeriod(30000)).to.be.reverted;
                expect(await permissionedPool.AUMUpdateCooldownPeriod()).to.equal(2 * 86400);
            });

            it("Fail to set WithdrawalManager if already set", async function() {
                await expect(permissionedFactory.setWithdrawalManager(await permissionedPool.getAddress(), await withdrawManager.getAddress())).to.be.reverted;
            });

            it("Fail to set WithdrawalManager if caller is not factory", async function() {
                await expect(permissionedPool.setWithdrawalManager(await withdrawManager.getAddress())).to.be.revertedWithCustomError(permissionedPool, "AccessDenied").withArgs(accounts[0].address);
            });

            it("Should update pause duration if called by admin", async function() {
                await permissionedPool.updatePauseDuration(100);
                expect(await permissionedPool.pauseDuration()).to.equal(100);
            });

            it("Should fail if updating pause duration without admin", async function() {
                await expect(permissionedPool.connect(accounts[11]).updatePauseDuration(100)).to.be.reverted;
            });

            it("Should update pause start time if called by admin", async function() {
                await permissionedPool.updatePauseStartTime(100);
                expect(await permissionedPool.pauseStartTime()).to.equal(100);
            });

            it("Should fail if updating pause start time without admin", async function() {
                await expect(permissionedPool.connect(accounts[11]).updatePauseStartTime(100)).to.be.reverted;
            });
                
            it("Update Pool size should fail if less than current invested value", async function() {
                await expect(permissionedPool.updatePoolSize(parseEther("1"))).to.be.reverted;
                expect(await permissionedPool.poolSize()).to.equal(parseEther("20000"));
            });

            it("Should update minimum investment limit if called by admin", async function() {
                await expect(permissionedPool.updateMinimumInvestmentLimit(parseEther("100"))).to.emit(permissionedPool, "MinimumInvestmentLimitUpdated").withArgs(accounts[0].address, parseEther("10"), parseEther("100"));
                expect(await permissionedPool.minimumInvestmentLimit()).to.equal(parseEther("100"));
            });

            it("Should fail if updating minimum investment limit without admin", async function() {
                await expect(permissionedPool.connect(accounts[11]).updateMinimumInvestmentLimit(parseEther("100"))).to.be.reverted;
            });

            // NO pool manager can update minimum investment limit in new contract
    
            it("Should add oracle manager", async function (){
                await expect(permissionedPool.addOracleManager(accounts[10].address)).to.emit(permissionedPool, "RoleGranted").withArgs(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[10].address, await accounts[0].address);
            });
    
            it("Should fail if adding oracle manager without admin", async function() {
                await expect(permissionedPool.connect(accounts[10]).addOracleManager(accounts[11].address)).to.be.reverted;
            })
    
            it("Should remove oracle manager", async function (){
                await expect(permissionedPool.removeOracleManager(accounts[10].address)).to.emit(permissionedPool, "RoleRevoked").withArgs(await permissionedPool.ROLE_ORACLE_MANAGER(), accounts[10].address, await accounts[0].address);
            });
    
            it("Should fail if removing oracle manager without admin", async function() {
                await expect(permissionedPool.connect(accounts[10]).removeOracleManager(accounts[10].address)).to.be.reverted;
            });
    
            it("Should emergency withdraw funds", async function() {
                balance = await dummy.balanceOf(accounts[14].address);
                await expect(permissionedPool.emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5"))).to.emit(permissionedPool, "EmergencyWithdraw").withArgs(await dummy.getAddress(), accounts[14].address, parseEther("5"));
                expect(await dummy.balanceOf(accounts[14].address)).to.equal(balance + parseEther("5"));
            });
    
            it("Should fail if withdrawing without admin", async function(){
                await expect(permissionedPool.connect(accounts[14]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5"))).to.be.reverted;
            });

            it("Should send Reserve amount to fund manager", async function() {
                balance = await dummy.balanceOf(await permissionedFundManager.getAddress());
                const reservebalanceBefore = await permissionedPool.maxWithdraw(accounts[0]);
                // NOTE: In new contract, only ADMIN can call this, not pool manager
                await expect(permissionedPool.sendReserveToFundManager(parseEther("5"))).to.emit(permissionedPool, "SendReserveToFundManager").withArgs(await permissionedFundManager.getAddress(), parseEther("5"));
                expect(await dummy.balanceOf(await permissionedFundManager.getAddress())).to.equal(balance + parseEther("5"));
                expect(await permissionedPool.maxWithdraw(accounts[0])).to.equal(reservebalanceBefore - parseEther("5"));
            });
    
            it("Should fail to send Reserve amount to fund manager if without admin", async function(){
                await expect(permissionedPool.connect(accounts[10]).sendReserveToFundManager(parseEther("5"))).to.be.reverted;
            });
    
            it("Should transfer admin", async function() {
                await expect(permissionedPool.transferAdmin(accounts[7].address)).to.emit(permissionedPool, "AdminTransferred").withArgs(accounts[0].address, accounts[7].address);
                expect(await permissionedPool.hasRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.be.false;
                expect(await permissionedPool.hasRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.be.true;
            });

        });
    
        describe("Pausability", async function() {
            before(async function() {
                await permissionedPool.connect(accounts[7]).transferAdmin(accounts[0].address);
            });
        
            it("Should fail to deposit in the default pause window", async function() {
                await permissionedPool.updatePauseStartTime(await latest() % 86400 - 50);
                await permissionedPool.updatePauseDuration(100);
                await expect(permissionedPool.deposit(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(permissionedPool.mint(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Should fail to withdraw in the default pause window", async function() {
                await expect(permissionedPool.withdraw(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(permissionedPool.redeem(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Should be able to pause/unpause in the default pause window", async function() {
                await expect(permissionedPool.pause()).to.emit(permissionedPool, "Paused").withArgs(accounts[0].address);
                expect(await permissionedPool.paused()).to.be.true;
                await expect(permissionedPool.unpause()).to.emit(permissionedPool, "Unpaused").withArgs(accounts[0].address);
                expect(await permissionedPool.paused()).to.be.false;
                await increase(100);
            });
    
            it("Should fail to pause the contract if not admin", async function() {
                await expect(permissionedPool.connect(accounts[7]).pause()).to.be.reverted;
            });

            it("Should fail to pause the contract if not oracle Manager", async function() {
                await expect(permissionedPool.connect(accounts[7]).pause()).to.be.reverted;
            });

            it("Should be able to pause/unpause in the default pause window via oracle Manager", async function() {
                await expect(permissionedPool.connect(accounts[2]).pause()).to.emit(permissionedPool, "Paused").withArgs(accounts[2].address);
                expect(await permissionedPool.paused()).to.be.true;
                await expect(permissionedPool.connect(accounts[2]).unpause()).to.emit(permissionedPool, "Unpaused").withArgs(accounts[2].address);
                expect(await permissionedPool.paused()).to.be.false;
                await increase(100);
            });

            it("Should Pause the contract", async function() {
                await expect(permissionedPool.pause()).to.emit(permissionedPool, "Paused").withArgs(accounts[0].address);
                expect(await permissionedPool.paused()).to.be.true;
            });

            it("Deposit should fail in paused state", async function() {
                await expect(permissionedPool.deposit(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(permissionedPool.mint(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Withdraw should fail in paused state", async function() {
                await expect(permissionedPool.withdraw(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(permissionedPool.redeem(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
            });
    
            it("Granting role should fail in paused state", async function(){
                await expect(permissionedPool.grantRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.revertedWith("Pausable: paused");
            });
    
            it("Revoking role should fail in paused state", async function(){
                await expect(permissionedPool.revokeRole(await permissionedPool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.revertedWith("Pausable: paused");
            });
    
            it("Should Unpause the contract", async function() {
                await expect(permissionedPool.unpause()).to.emit(permissionedPool, "Unpaused").withArgs(accounts[0].address);
                expect(await permissionedPool.paused()).to.be.false;
                await dummy.connect(accounts[3]).approve(await permissionedPool.getAddress(), parseEther("100"));
                await expect(permissionedPool.connect(accounts[3]).deposit(parseEther("100"), accounts[0])).to.be.not.reverted;
                await expect(permissionedPool.connect(accounts[3]).withdraw(parseEther("100"), accounts[0], accounts[3])).to.be.not.reverted;
            });
        });

        describe("Pool Manager Separation", async function() {
            let pmSnapshot;

            before(async function() {
                await permissionedFactory.setPoolManager(accounts[14].address, true);
                pmSnapshot = await network.provider.send("evm_snapshot", []);
            });

            afterEach(async function() {
                await network.provider.send("evm_revert", [pmSnapshot]);
                pmSnapshot = await network.provider.send("evm_snapshot", []);
            });

            it("Should initialize poolManager to the address passed at init", async function() {
                expect(await permissionedPool.poolManager()).to.equal(accounts[0].address);
            });

            it("Should rotate poolManager when called by admin", async function() {
                await expect(permissionedPool.updatePoolManager(accounts[14].address))
                    .to.emit(permissionedPool, "PoolManagerUpdated")
                    .withArgs(accounts[0].address, accounts[14].address);
                expect(await permissionedPool.poolManager()).to.equal(accounts[14].address);
            });

            it("Should fail to update poolManager if not admin", async function() {
                await expect(permissionedPool.connect(accounts[3]).updatePoolManager(accounts[14].address))
                    .to.be.reverted;
            });

            it("Should fail to update poolManager if zero address", async function() {
                await expect(permissionedPool.updatePoolManager(ethers.ZeroAddress))
                    .to.be.revertedWith("poolManager: zero address");
            });

            it("Should fail to update poolManager if new PM is not in factory.isPoolManager", async function() {
                await expect(permissionedPool.updatePoolManager(accounts[15].address))
                    .to.be.revertedWithCustomError(permissionedPool, "InvalidAddress")
                    .withArgs(accounts[15].address);
            });

            it("Should allow new PM to call onlyPoolManager functions after rotation", async function() {
                await permissionedPool.updatePoolManager(accounts[14].address);
                await permissionedPool.connect(accounts[14]).updateNonReservePercentage(8500);
                expect(await permissionedPool.nonReservePercentage()).to.equal(8500);
            });

            it("Should reject old PM from onlyPoolManager functions after rotation", async function() {
                await permissionedPool.updatePoolManager(accounts[14].address);
                await expect(permissionedPool.updateNonReservePercentage(8000))
                    .to.be.revertedWithCustomError(permissionedPool, "AccessDenied")
                    .withArgs(accounts[0].address);
            });

            it("Should allow admin to call emergency functions after rotation", async function() {
                await permissionedPool.updatePoolManager(accounts[14].address);
                await expect(permissionedPool.emergencyUpdateAUM(parseEther("123")))
                    .to.emit(permissionedPool, "AssetUnderManagementUpdated");
            });

            it("Should reject PM from calling emergency functions", async function() {
                await permissionedPool.updatePoolManager(accounts[14].address);
                await expect(permissionedPool.connect(accounts[14]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address, 1))
                    .to.be.reverted;
                await expect(permissionedPool.connect(accounts[14]).emergencyUpdateAUM(parseEther("1")))
                    .to.be.reverted;
            });

            it("Should allow PM to pause and unpause", async function() {
                await permissionedPool.updatePoolManager(accounts[14].address);
                await permissionedPool.connect(accounts[14]).pause();
                expect(await permissionedPool.paused()).to.be.true;
                await permissionedPool.connect(accounts[14]).unpause();
                expect(await permissionedPool.paused()).to.be.false;
            });

            it("Should reject pause from admin without ORACLE_MANAGER after rotation", async function() {
                await permissionedPool.updatePoolManager(accounts[14].address);
                await expect(permissionedPool.pause()).to.be.revertedWith("Access Denied");
            });

            it("Should preserve other state vars after poolManager rotation", async function() {
                await permissionedPool.updatePoolManager(accounts[14].address);
                expect(await permissionedPool.poolManager()).to.equal(accounts[14].address);
                expect(await permissionedPool.factory()).to.equal(await permissionedFactory.getAddress());
                expect(await permissionedPool.fundManager()).to.equal(await permissionedFundManager.getAddress());
            });
        });

        describe("Close Pool", async function() {
            it("Should fail to close the pool if withdrawal is pending", async function() {
                await expect(permissionedPool.closePool()).to.be.revertedWithCustomError(permissionedPool, "WithdrawalPending");
                await expect(permissionedPool.connect(accounts[16]).closePool()).to.be.reverted;
            });

            it("Should close the pool if totalAsset == 0", async function() {    
                await permissionedPool.emergencyWithdraw(await dummy.getAddress(), accounts[17], await dummy.balanceOf(await permissionedPool.getAddress()));
                await permissionedFundManager.withdraw();
                await permissionedFundManager.updateAUM(0, await permissionedPool.getAddress());

                await expect(permissionedPool.closePool()).to.emit(permissionedPool, "PoolStatusUpdated").withArgs(accounts[0].address, 1, 2);
                expect(await permissionedPool.status()).to.equal(2);
                await expect(permissionedPool.closePool()).to.be.revertedWithCustomError(permissionedPool, "InvalidStatusUpdate");
            });

            it("Should close the pool if totalSupply == 0", async function() {
                await network.provider.request({method: "evm_revert", params: [snapshot]});
                await dummy.mint(await permissionedPool.getAddress(), parseEther("1"));
                // Admin already has role, no need to grant
                await expect(permissionedPool.closePool()).to.emit(permissionedPool, "PoolStatusUpdated").withArgs(accounts[0].address, 1, 2);
                expect(await permissionedPool.status()).to.equal(2);
                await expect(permissionedPool.closePool()).to.be.revertedWithCustomError(permissionedPool, "InvalidStatusUpdate");
            });

            it("Deposit/Mint should revert", async function () {
                await expect(permissionedPool.deposit(parseEther("100"), accounts[0])).to.be.revertedWithCustomError(permissionedPool, "PoolIsNotActive");
                await expect(permissionedPool.mint(parseEther("100"), accounts[0])).to.be.revertedWithCustomError(permissionedPool, "PoolIsNotActive");
            });

            it("Withdraw/Redeem should revert", async function () {
                await expect(permissionedPool.connect(accounts[3]).withdraw(parseEther("200"), accounts[5], accounts[5])).to.be.revertedWithCustomError(permissionedPool, "PoolIsNotActive");
                await expect(permissionedPool.connect(accounts[3]).redeem(parseEther("200"), accounts[5], accounts[5])).to.be.revertedWithCustomError(permissionedPool, "PoolIsNotActive");
            });

            it("Updating AUM should revert", async function() {
                await expect(permissionedPool.connect(accounts[2]).updateAssetUnderManagement(parseEther("111"))).to.be.revertedWithCustomError(permissionedPool, "PoolIsNotActive");
            });
        })
    });
});