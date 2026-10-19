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

describe("V2-Pool", async function() {
    let accounts, v2Pool, dummy, v2Factory, chainAnalysis, v2FundManager, snapshot;
    before(async function() {
        accounts =  await ethers.getSigners();
        let v2PoolFactory = await getContractFactory("CsigmaV2Pool");
        v2Pool = await v2PoolFactory.deploy();
        let proxyFactory = await getContractFactory("ERC1967Proxy");
        let proxy = await proxyFactory.deploy(await v2Pool.getAddress(), "0x");
        v2Pool = await ethers.getContractAt("CsigmaV2Pool", await proxy.getAddress());
        let dummyFactory = await getContractFactory("MockERC20");
        dummy = await dummyFactory.deploy();
        let withdrawFactory = await getContractFactory("MockWithdrawManager");
        withdrawManager = await withdrawFactory.deploy();
        let fundManagerFactory =  await getContractFactory("MockFundManager");
        v2FundManager = await fundManagerFactory.deploy(await dummy.getAddress());
        let v2FactoryFactory = await getContractFactory("MockFactory");
        v2Factory = await v2FactoryFactory.deploy();
        let chainAnalysisFactory = await getContractFactory("MockChainAnalysis");
        chainAnalysis = await chainAnalysisFactory.deploy();
        v2Factory.setChainAnalysis(await chainAnalysis.getAddress());
        await v2Factory.initializePool(await v2Pool.getAddress(), "Dummy Pool", "DPT", accounts[0].address, await v2FundManager.getAddress(), await dummy.getAddress(), accounts[2].address, 20, parseEther("10000"));
        
        await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[6].address);
        await v2Pool.connect(accounts[6]).setWithdrawalManager(await withdrawManager.getAddress());
        await v2Pool.updateNonReservePercentage(8000);
        expect(await v2Pool.nonReservePercentage()).to.equal(8000);
        await v2Pool.connect(accounts[6]).updateNonReservePercentage(9000);
        await v2Factory.revokeRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[6].address);

    });

    it("Should have initialized correctly", async function() {
        expect(await v2Pool.factory()).to.be.equal(await v2Factory.getAddress());
        expect(await v2Pool.poolManager()).to.be.equal(accounts[0].address);
        expect(await v2Pool.fundManager()).to.be.equal(await v2FundManager.getAddress());
        expect(await v2Pool.poolToken()).to.be.equal(await dummy.getAddress());
        expect(await v2Pool.poolSize()).to.be.equal(parseEther("10000"));
        expect(await v2Pool.projectedAPY()).to.be.equal(20);
        expect(await v2Pool.burnFromBlacklistActive()).to.be.equal(false);
        expect(await v2Pool.initialPrice()).to.be.equal(parseEther("1"));
        expect(await v2Pool.hasRole(await v2Pool.ROLE_ORACLE_MANAGER(), accounts[2].address)).to.be.true;
        expect(await v2Pool.hasRole(await v2Pool.ROLE_ORACLE_MANAGER(), await v2FundManager.getAddress())).to.be.true;
        expect(await v2Pool.hasRole(await v2Pool.DEFAULT_ADMIN_ROLE(), await v2Factory.getAddress())).to.be.true;
    });

    describe("cSigma v2 Pool", async function() {
        before(async function () {
            for(i = 0; i < 6; i++)
                await dummy.mint(accounts[i].address, parseEther("10000"));    
        });

        it("Should fail when activator is not pool manager", async function() {
            await expect(v2Pool.connect(accounts[10]).activatePool()).to.be.revertedWithCustomError(v2Pool, "AccessDenied").withArgs(accounts[10].address);
        });

        it("Should Activate Pool using Pool manager", async function() {
            await expect(v2Pool.activatePool()).to.emit(v2Pool, "PoolStatusUpdated");
            expect(await v2Pool.status()).to.equal(1);
            snapshot = await network.provider.request({method: "evm_snapshot", params:[]});            
        });

        it("Should fail if pool not in pending state", async function() {
            await expect(v2Pool.activatePool()).to.be.revertedWithCustomError(v2Pool, "InvalidStatusUpdate");
        });

        describe("Deposit", async function() {
            before(async function() {
                await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[9].address);
                await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.ROLE_ORACLE_MANAGER(), accounts[13].address);
            });
            
            it("Users can deposit/mint", async function() {
                await dummy.approve(await v2Pool.getAddress(), parseEther("1000"));
                await expect(v2Pool.deposit(parseEther("200"), accounts[19].address)).to.emit(v2Pool, "Deposit").withArgs(accounts[0].address, accounts[19].address, parseEther("200"), parseEther("200"));
                await v2Pool.connect(accounts[13]).updateInitialDepositTime(await latest());
                expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.equal(parseEther("180"));
                expect(await dummy.balanceOf(await v2Pool.getAddress())).to.equal(parseEther("20"));
                expect(await v2Pool.totalAssets()).to.equal(parseEther("200"));

                await dummy.connect(accounts[3]).approve(await v2Pool.getAddress(), parseEther("5000"));
                await expect(v2Pool.connect(accounts[3]).mint(parseEther("5000"), accounts[3].address)).to.emit(v2Pool, "Deposit").withArgs(accounts[3].address, accounts[3].address, parseEther("5000"), parseEther("5000"));
                expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.equal(parseEther("4680"));
                expect(await dummy.balanceOf(await v2Pool.getAddress())).to.equal(parseEther("520"));
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5200"));
            });

            it("Should fail when updating AUM without oracle manager", async function () {
                await expect(v2Pool.updateAssetUnderManagement(parseEther("100"))).to.be.reverted;
            });

            it("Should fail to update asset under management if threshold exceeds", async function() {
                // await v2Factory.pauseTarget(await v2Pool.getAddress());
                await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(parseEther("100"))).to.be.revertedWith("Threshold not met");
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5200"));
                // await v2Factory.unpauseTarget(await v2Pool.getAddress());
                await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[12].address);
                await v2Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(10000);
            });

            it("Should update asset under management", async function() {
                // await v2Factory.pauseTarget(await v2Pool.getAddress());
                await v2FundManager.updateAUM(parseEther("50"), await v2Pool.getAddress());
                await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(parseEther("50"))).to.emit(v2Pool, "AssetUnderManagementUpdated").withArgs(accounts[2].address, parseEther("50"), parseEther("50"));
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5250"));
                // await v2Factory.unpauseTarget(await v2Pool.getAddress());
            });

            it("Should allow to update asset under management if new value less than current value", async function() {
                // await v2Factory.pauseTarget(await v2Pool.getAddress());
                // await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(parseEther("0"))).to.be.revertedWith("Threshold not met");
                // expect(await v2Pool.totalAssets()).to.equal(parseEther("5250"));
                await increase(2* 86400);
                await v2Pool.connect(accounts[2]).updateAssetUnderManagement(parseEther("0"));
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5200"));
                // await v2Factory.unpauseTarget(await v2Pool.getAddress());
                await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[12].address);
                await v2Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(10000);
            });

            it("Should allow to update asset under management only withing thresold limits", async function () {
                // await v2Factory.pauseTarget(await v2Pool.getAddress());                
                await increase(2 * 86400);
                await v2Factory.emergencyUpdateAUM(await v2Pool.getAddress(), ethers.parseEther("100"));
                await v2Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(5000);
                await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("151"))).to.be.revertedWith("Threshold not met");
                await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("49"))).to.be.revertedWith("Threshold not met");
                await v2Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("150"));
                expect(await v2Pool.totalAssets()).to.equal(ethers.parseEther("5350"));
                await increase(2 * 86400);
                await v2Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("100"));
                expect(await v2Pool.totalAssets()).to.equal(ethers.parseEther("5300"));
                // await v2Factory.unpauseTarget(await v2Pool.getAddress());
                await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[12].address);
                await v2Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(10000);
            });

            it("Should fail to update asset under management if cooldown period is not met", async function() {
                // await v2Factory.pauseTarget(await v2Pool.getAddress());
                await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(parseEther("100"))).to.be.revertedWith("Cooldown period not elapsed");
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5300"));
                // await v2Factory.unpauseTarget(await v2Pool.getAddress());
            });

            it("Should update asset under management after cooldown period", async function() {
                await increase(2 * 86400);
                await v2Factory.emergencyUpdateAUM(await v2Pool.getAddress(), ethers.parseEther("50"));
                // await v2Factory.pauseTarget(await v2Pool.getAddress());
                await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(parseEther("100"))).to.emit(v2Pool, "AssetUnderManagementUpdated").withArgs(accounts[2].address, parseEther("50"), parseEther("100"));
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5300"));
                // await v2Factory.unpauseTarget(await v2Pool.getAddress());
            });

            it("Users can deposit after share/asset imbalance", async function() {
                shares = await v2Pool.convertToShares(parseEther("200"));
                await expect(v2Pool.deposit(parseEther("200"), accounts[19].address)).to.emit(v2Pool, "Deposit").withArgs(accounts[0].address, accounts[19].address, parseEther("200"), shares);
                expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.equal(parseEther("4860"));
                expect(await dummy.balanceOf(await v2Pool.getAddress())).to.equal(parseEther("540"));
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5500"));

                assets = await v2Pool.convertToAssets(parseEther("1000")) + 1n;
                await dummy.connect(accounts[3]).approve(await v2Pool.getAddress(), assets);
                await expect(v2Pool.connect(accounts[3]).mint(parseEther("1000"), accounts[3].address)).to.emit(v2Pool, "Deposit").withArgs(accounts[3].address, accounts[3].address, assets, parseEther("1000"));
                expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.equal(parseEther("4860") + (assets * 9n) / 10n);
                expect(await dummy.balanceOf(await v2Pool.getAddress())).to.equal(parseEther("540") + assets / 10n);
                expect(await v2Pool.totalAssets()).to.equal(parseEther("5500") + assets);
            });

            it("Deposit should revert if it exceeds pool size", async function() {
                await dummy.connect(accounts[4]).approve(await v2Pool.getAddress(), parseEther("10000"));
                await expect(v2Pool.connect(accounts[4]).deposit(parseEther("10000"), accounts[4].address)).to.be.revertedWith("ERC4626: deposit more than max");
            });

            it("Deposit should revert if it less than minimum deposit", async function(){
                await v2Pool.updateMinimumInvestmentLimit(parseEther("10"));
                await dummy.connect(accounts[4]).approve(await v2Pool.getAddress(), parseEther("7000"));
                await expect(v2Pool.connect(accounts[4]).deposit(7, accounts[4].address)).to.be.revertedWithCustomError(v2Pool, "InvalidDepositAmount").withArgs(7);
                await expect(v2Pool.connect(accounts[4]).mint(7, accounts[4].address)).to.be.revertedWithCustomError(v2Pool, "InvalidDepositAmount").withArgs(8);
            });

            it("Deposit after change of reserve percentage", async function() {
                initialFundManagerBalance = await dummy.balanceOf(await v2FundManager.getAddress());
                initialPoolBalance = await dummy.balanceOf(await v2Pool.getAddress());
                initialTotalAssets = await v2Pool.totalAssets();
                await v2Pool.connect(accounts[9]).updateNonReservePercentage(7000);
                await dummy.connect(accounts[4]).approve(await v2Pool.getAddress(), parseEther("1000"));
                await v2Pool.connect(accounts[4]).deposit(parseEther("1000"), accounts[4].address);
                expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.equal(initialFundManagerBalance + parseEther("700"));
                expect(await dummy.balanceOf(await v2Pool.getAddress())).to.equal(initialPoolBalance + parseEther("300"));
                expect(await v2Pool.totalAssets()).to.equal(initialTotalAssets + parseEther("1000"));
            });
        });

        describe("Blacklist Restrictions", async function () {
            before(async function () {
                // Give user some LP tokens
                await dummy.connect(accounts[5]).approve(await v2Pool.getAddress(), parseEther("500"));
                await v2Pool.connect(accounts[5]).deposit(parseEther("200"), accounts[5].address);

                // Blacklist the user
                await v2Pool.addBlackList(accounts[5].address);
                expect(await v2Pool.isBlacklisted(accounts[5].address)).to.equal(true);
            });

            it("Should revert deposit for blacklisted user", async function () {
                await dummy.connect(accounts[5]).approve(await v2Pool.getAddress(), parseEther("100"));
                await expect(
                    v2Pool.connect(accounts[5]).deposit(parseEther("100"), accounts[5].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);
            });

            it("Should revert mint for blacklisted user", async function () {
                await expect(
                    v2Pool.connect(accounts[5]).mint(parseEther("100"), accounts[6].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);
            });

            it("Should revert withdraw for blacklisted user", async function () {
                await expect(
                    v2Pool.connect(accounts[5]).withdraw(parseEther("50"), accounts[5].address, accounts[5].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);
            });

            it("Should revert redeem for blacklisted user", async function () {
                await expect(
                    v2Pool.connect(accounts[5]).redeem(parseEther("50"), accounts[5].address, accounts[5].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);
            });

            it("Should revert transfer of LP tokens from blacklisted address", async function () {
                await expect(
                    v2Pool.connect(accounts[5]).transfer(accounts[7].address, parseEther("10"))
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);
            });
        });

        describe("burnFromBlacklist (Blacklisted Wallet)", async function () {
            let burnUser;
            let burnAmount;

            before(async function () {
                burnUser = accounts[5].address;
                burnAmount = await v2Pool.balanceOf(burnUser);
                expect(burnAmount).to.be.gt(0);
            });

            it("Should allow admin to burnFromBlacklist LP tokens of blacklisted user", async function () {
                const totalSupplyBefore = await v2Pool.totalSupply();
                expect(await v2Pool.burnFromBlacklistActive()).to.be.equal(false);
                let balanceBefore = await v2Pool.balanceOf(burnUser);
                await expect(
                    v2Factory.burnFromBlacklist(v2Pool, burnUser, burnAmount)
                )
                    .to.emit(v2Pool, "BurnFromBlacklistExecuted")
                    .withArgs(await v2Pool.getAddress(), burnUser, burnAmount);

                expect(await v2Pool.balanceOf(burnUser)).to.equal(balanceBefore - burnAmount);
                expect(await v2Pool.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
                expect(await v2Pool.burnFromBlacklistActive()).to.be.equal(false);
            });

            it("Should fail burnFromBlacklist if user is not blacklisted", async function () {
                await expect(
                    v2Factory.burnFromBlacklist(v2Pool, accounts[7].address, 1)
                ).to.be.revertedWith("ASSETS_NOT_FROZEN");
            });

            it("Should fail burnFromBlacklist if caller is not admin", async function () {
                await expect(
                    v2Factory.connect(accounts[9]).burnFromBlacklist(v2Pool, burnUser, 1)
                ).to.be.reverted;
            });

            it("Blacklisted user should NOT be able to bypass via burn / redeem", async function () {
                await expect(
                    v2Pool.connect(accounts[5]).redeem(1, accounts[5].address, accounts[5].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);

                await expect(
                    v2Pool.connect(accounts[5]).withdraw(1, accounts[5].address, accounts[5].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);
            });

            it("Blacklisted user should NOT be able to bypass via mint / deposit", async function () {
                await expect(
                    v2Pool.connect(accounts[5]).mint(1, accounts[5].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);

                await expect(
                    v2Pool.connect(accounts[5]).deposit(1, accounts[5].address)
                ).to.be.revertedWithCustomError(v2Pool, "AssetsFrozen").withArgs(accounts[5].address);
            });

            it("burnFromBlacklistActive should not stay enabled after burnFromBlacklist", async function () {
                expect(await v2Pool.burnFromBlacklistActive()).to.be.false;
            });
        });

        describe("Withdraw", async function() {
            it("Should be able to withdraw withdraw/redeem", async function() {
                shares = await v2Pool.balanceOf(accounts[19].address);
                dummyBalance = await dummy.balanceOf(accounts[19].address);
                usedShares = await v2Pool.convertToShares(parseEther("100")) + 1n;
                await expect(v2Pool.connect(accounts[19]).withdraw(parseEther("100"), accounts[19].address, accounts[19].address)).to.emit(v2Pool, "Withdraw").withArgs(accounts[19].address, accounts[19].address, accounts[19].address, parseEther("100"), usedShares);
                expect(await v2Pool.balanceOf(accounts[19].address)).to.equal(shares - usedShares);
                expect(await dummy.balanceOf(accounts[19].address)).to.equal(dummyBalance + parseEther("100"));

                dummyBalance = await dummy.balanceOf(accounts[3].address);
                shares = await v2Pool.balanceOf(accounts[3].address);
                assets = await v2Pool.convertToAssets(parseEther("400"));
                await expect(v2Pool.connect(accounts[3]).redeem(parseEther("400"), accounts[3].address, accounts[3].address)).to.emit(v2Pool, "Withdraw").withArgs(accounts[3].address, accounts[3].address, accounts[3].address, assets, parseEther("400"));
                expect(await v2Pool.balanceOf(accounts[3].address)).to.equal(shares - parseEther("400"));
                expect(await dummy.balanceOf(accounts[3].address)).to.equal(dummyBalance + assets);
            });

            it("Should fail if insufficient balance", async function () {
                await expect(v2Pool.connect(accounts[3]).redeem(await v2Pool.balanceOf(accounts[3]) + 20n, accounts[3], accounts[3])).to.be.reverted;
            });

            it("Should fail if insufficient pool balance", async function () {
                await expect(v2Pool.connect(accounts[3]).redeem(await v2Pool.balanceOf(accounts[3]), accounts[3], accounts[3])).to.be.reverted;
            });
        });

        describe("Access Control Tests", async function () {

            it("Should Grant ROLE_ORACLE_MANAGER using Admin", async function() {
                await expect(v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.ROLE_ORACLE_MANAGER(), accounts[19].address)).to.emit(v2Pool, "RoleGranted").withArgs(await v2Pool.ROLE_ORACLE_MANAGER(), accounts[19].address, await v2Factory.getAddress());
                expect(await v2Pool.isOracleManager(accounts[19])).to.be.true;
            });
    
            it("Should Grant DEFAULT_ADMIN_ROLE", async function() {
                await expect(v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v2Pool, "RoleGranted").withArgs(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address, await v2Factory.getAddress());
            });
    
            it("Should fail to grant role if not admin", async function () {
                await expect(v2Pool.grantRole(await v2Pool.ROLE_ORACLE_MANAGER(), accounts[18].address)).to.be.reverted;
                await expect(v2Pool.grantRole(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.reverted;
            });
    
            it("Should Revoke role", async function () {
                await expect(v2Factory.revokeRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v2Pool, "RoleRevoked").withArgs(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address, await v2Factory.getAddress());
                await expect(v2Factory.revokeRoleTarget(await v2Pool.getAddress(), await v2Pool.ROLE_ORACLE_MANAGER(), accounts[19].address)).to.emit(v2Pool, "RoleRevoked").withArgs(await v2Pool.ROLE_ORACLE_MANAGER(), accounts[19].address, await v2Factory.getAddress());
                await expect(v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.emit(v2Pool, "RoleGranted").withArgs(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address, await v2Factory.getAddress());
            });
    
            it("Should update pool manager", async function() {
                await v2Pool.updatePoolManager(accounts[15].address);
                expect(await v2Pool.poolManager()).to.equal(accounts[15].address);
            });
    
            it("Update pool manager should fail if not admin", async function() {
                await expect(v2Pool.connect(accounts[11]).updatePoolManager(accounts[11].address)).to.be.reverted;
                expect(await v2Pool.poolManager()).to.equal(accounts[15].address);
            });
    
            it("Should update pool size", async function() {
                await v2Pool.updatePoolSize(parseEther("20000"));
                expect(await v2Pool.poolSize()).to.equal(parseEther("20000"));
            });
    
            it("Update pool size should fail if not admin", async function() {
                await expect(v2Pool.connect(accounts[11]).updatePoolSize(parseEther("30000"))).to.be.reverted;
                expect(await v2Pool.poolSize()).to.equal(parseEther("20000"));
            });

            it("Should update pool's AUM update threshold", async function() {
                await v2Pool.updateAUMChangeThresholdPercentage(20000);
                expect(await v2Pool.AUMChangeThresholdPercentage()).to.equal(30000);
            });
    
            it("Update pool's AUM update threshold should fail if not admin", async function() {
                await expect(v2Pool.connect(accounts[11]).updateAUMChangeThresholdPercentage(30000)).to.be.reverted;
                expect(await v2Pool.AUMChangeThresholdPercentage()).to.equal(30000);
            });

            it("Should update pool's AUM update cooldown period", async function() {
                await v2Pool.updateAUMUpdateCooldownPeriod(2*86400);
                expect(await v2Pool.AUMUpdateCooldownPeriod()).to.equal(2 * 86400);
            });
    
            it("Update pool's AUM update cooldown period should fail if not admin", async function() {
                await expect(v2Pool.connect(accounts[11]).updateAUMUpdateCooldownPeriod(30000)).to.be.reverted;
                expect(await v2Pool.AUMUpdateCooldownPeriod()).to.equal(2 * 86400);
            });

            it("Should update pause duration if called by admin", async function() {
                await v2Pool.updatePauseDuration(100);
                expect(await v2Pool.pauseDuration()).to.equal(100);
            });

            it("Should fail if updating pause duration without admin", async function() {
                await expect(v2Pool.connect(accounts[11]).updatePauseDuration(100)).to.be.reverted;
            });

            it("Should update pause start time if called by admin", async function() {
                await v2Pool.updatePauseStartTime(100);
                expect(await v2Pool.pauseStartTime()).to.equal(100);
            });

            it("Should fail if updating pause duration without admin", async function() {
                await expect(v2Pool.connect(accounts[11]).updatePauseStartTime(100)).to.be.reverted;
            });
                
            it("Update Pool size should fail if less than current invested value", async function() {
                await expect(v2Pool.updatePoolSize(parseEther("1"))).to.be.reverted;
                expect(await v2Pool.poolSize()).to.equal(parseEther("20000"));
            });

            it("Should update minimum investment limit if called by admin", async function() {
                await expect(v2Pool.updateMinimumInvestmentLimit(parseEther("100"))).to.emit(v2Pool, "MinimumInvestmentLimitUpdated").withArgs(accounts[0].address, parseEther("10"), parseEther("100"));
                expect(await v2Pool.minimumInvestmentLimit()).to.equal(parseEther("100"));
            });

            it("Should fail if updating minimum investment limit without admin or pool manager", async function() {
                await expect(v2Pool.connect(accounts[11]).updateMinimumInvestmentLimit(parseEther("100"))).to.be.revertedWith("Access Denied");
            });

            it("Should update minimum investment limit if called by pool manager", async function() {
                await expect(v2Pool.connect(accounts[15]).updateMinimumInvestmentLimit(parseEther("10"))).to.emit(v2Pool, "MinimumInvestmentLimitUpdated").withArgs(accounts[15].address, parseEther("100"), parseEther("10"));
                expect(await v2Pool.minimumInvestmentLimit()).to.equal(parseEther("10"));
            });
    
            it("Should add oracle manager", async function (){
                await expect(v2Pool.addOracleManager(accounts[10].address)).to.emit(v2Pool, "RoleGranted").withArgs(await v2Pool.ROLE_ORACLE_MANAGER(), accounts[10].address, await accounts[0].address);
            });
    
            it("Should fail if adding oracle manager without admin", async function() {
                await expect(v2Pool.connect(accounts[10]).addOracleManager(accounts[11].address)).to.be.reverted;
            })
    
            it("Should remove oracle manager", async function (){
                await expect(v2Pool.removeOracleManager(accounts[10].address)).to.emit(v2Pool, "RoleRevoked").withArgs(await v2Pool.ROLE_ORACLE_MANAGER(), accounts[10].address, await accounts[0].address);
            });
    
            it("Should fail if removing oracle manager without admin", async function() {
                await expect(v2Pool.connect(accounts[10]).removeOracleManager(accounts[10].address)).to.be.reverted;
            });
    
            it("Should emergency withdraw funds", async function() {
                balance = await dummy.balanceOf(accounts[14].address);
                await expect(v2Pool.emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5"))).to.emit(v2Pool, "EmergencyWithdraw").withArgs(await dummy.getAddress(), accounts[14].address, parseEther("5"));
                expect(await dummy.balanceOf(accounts[14].address)).to.equal(balance + parseEther("5"));
            });
    
            it("Should fail if withdrawing without admin", async function(){
                await expect(v2Pool.connect(accounts[14]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address, parseEther("5"))).to.be.reverted;
            });

            it("Should send Reserve amount to fund manager", async function() {
                balance = await dummy.balanceOf(await v2FundManager.getAddress());
                const reservebalanceBefore = await v2Pool.maxWithdraw(accounts[0]);
                await expect(v2Pool.connect(accounts[15]).sendReserveToFundManager(parseEther("5"))).to.emit(v2Pool, "SendReserveToFundManager").withArgs(await v2FundManager.getAddress(), parseEther("5"));
                expect(await dummy.balanceOf(await v2FundManager.getAddress())).to.equal(balance + parseEther("5"));
                expect(await v2Pool.maxWithdraw(accounts[0])).to.equal(reservebalanceBefore - parseEther("5"));
            });
    
            it("Should fail to send Reserve amount to fund manager if without pool Manager", async function(){
                await expect(v2Pool.connect(accounts[10]).sendReserveToFundManager(parseEther("5"))).to.be.reverted;
            });
    
            it("Should transfer admin", async function() {
                await expect(v2Pool.transferAdmin(accounts[7].address)).to.emit(v2Pool, "AdminTransferred").withArgs(accounts[0].address, accounts[7].address);
                expect(await v2Pool.hasRole(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.be.false;
                expect(await v2Pool.hasRole(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.be.true;
            });

            it("Should allow admin to blacklist an address", async function () {
                await expect(
                    v2Pool.connect(accounts[15]).addBlackList(accounts[8].address)
                )
                    .to.emit(v2Pool, "AddedBlackList")
                    .withArgs(accounts[8].address);

                expect(await v2Pool.connect(accounts[7]).isBlacklisted(accounts[8].address)).to.be.true;
            });

            it("Should allow admin to unblacklist an address", async function () {
                await expect(
                    v2Pool.connect(accounts[15]).removeBlackList(accounts[8].address)
                )
                    .to.emit(v2Pool, "RemovedBlackList")
                    .withArgs(accounts[8].address);

                expect(await v2Pool.isBlacklisted(accounts[8].address)).to.be.false;
                await v2Pool.connect(accounts[15]).removeBlackList(accounts[5].address);
            });

            it("Should fail to blacklist if caller is not admin", async function () {
                await expect(
                    v2Pool.connect(accounts[9]).addBlackList(accounts[10].address)
                ).to.be.reverted;
            });

            it("Should fail to unblacklist if caller is not admin", async function () {
                await expect(
                    v2Pool.connect(accounts[9]).removeBlackList(accounts[10].address)
                ).to.be.reverted;
            });
        });
    
        describe("Pausability", async function() {
            before(async function() {
                await v2Pool.connect(accounts[7]).transferAdmin(accounts[0].address);
            });
        
            it("Should fail to deposit in the default pause window", async function() {
                await v2Pool.updatePauseStartTime(await latest() % 86400 - 50);
                await v2Pool.updatePauseDuration(100);
                await expect(v2Pool.deposit(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v2Pool.mint(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Should fail to withdraw in the default pause window", async function() {
                await expect(v2Pool.withdraw(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v2Pool.redeem(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Should be able to pause/unpause in the default pause window", async function() {
                await expect(v2Pool.pause()).to.emit(v2Pool, "Paused").withArgs(accounts[0].address);
                expect(await v2Pool.paused()).to.be.true;
                await expect(v2Pool.unpause()).to.emit(v2Pool, "Unpaused").withArgs(accounts[0].address);
                expect(await v2Pool.paused()).to.be.false;
                await increase(100);
            });
    
            it("Should fail to pause the contract if not admin", async function() {
                await expect(v2Pool.connect(accounts[7]).pause()).to.be.reverted;
            });

            it("Should Pause the contract", async function() {
                await expect(v2Pool.pause()).to.emit(v2Pool, "Paused").withArgs(accounts[0].address);
                expect(await v2Pool.paused()).to.be.true;
            });

            it("Deposit should fail in paused state", async function() {
                await expect(v2Pool.deposit(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v2Pool.mint(parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Withdraw should fail in paused state", async function() {
                await expect(v2Pool.withdraw(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v2Pool.redeem(parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
            });
    
            it("Granting role should fail in paused state", async function(){
                await expect(v2Pool.grantRole(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.revertedWith("Pausable: paused");
            });
    
            it("Revoking role should fail in paused state", async function(){
                await expect(v2Pool.revokeRole(await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.revertedWith("Pausable: paused");
            });
    
            it("Should Unpause the contract", async function() {
                await expect(v2Pool.unpause()).to.emit(v2Pool, "Unpaused").withArgs(accounts[0].address);
                expect(await v2Pool.paused()).to.be.false;
                await dummy.connect(accounts[3]).approve(await v2Pool.getAddress(), parseEther("100"));
                await expect(v2Pool.connect(accounts[3]).deposit(parseEther("100"), accounts[0])).to.be.not.reverted;
                await expect(v2Pool.connect(accounts[3]).withdraw(parseEther("100"), accounts[0], accounts[3])).to.be.not.reverted;
            });
        });
    
        describe("When user is sanctioned", async function() {
            before(async function () {
                await dummy.connect(accounts[5]).approve(await v2Pool.getAddress(), parseEther("500"));
                await v2Pool.connect(accounts[5]).deposit(parseEther("200"), accounts[5]);
                await chainAnalysis.sanction(accounts[5].address, true);
            })
            it("Should fail to deposit/mint", async function(){
                await expect(v2Pool.connect(accounts[5]).deposit(parseEther("300"), accounts[5])).to.be.revertedWithCustomError(v2Pool, "AccessDenied").withArgs(accounts[5].address);
                await expect(v2Pool.connect(accounts[5]).mint(parseEther("200"), accounts[5])).to.be.revertedWithCustomError(v2Pool, "AccessDenied").withArgs(accounts[5].address);
            });
    
            it("Should fail to withdraw/redeem", async function() {
                await expect(v2Pool.connect(accounts[5]).withdraw(parseEther("200"), accounts[5], accounts[5])).to.be.revertedWithCustomError(v2Pool, "AccessDenied").withArgs(accounts[5].address);
                await expect(v2Pool.connect(accounts[5]).redeem(parseEther("100"), accounts[5], accounts[5])).to.be.revertedWithCustomError(v2Pool, "AccessDenied").withArgs(accounts[5].address);
            });
        });

        describe("Verify on-chain APY calculations", async function() {
            before(async function() {
                await increase(days(98));
            });
            it("Should have positive APY when value appreciates", async function() {
                initialValue = parseEther("1");    
                currentValue = await v2Pool.convertToAssets(initialValue);
                interestPercentage = ((currentValue - initialValue) * 10000n * 360n) / (initialValue * 100n);
                expect(await v2Pool.suppliedAPY()).to.equal(interestPercentage);
            }); 

            it("Should albe to update initialPrice", async function() {
                await v2Pool.connect(accounts[13]).updateInitialPrice(parseEther("2"));
                expect(await (v2Pool.initialPrice())).to.equal(parseEther("2"));
            });
            
            it("Should not be able to update initialPrice if caller does not have access", async function() {
                await expect(v2Pool.connect(accounts[14]).updateInitialPrice(parseEther("2"))).to.be.reverted;
            });

            it("Should have give correct suppliedAPY after updating initialPrice", async function() {
                await v2Pool.connect(accounts[13]).updateInitialPrice(parseEther("2"));
                initialValue = parseEther("1");    
                currentValue = await v2Pool.convertToAssets(initialValue);
                interestPercentage = ((currentValue - parseEther("2")) * 10000n * 360n) / (parseEther("2") * 100n);
                expect(await v2Pool.suppliedAPY()).to.equal(interestPercentage);
            }); 

            // Test no longer valid
            it.skip("Should have negative APY when value depreciates", async function() {
                // setup for a loss
                await v2Pool.connect(accounts[13]).updateAssetUnderManagement(0);
                await v2Pool.emergencyWithdraw(await dummy.getAddress(), accounts[14].address, await dummy.balanceOf(await v2Pool.getAddress()));
  
                expect(await v2Pool.suppliedAPY()).to.lte(0); 
            });
        });

        describe("Close Pool", async function() {
            it("Should fail to close the pool if withdrawal is pending", async function() {
                await expect(v2Pool.closePool()).to.be.revertedWithCustomError(v2Pool, "WithdrawalPending");
                await expect(v2Pool.connect(accounts[16]).closePool()).to.be.reverted;
            });

            it("Should close the pool if totalAsset == 0", async function() {    
                await v2Pool.emergencyWithdraw(await dummy.getAddress(), accounts[17], await dummy.balanceOf(await v2Pool.getAddress()));
                await v2FundManager.withdraw();
                await v2FundManager.updateAUM(0, await v2Pool.getAddress());

                await expect(v2Pool.closePool()).to.emit(v2Pool, "PoolStatusUpdated").withArgs(accounts[0].address, 1, 2);
                expect(await v2Pool.status()).to.equal(2);
                await expect(v2Pool.closePool()).to.be.revertedWithCustomError(v2Pool, "InvalidStatusUpdate");
            });

            it("Should close the pool if totalSupply == 0", async function() {
                await network.provider.request({method: "evm_revert", params: [snapshot]});
                await dummy.mint(await v2Pool.getAddress(), parseEther("1"));
                await v2Factory.grantRoleTarget(await v2Pool.getAddress(), await v2Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
                await expect(v2Pool.closePool()).to.emit(v2Pool, "PoolStatusUpdated").withArgs(accounts[0].address, 1, 2);
                expect(await v2Pool.status()).to.equal(2);
                await expect(v2Pool.closePool()).to.be.revertedWithCustomError(v2Pool, "InvalidStatusUpdate");
            });

            it("Deposit/Mint should revert", async function () {
                await expect(v2Pool.deposit(parseEther("100"), accounts[0])).to.be.revertedWithCustomError(v2Pool, "PoolIsNotActive");
                await expect(v2Pool.mint(parseEther("100"), accounts[0])).to.be.revertedWithCustomError(v2Pool, "PoolIsNotActive");
            });

            it("Withdraw/Redeem should revert", async function () {
                await expect(v2Pool.connect(accounts[3]).withdraw(parseEther("200"), accounts[5], accounts[5])).to.be.revertedWithCustomError(v2Pool, "PoolIsNotActive");
                await expect(v2Pool.connect(accounts[3]).redeem(parseEther("200"), accounts[5], accounts[5])).to.be.revertedWithCustomError(v2Pool, "PoolIsNotActive");
            });

            it("Updating AUM/APY should revert", async function() {
                await expect(v2Pool.connect(accounts[2]).updateAssetUnderManagement(parseEther("111"))).to.be.revertedWithCustomError(v2Pool, "PoolIsNotActive");
            });
        })
    });
});