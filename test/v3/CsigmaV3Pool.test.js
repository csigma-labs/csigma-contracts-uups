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

describe("cSigma ERC7575 Vaults", function () {
    let oracle, proxy, proxyFactory, dummy, dummyFactory, csUSD, mockFeed, pool, admin, roleManager, oracleManager, controller, poolManager, user;
    let MockFeed, MockPool, Oracle, accounts, v3Pool, v3FundManager, snapshot;

    before(async function () {
        accounts = await ethers.getSigners();
        [admin, roleManager, oracleManager, controller, poolManager, user] = accounts;

        const CsigmaUSD = await ethers.getContractFactory("CsigmaUSD");
        csUSD = await CsigmaUSD.deploy();
        proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
        proxy = await proxyFactory.deploy(await csUSD.getAddress(), "0x");
        csUSD = await ethers.getContractAt("CsigmaUSD", await proxy.getAddress());

        let chainAnalysisFactory = await ethers.getContractFactory("MockChainAnalysis");
        chainAnalysis = await chainAnalysisFactory.deploy();
        // await chainAnalysis.sanction(controller.address, true);
        // v3Pool.setChainAnalysis(await chainAnalysis.getAddress());

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
        await v3Pool.connect(roleManager).updateNonReservePercentage("9000");
    });

    it("should initialize with correct parameters and role assignments", async function () {
        expect(await v3Pool.share()).to.equal(await csUSD.getAddress());
        expect(await v3Pool.poolManager()).to.equal(poolManager.address);
        expect(await v3Pool.fundManager()).to.equal(await v3FundManager.getAddress());
        expect(await v3Pool.poolToken()).to.equal(dummy.target);
        expect(await v3Pool.oracle()).to.equal(await oracle.getAddress());
        expect(await v3Pool.nonReservePercentage()).to.equal(9000);
        expect(await v3Pool.pauseDuration()).to.equal(1800);
        expect(await v3Pool.AUMChangeThresholdPercentage()).to.equal(10050);
        expect(await v3Pool.AUMUpdateCooldownPeriod()).to.equal(45 * 60);
        expect(await v3Pool.name()).to.equal("cSigma USD");
        expect(await v3Pool.symbol()).to.equal("csUSD");
        expect(await v3Pool.totalSupply()).to.equal(ethers.parseUnits("0", 6));

        expect(await v3Pool.hasRole(await v3Pool.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
        expect(await v3Pool.hasRole(await v3Pool.ROLE_MANAGER(), roleManager.address)).to.be.true;
        expect(await v3Pool.hasRole(await v3Pool.ROLE_ORACLE_MANAGER(), oracleManager.address)).to.be.true;
        expect(await v3Pool.hasRole(await v3Pool.ROLE_ORACLE_MANAGER(), await v3FundManager.getAddress())).to.be.true;
    });

    describe("cSigma v3 Pool", async function () {
        beforeEach(async function () {
            for (i = 0; i < 6; i++) {
                await dummy.mint(accounts[i].address, ethers.parseEther("10000"));
            }
            // await chainAnalysis.sanction(controller.address, true);
            await csUSD.addController(await v3Pool.getAddress());
        });


        it("Should fail when activator is not pool manager", async function () {
            await expect(v3Pool.connect(accounts[10]).activatePool())
                .to.be.revertedWith("AccessControl: account " + accounts[10].address.toLowerCase() + " is missing role " + await oracle.ROLE_MANAGER());
        });

        it("Should Activate Pool using Pool manager", async function () {
            await expect(v3Pool.connect(roleManager).activatePool()).to.emit(v3Pool, "PoolStatusUpdated");
            expect(await v3Pool.status()).to.equal(1);
            snapshot = await network.provider.request({ method: "evm_snapshot", params: [] });
        });

        it("Should fail if pool not in pending state", async function () {
            await expect(v3Pool.connect(roleManager).activatePool()).to.be.revertedWithCustomError(v3Pool, "InvalidStatusUpdate");
        });

        describe("Deposit", async function () {
            before(async function () {
                await v3Pool.grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[9].address);
                await v3Pool.grantRole(await v3Pool.ROLE_MANAGER(), accounts[9].address);
                await v3Pool.grantRole(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[13].address);
            });

            it("Users can deposit/mint", async function () {
                await dummy.approve(await v3Pool.getAddress(), ethers.parseEther("1000"));
                await expect(v3Pool.deposit(ethers.parseEther("200"), accounts[19].address)).to.emit(v3Pool, "Deposit").withArgs(accounts[0].address, accounts[19].address, ethers.parseEther("200"), ethers.parseUnits("200", 6));
                expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.equal(ethers.parseEther("180"));
                expect(await dummy.balanceOf(await v3Pool.getAddress())).to.equal(ethers.parseEther("20"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("200"));

                await dummy.connect(accounts[3]).approve(await v3Pool.getAddress(), ethers.parseEther("5000"));
                await expect(v3Pool.connect(accounts[3]).mint(ethers.parseUnits("5000", 6), accounts[3].address)).to.emit(v3Pool, "Deposit").withArgs(accounts[3].address, accounts[3].address, ethers.parseEther("5000"), ethers.parseUnits("5000", 6));
                expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.equal(ethers.parseEther("4680"));
                expect(await dummy.balanceOf(await v3Pool.getAddress())).to.equal(ethers.parseEther("520"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5200"));
            });

            it("Users fails to deposit/mint with csUSD is paused", async function () {
                await csUSD.connect(roleManager).pause();
                await dummy.approve(await v3Pool.getAddress(), ethers.parseEther("1000"));
                await expect(v3Pool.deposit(ethers.parseEther("200"), accounts[19].address)).to.be.revertedWith("Pausable: paused");
                

                await dummy.connect(accounts[3]).approve(await v3Pool.getAddress(), ethers.parseEther("5000"));
                await expect(v3Pool.connect(accounts[3]).mint(ethers.parseUnits("5000", 6), accounts[3].address)).to.be.revertedWith("Pausable: paused");
                await csUSD.connect(roleManager).unpause();
            });

            it("Should fail when updating AUM without oracle manager", async function () {
                await expect(v3Pool.updateAssetUnderManagement(ethers.parseEther("100"))).to.be.reverted;
            });

            it("Should fail to update asset under management if threshold exceeds", async function () {
                // await v3Pool.connect(roleManager).pause();
                await expect(v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("100"))).to.be.revertedWith("Threshold not met");
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5200"));
                // await v3Pool.connect(roleManager).unpause();
                await v3Pool.grantRole(await v3Pool.ROLE_MANAGER(), accounts[12].address);
                await v3Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(10000);
            });

            it("Should update asset under management", async function () {
                // await v3Pool.connect(roleManager).pause();
                // mock fund manager to test call from fund manager
                // let fundManagerFactory =  await getContractFactory("MockFundManager");
                // let v2FundManager = await fundManagerFactory.deploy(await dummy.getAddress());
                // v3Pool.
                // await v3Pool.connect(await ethers.getSigner(await v3FundManager.getAddress())).updateAssetUnderManagement(ethers.parseEther("50"));
                await v3Pool.emergencyUpdateAUM(ethers.parseEther("50"));
                await expect(v3Pool.connect(oracleManager).updateAssetUnderManagement(ethers.parseEther("50"))).to.emit(v3Pool, "AssetUnderManagementUpdated").withArgs(oracleManager.address, ethers.parseEther("50"), ethers.parseEther("50"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5250"));
                // await v3Pool.connect(roleManager).unpause();
            });

            it("Should allow to update asset under management if new value less than current value", async function () {
                // await v3Pool.connect(roleManager).pause();
                await increase(2 * 86400);
                await v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("0"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5200"));
                // await v3Pool.connect(roleManager).unpause();
                await v3Pool.grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[12].address);
                await v3Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(10000);
            });

            it("Should allow to update asset under management only withing thresold limits", async function () {
                // await v3Pool.connect(roleManager).pause();
                await increase(2 * 86400);
                await v3Pool.emergencyUpdateAUM(ethers.parseEther("100"));
                await v3Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(5000);
                await expect(v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("151"))).to.be.revertedWith("Threshold not met");
                await expect(v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("49"))).to.be.revertedWith("Threshold not met");
                await v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("150"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5350"));
                await increase(2 * 86400);
                await v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("100"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5300"));
                // await v3Pool.connect(roleManager).unpause();
                await v3Pool.grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[12].address);
                await v3Pool.connect(accounts[12]).updateAUMChangeThresholdPercentage(10000);
            });

            it("Should fail to update asset under management if cooldown period is not met", async function () {
                // await v3Pool.connect(roleManager).pause();
                await expect(v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("100"))).to.be.revertedWith("Cooldown period not elapsed");
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5300"));
                // await v3Pool.connect(roleManager).unpause();
            });

            it("Should update asset under management after cooldown period", async function () {
                await increase(2 * 86400);
                await v3Pool.emergencyUpdateAUM(ethers.parseEther("50"));
                // await v3Pool.connect(roleManager).pause();
                await expect(v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("100"))).to.emit(v3Pool, "AssetUnderManagementUpdated").withArgs(accounts[2].address, ethers.parseEther("50"), ethers.parseEther("100"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5300"));
                // await v3Pool.connect(roleManager).unpause();
            });

            it("Users can deposit after share/asset imbalance", async function () {
                shares = await v3Pool.convertToShares(ethers.parseEther("200"));
                await expect(v3Pool.deposit(ethers.parseEther("200"), accounts[19].address)).to.emit(v3Pool, "Deposit").withArgs(accounts[0].address, accounts[19].address, ethers.parseEther("200"), shares);
                expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.equal(ethers.parseEther("4860"));
                expect(await dummy.balanceOf(await v3Pool.getAddress())).to.equal(ethers.parseEther("540"));
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5500"));

                assets = await v3Pool.previewMint(ethers.parseUnits("1000", 6));
                await dummy.connect(accounts[3]).approve(await v3Pool.getAddress(), assets);
                await expect(v3Pool.connect(accounts[3]).mint(ethers.parseUnits("1000", 6), accounts[3].address)).to.emit(v3Pool, "Deposit").withArgs(accounts[3].address, accounts[3].address, assets, ethers.parseUnits("1000", 6));
                expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.equal(ethers.parseEther("4860") + (assets * 9n) / 10n);
                expect(await dummy.balanceOf(await v3Pool.getAddress())).to.equal(ethers.parseEther("540") + assets / 10n + 1n);
                expect(await v3Pool.totalAssets()).to.equal(ethers.parseEther("5500") + assets);
            });

            it("Deposit should revert if it exceeds pool size", async function () {
                await dummy.connect(accounts[4]).approve(await v3Pool.getAddress(), ethers.parseEther("1000000"));
                await expect(v3Pool.connect(accounts[4]).deposit(ethers.parseEther("1000000"), accounts[4].address)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
            });

            it("Deposit after change of reserve percentage", async function () {
                initialFundManagerBalance = await dummy.balanceOf(await v3FundManager.getAddress());
                initialPoolBalance = await dummy.balanceOf(await v3Pool.getAddress());
                initialTotalAssets = await v3Pool.totalAssets();
                await v3Pool.connect(accounts[9]).updateNonReservePercentage(7000);
                await dummy.connect(accounts[4]).approve(await v3Pool.getAddress(), ethers.parseEther("1000"));
                await v3Pool.connect(accounts[4]).deposit(ethers.parseEther("1000"), accounts[4].address);
                expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.equal(initialFundManagerBalance + ethers.parseEther("700"));
                expect(await dummy.balanceOf(await v3Pool.getAddress())).to.equal(initialPoolBalance + ethers.parseEther("300"));
                expect(await v3Pool.totalAssets()).to.equal(initialTotalAssets + ethers.parseEther("1000"));
            });
        });

        describe("EIP-4626 rounding invariants", async function () {
            
            let roundingSnap;
            const MAX_OVERSHOOT = 3n;

            before(async function () {
                roundingSnap = await network.provider.request({ method: "evm_snapshot", params: [] });
            });

            afterEach(async function () {
                // Restore the post-Deposit state so the Withdraw block (and any later
                // sibling describes) inherits exactly what they expect.
                await network.provider.request({ method: "evm_revert", params: [roundingSnap] });
                roundingSnap = await network.provider.request({ method: "evm_snapshot", params: [] });
            });

            // --- Direction (Up vs Down) ---

            it("previewDeposit(assets) == convertToShares(assets) [both Down]", async function () {
                const x = ethers.parseEther("100");
                expect(await v3Pool.previewDeposit(x)).to.equal(await v3Pool.convertToShares(x));
            });

            it("previewRedeem(shares) == convertToAssets(shares) [both Down]", async function () {
                const x = ethers.parseUnits("500", 6);
                expect(await v3Pool.previewRedeem(x)).to.equal(await v3Pool.convertToAssets(x));
            });

            it("previewMint(shares) >= convertToAssets(shares) [Up >= Down]", async function () {
                const x = ethers.parseUnits("500", 6);
                expect(await v3Pool.previewMint(x)).to.be.greaterThanOrEqual(await v3Pool.convertToAssets(x));
            });

            it("previewWithdraw(assets) >= convertToShares(assets) [Up >= Down]", async function () {
                const x = ethers.parseEther("100");
                expect(await v3Pool.previewWithdraw(x)).to.be.greaterThanOrEqual(await v3Pool.convertToShares(x));
            });

            it("previewMint > convertToAssets for at least one dust-producing input", async function () {
                const probes = [
                    ethers.parseUnits("1", 6),
                    ethers.parseUnits("7", 6),
                    ethers.parseUnits("123", 6),
                    ethers.parseUnits("999", 6),
                ];
                let strict = false;
                for (const x of probes) {
                    if ((await v3Pool.previewMint(x)) > (await v3Pool.convertToAssets(x))) { strict = true; break; }
                }
                expect(strict, "no probe produced rounding dust — seed state needs adjusting").to.be.true;
            });

            it("previewWithdraw > convertToShares for at least one dust-producing input", async function () {
                const probes = [
                    ethers.parseEther("1"),
                    ethers.parseEther("7"),
                    ethers.parseEther("123"),
                    ethers.parseEther("999"),
                ];
                let strict = false;
                for (const x of probes) {
                    if ((await v3Pool.previewWithdraw(x)) > (await v3Pool.convertToShares(x))) { strict = true; break; }
                }
                expect(strict, "no probe produced rounding dust — seed state needs adjusting").to.be.true;
            });

            it("previewMint - convertToAssets is in [0, 3] wei across a sweep", async function () {
                const probes = [
                    ethers.parseUnits("1", 6),
                    ethers.parseUnits("100", 6),
                    ethers.parseUnits("1000", 6),
                    ethers.parseUnits("12345", 6),
                ];
                for (const x of probes) {
                    const diff = (await v3Pool.previewMint(x)) - (await v3Pool.convertToAssets(x));
                    expect(diff).to.be.greaterThanOrEqual(0n);
                    expect(diff).to.be.lessThanOrEqual(MAX_OVERSHOOT);
                }
            });

            it("previewWithdraw - convertToShares is in [0, 3] wei across a sweep", async function () {
                const probes = [
                    ethers.parseEther("1"),
                    ethers.parseEther("100"),
                    ethers.parseEther("1000"),
                    ethers.parseEther("12345"),
                ];
                for (const x of probes) {
                    const diff = (await v3Pool.previewWithdraw(x)) - (await v3Pool.convertToShares(x));
                    expect(diff).to.be.greaterThanOrEqual(0n);
                    expect(diff).to.be.lessThanOrEqual(MAX_OVERSHOOT);
                }
            });

            it("deposit(X) credits exactly previewDeposit(X) shares and pulls exactly X assets", async function () {
                const x = ethers.parseEther("250");
                const expectedShares = await v3Pool.previewDeposit(x);
                const assetBefore = await dummy.balanceOf(accounts[2].address);
                const shareBefore = await v3Pool.balanceOf(accounts[2].address);

                await dummy.connect(accounts[2]).approve(await v3Pool.getAddress(), x);
                await v3Pool.connect(accounts[2]).deposit(x, accounts[2].address);

                expect(assetBefore - (await dummy.balanceOf(accounts[2].address))).to.equal(x);
                expect((await v3Pool.balanceOf(accounts[2].address)) - shareBefore).to.equal(expectedShares);
            });

            it("mint(N) credits exactly N shares and pulls exactly previewMint(N) assets", async function () {
                const n = ethers.parseUnits("300", 6);
                const expectedAssets = await v3Pool.previewMint(n);
                const assetBefore = await dummy.balanceOf(accounts[2].address);
                const shareBefore = await v3Pool.balanceOf(accounts[2].address);

                await dummy.connect(accounts[2]).approve(await v3Pool.getAddress(), expectedAssets);
                await v3Pool.connect(accounts[2]).mint(n, accounts[2].address);

                expect(assetBefore - (await dummy.balanceOf(accounts[2].address))).to.equal(expectedAssets);
                expect((await v3Pool.balanceOf(accounts[2].address)) - shareBefore).to.equal(n);
            });

            it("withdraw(X) delivers exactly X assets and burns exactly previewWithdraw(X) shares", async function () {
                // accounts[3] has 1000+ csUSD shares from the imbalance test in Deposit
                const x = ethers.parseEther("50");
                const expectedShares = await v3Pool.previewWithdraw(x);
                const assetBefore = await dummy.balanceOf(accounts[3].address);
                const shareBefore = await v3Pool.balanceOf(accounts[3].address);

                await v3Pool.connect(accounts[3]).withdraw(x, accounts[3].address, accounts[3].address);

                expect((await dummy.balanceOf(accounts[3].address)) - assetBefore).to.equal(x);
                expect(shareBefore - (await v3Pool.balanceOf(accounts[3].address))).to.equal(expectedShares);
            });

            it("redeem(N) delivers exactly previewRedeem(N) assets and burns exactly N shares", async function () {
                const n = ethers.parseUnits("100", 6);
                const expectedAssets = await v3Pool.previewRedeem(n);
                const assetBefore = await dummy.balanceOf(accounts[3].address);
                const shareBefore = await v3Pool.balanceOf(accounts[3].address);

                await v3Pool.connect(accounts[3]).redeem(n, accounts[3].address, accounts[3].address);

                expect((await dummy.balanceOf(accounts[3].address)) - assetBefore).to.equal(expectedAssets);
                expect(shareBefore - (await v3Pool.balanceOf(accounts[3].address))).to.equal(n);
            });
        });

        describe("Withdraw", async function () {
            it("Should be able to withdraw withdraw/redeem", async function () {
                shares = await v3Pool.balanceOf(accounts[19].address);
                dummyBalance = await dummy.balanceOf(accounts[19].address);
                usedShares = await v3Pool.previewWithdraw(ethers.parseEther("100"));
                await expect(v3Pool.connect(accounts[19]).withdraw(ethers.parseEther("100"), accounts[19].address, accounts[19].address)).to.emit(v3Pool, "Withdraw").withArgs(accounts[19].address, accounts[19].address, accounts[19].address, ethers.parseEther("100"), usedShares);
                expect(await v3Pool.balanceOf(accounts[19].address)).to.equal(shares - usedShares);
                expect(await dummy.balanceOf(accounts[19].address)).to.equal(dummyBalance + ethers.parseEther("100"));

                dummyBalance = await dummy.balanceOf(accounts[3].address);
                shares = await v3Pool.balanceOf(accounts[3].address);
                assets = await v3Pool.convertToAssets(ethers.parseUnits("400", 6));
                await expect(v3Pool.connect(accounts[3]).redeem(ethers.parseUnits("400", 6), accounts[3].address, accounts[3].address)).to.emit(v3Pool, "Withdraw").withArgs(accounts[3].address, accounts[3].address, accounts[3].address, assets, ethers.parseUnits("400", 6));
                expect(await v3Pool.balanceOf(accounts[3].address)).to.equal(shares - ethers.parseUnits("400", 6));
                expect(await dummy.balanceOf(accounts[3].address)).to.equal(dummyBalance + assets);
            });

            it("Should be not able to withdraw withdraw/redeem when csUSD is paused", async function () {
                await csUSD.connect(roleManager).pause();
                shares = await v3Pool.balanceOf(accounts[19].address);
                dummyBalance = await dummy.balanceOf(accounts[19].address);
                usedShares = await v3Pool.convertToShares(ethers.parseEther("100"));
                await expect(v3Pool.connect(accounts[19]).withdraw(ethers.parseEther("100"), accounts[19].address, accounts[19].address)).to.be.revertedWith("Pausable: paused");

                dummyBalance = await dummy.balanceOf(accounts[3].address);
                shares = await v3Pool.balanceOf(accounts[3].address);
                assets = await v3Pool.convertToAssets(ethers.parseUnits("400", 6));
                await expect(v3Pool.connect(accounts[3]).redeem(ethers.parseUnits("400", 6), accounts[3].address, accounts[3].address)).to.be.revertedWith("Pausable: paused");
                await csUSD.connect(roleManager).unpause();
            });

            it("Should fail if insufficient balance", async function () {
                await expect(v3Pool.connect(accounts[3]).redeem(await v3Pool.balanceOf(accounts[3]) + 20n, accounts[3], accounts[3])).to.be.reverted;
            });

            it("Should fail if insufficient pool balance", async function () {
                await expect(v3Pool.connect(accounts[3]).redeem(await v3Pool.balanceOf(accounts[3]), accounts[3], accounts[3])).to.be.reverted;
            });
        });

        describe("Access Control Tests", async function () {

            it("Should Grant ROLE_ORACLE_MANAGER using Admin", async function () {
                await expect(v3Pool.grantRole(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[19].address)).to.emit(v3Pool, "RoleGranted").withArgs(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[19].address, admin.address);
                expect(await v3Pool.isOracleManager(accounts[19])).to.be.true;
            });

            it("Should Grant DEFAULT_ADMIN_ROLE", async function () {
                await expect(v3Pool.grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v3Pool, "RoleGranted").withArgs(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address, admin.address);
            });

            it("Should fail to grant role if not admin", async function () {
                await expect(v3Pool.connect(accounts[10]).grantRole(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[18].address)).to.be.reverted;
                await expect(v3Pool.connect(accounts[10]).grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.reverted;
            });

            it("Should Revoke role", async function () {
                await expect(v3Pool.revokeRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v3Pool, "RoleRevoked").withArgs(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address, admin.address);
                await expect(v3Pool.revokeRole(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[19].address)).to.emit(v3Pool, "RoleRevoked").withArgs(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[19].address, admin.address);
                await expect(v3Pool.grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v3Pool, "RoleGranted").withArgs(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[19].address, admin.address);
            });

            it("Update pool manager should fail if not admin", async function () {
                await expect(v3Pool.connect(accounts[11]).updatePoolManager(accounts[11].address)).to.be.reverted;
                expect(await v3Pool.poolManager()).to.equal(poolManager.address);
            });

            it("Should update pool manager", async function () {
                await v3Pool.updatePoolManager(accounts[15].address);
                expect(await v3Pool.poolManager()).to.equal(accounts[15].address);
            });

            it("Should update pool's AUM update threshold", async function () {
                await v3Pool.connect(roleManager).updateAUMChangeThresholdPercentage(20000);
                expect(await v3Pool.AUMChangeThresholdPercentage()).to.equal(30000);
            });

            it("Update pool's AUM update threshold should fail if not admin", async function () {
                await expect(v3Pool.connect(accounts[11]).updateAUMChangeThresholdPercentage(30000)).to.be.reverted;
                expect(await v3Pool.AUMChangeThresholdPercentage()).to.equal(30000);
            });

            it("Should update pool's AUM update cooldown period", async function () {
                await v3Pool.connect(roleManager).updateAUMUpdateCooldownPeriod(2 * 86400);
                expect(await v3Pool.AUMUpdateCooldownPeriod()).to.equal(2 * 86400);
            });

            it("Update pool's AUM update cooldown period should fail if not admin", async function () {
                await expect(v3Pool.connect(accounts[11]).updateAUMUpdateCooldownPeriod(30000)).to.be.reverted;
                expect(await v3Pool.AUMUpdateCooldownPeriod()).to.equal(2 * 86400);
            });

            it("Should update pause duration if called by role manager", async function () {
                await v3Pool.connect(roleManager).updatePauseDuration(100);
                expect(await v3Pool.pauseDuration()).to.equal(100);
            });

            it("Should fail if updating pause duration without role manager", async function () {
                await expect(v3Pool.connect(accounts[11]).updatePauseDuration(100)).to.be.reverted;
            });

            it("Should update pause start time if called by role manager", async function () {
                await v3Pool.connect(roleManager).updatePauseStartTime(100);
                expect(await v3Pool.pauseStartTime()).to.equal(100);
            });

            it("Should fail if updating pause duration without role manager", async function () {
                await expect(v3Pool.connect(accounts[11]).updatePauseStartTime(100)).to.be.reverted;
            });

            it("Should add oracle manager", async function () {
                await expect(v3Pool.addOracleManager(accounts[10].address)).to.emit(v3Pool, "RoleGranted").withArgs(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[10].address, await accounts[0].address);
            });

            it("Should fail if adding oracle manager without admin", async function () {
                await expect(v3Pool.connect(accounts[10]).addOracleManager(accounts[11].address)).to.be.reverted;
            })

            it("Should remove oracle manager", async function () {
                await expect(v3Pool.removeOracleManager(accounts[10].address)).to.emit(v3Pool, "RoleRevoked").withArgs(await v3Pool.ROLE_ORACLE_MANAGER(), accounts[10].address, await accounts[0].address);
            });

            it("Should fail if removing oracle manager without admin", async function () {
                await expect(v3Pool.connect(accounts[10]).removeOracleManager(accounts[10].address)).to.be.reverted;
            });

            it("Should emergency withdraw funds", async function () {
                balance = await dummy.balanceOf(accounts[14].address);
                await expect(v3Pool.emergencyWithdraw(await dummy.getAddress(), accounts[14].address, ethers.parseEther("5"))).to.emit(v3Pool, "EmergencyWithdraw").withArgs(await dummy.getAddress(), accounts[14].address, ethers.parseEther("5"));
                expect(await dummy.balanceOf(accounts[14].address)).to.equal(balance + ethers.parseEther("5"));
            });

            it("Should fail if withdrawing without admin", async function () {
                await expect(v3Pool.connect(accounts[14]).emergencyWithdraw(await dummy.getAddress(), accounts[14].address, ethers.parseEther("5"))).to.be.reverted;
            });

            it("Should send Reserve amount to fund manager", async function () {
                balance = await dummy.balanceOf(await v3FundManager.getAddress());
                const reservebalanceBefore = await v3Pool.maxWithdraw(accounts[0]);
                await expect(v3Pool.connect(accounts[15]).sendReserveToFundManager(ethers.parseEther("5"))).to.emit(v3Pool, "SendReserveToFundManager").withArgs(await v3FundManager.getAddress(), ethers.parseEther("5"));
                expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.equal(balance + ethers.parseEther("5"));
                expect(await v3Pool.maxWithdraw(accounts[0])).to.equal(reservebalanceBefore - ethers.parseEther("5"));
            });

            it("Should fail to send Reserve amount to fund manager if without pool Manager", async function () {
                await expect(v3Pool.connect(accounts[10]).sendReserveToFundManager(ethers.parseEther("5"))).to.be.reverted;
            });

            it("Should transfer admin", async function () {
                await expect(v3Pool.transferAdmin(accounts[7].address)).to.emit(v3Pool, "AdminTransferred").withArgs(accounts[0].address, accounts[7].address);
                expect(await v3Pool.hasRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.be.false;
                expect(await v3Pool.hasRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.be.true;
            });
        });

        describe("Pausability", async function () {
            before(async function () {
                await v3Pool.connect(accounts[7]).transferAdmin(accounts[0].address);
            });

            it("Should fail to deposit in the default pause window", async function () {
                await v3Pool.connect(roleManager).updatePauseStartTime(await latest() % 86400 - 50);
                await v3Pool.connect(roleManager).updatePauseDuration(100);
                await expect(v3Pool.deposit(ethers.parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v3Pool.mint(ethers.parseUnits("100", 6), accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Should fail to withdraw in the default pause window", async function () {
                await expect(v3Pool.withdraw(ethers.parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v3Pool.redeem(ethers.parseUnits("100", 6), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Should be able to pause/unpause in the default pause window", async function () {
                await expect(v3Pool.connect(roleManager).pause()).to.emit(v3Pool, "Paused").withArgs(roleManager.address);
                expect(await v3Pool.paused()).to.be.true;
                await expect(v3Pool.connect(roleManager).unpause()).to.emit(v3Pool, "Unpaused").withArgs(roleManager.address);
                expect(await v3Pool.paused()).to.be.false;
                await increase(100);
            });

            it("Should fail to pause the contract if not admin", async function () {
                await expect(v3Pool.connect(accounts[7]).pause()).to.be.reverted;
            });

            it("Should Pause the contract", async function () {
                await expect(v3Pool.connect(roleManager).pause()).to.emit(v3Pool, "Paused").withArgs(roleManager.address);
                expect(await v3Pool.paused()).to.be.true;
            });

            it("Deposit should fail in paused state", async function () {
                await expect(v3Pool.deposit(ethers.parseEther("100"), accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v3Pool.mint(ethers.parseUnits("100", 6), accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Withdraw should fail in paused state", async function () {
                await expect(v3Pool.withdraw(ethers.parseEther("100"), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
                await expect(v3Pool.redeem(ethers.parseUnits("100", 6), accounts[0], accounts[0])).to.be.revertedWith("Pausable: paused");
            });

            it("Granting role should fail in paused state", async function () {
                await expect(v3Pool.grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.revertedWith("Pausable: paused");
            });

            it("Revoking role should fail in paused state", async function () {
                await expect(v3Pool.revokeRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.revertedWith("Pausable: paused");
            });

            it("Should Unpause the contract", async function () {
                await expect(v3Pool.connect(roleManager).unpause()).to.emit(v3Pool, "Unpaused").withArgs(roleManager.address);
                expect(await v3Pool.paused()).to.be.false;
                await dummy.connect(accounts[3]).approve(await v3Pool.getAddress(), ethers.parseEther("100"));
                await expect(v3Pool.connect(accounts[3]).deposit(ethers.parseEther("100"), accounts[0])).to.be.not.reverted;
                await expect(v3Pool.connect(accounts[3]).withdraw(ethers.parseEther("100"), accounts[0], accounts[3])).to.be.not.reverted;
            });
        });

        describe("When user is sanctioned", async function () {
            before(async function () {
                await dummy.connect(accounts[5]).approve(await v3Pool.getAddress(), ethers.parseEther("500"));
                await v3Pool.connect(accounts[5]).deposit(ethers.parseEther("200"), accounts[5]);
                await chainAnalysis.sanction(accounts[5].address, true);
            })
            it("Should fail to deposit/mint", async function () {
                await expect(v3Pool.connect(accounts[5]).deposit(ethers.parseEther("300"), accounts[5]))
                    .to.be.revertedWithCustomError(v3Pool, "AccessDenied").withArgs(accounts[5].address);
                await expect(v3Pool.connect(accounts[5]).mint(ethers.parseUnits("200", 6), accounts[5]))
                    .to.be.revertedWithCustomError(v3Pool, "AccessDenied").withArgs(accounts[5].address);
            });

            it("Should fail to withdraw/redeem", async function () {
                await expect(v3Pool.connect(accounts[5]).withdraw(ethers.parseEther("200"), accounts[5], accounts[5]))
                    .to.be.revertedWithCustomError(v3Pool, "AccessDenied").withArgs(accounts[5].address);
                await expect(v3Pool.connect(accounts[5]).redeem(ethers.parseUnits("100", 6), accounts[5], accounts[5]))
                    .to.be.revertedWithCustomError(v3Pool, "AccessDenied").withArgs(accounts[5].address);
            });
        });

        describe("Verify on-chain APY calculations", async function () {
            before(async function () {
                await increase(days(98));
            });

        });

        describe("Close Pool", async function () {
            it("Should fail to close the pool if withdrawal is pending", async function () {
                await expect(v3Pool.connect(roleManager).closePool()).to.be.revertedWithCustomError(v3Pool, "WithdrawalPending");
                await expect(v3Pool.connect(accounts[16]).closePool()).to.be.reverted;
            });

            it("Should close the pool if totalAsset == 0", async function () {
                await v3Pool.emergencyWithdraw(await dummy.getAddress(), accounts[17].address, await dummy.balanceOf(await v3Pool.getAddress()));
                await dummy.transfer(admin.address, await dummy.balanceOf(await v3FundManager.getAddress()));
                await v3FundManager.emergencyWithdraw(await dummy.getAddress(), accounts[17].address, await dummy.balanceOf(await v3Pool.fundManager()));
                await dummy.transfer(admin.address, await dummy.balanceOf(await v3FundManager.getAddress()));
                await v3Pool.emergencyUpdateAUM(0);

                await expect(v3Pool.connect(roleManager).closePool()).to.emit(v3Pool, "PoolStatusUpdated").withArgs(roleManager.address, 1, 2);
                expect(await v3Pool.status()).to.equal(2);
                await expect(v3Pool.connect(roleManager).closePool()).to.be.revertedWithCustomError(v3Pool, "InvalidStatusUpdate");
            });

            it("Should close the pool if totalSupply == 0", async function () {
                await network.provider.request({ method: "evm_revert", params: [snapshot] });
                await v3Pool.grantRole(await v3Pool.DEFAULT_ADMIN_ROLE(), accounts[0].address);
                await expect(v3Pool.connect(roleManager).closePool()).to.emit(v3Pool, "PoolStatusUpdated").withArgs(roleManager.address, 1, 2);
                expect(await v3Pool.status()).to.equal(2);
                await expect(v3Pool.connect(roleManager).closePool()).to.be.revertedWithCustomError(v3Pool, "InvalidStatusUpdate");
            });

            it("Deposit/Mint should revert", async function () {
                await expect(v3Pool.deposit(ethers.parseEther("100"), accounts[0])).to.be.revertedWithCustomError(v3Pool, "PoolIsNotActive");
                await expect(v3Pool.mint(ethers.parseUnits("100", 6), accounts[0])).to.be.revertedWithCustomError(v3Pool, "PoolIsNotActive");
            });

            it("Withdraw/Redeem should revert", async function () {
                await expect(v3Pool.connect(accounts[3]).withdraw(ethers.parseEther("200"), accounts[5], accounts[5])).to.be.revertedWithCustomError(v3Pool, "PoolIsNotActive");
                await expect(v3Pool.connect(accounts[3]).redeem(ethers.parseUnits("200", 6), accounts[5], accounts[5])).to.be.revertedWithCustomError(v3Pool, "PoolIsNotActive");
            });

            it("Updating AUM/APY should revert", async function () {
                await expect(v3Pool.connect(accounts[2]).updateAssetUnderManagement(ethers.parseEther("111"))).to.be.revertedWithCustomError(v3Pool, "PoolIsNotActive");
            });
        })
    });

    describe("Withdrawal Manager updates", function () {

        it("Should create new Withdrawal Manager", async function () {
            await network.provider.request({ method: "evm_revert", params: [snapshot] });
            const routerAddress = accounts[14].address;
            const tx = await v3Pool.connect(roleManager).createWithdrawalManager(routerAddress);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.eventName === "WithdrawalManagerCreated");
            const newWM = event.args._withdrawalManager;

            expect(event.args._pool).to.equal(await v3Pool.getAddress());
            expect(await v3Pool.withdrawalManager()).to.equal(newWM);

            const withdrawalManager = await ethers.getContractAt("CsigmaV3WithdrawalManager", newWM);
            expect(await withdrawalManager.csigmaV3Pool()).to.equal(await v3Pool.getAddress());
            expect(await withdrawalManager.underlyingToken()).to.equal(await v3Pool.poolToken());
            expect(await withdrawalManager.totalDueLPToken()).to.equal(await withdrawalManager.totalDueShareToken());
            expect(await withdrawalManager.LPToken()).to.equal(await withdrawalManager.shareToken());
        });

        it("Should be able to withdraw() after creating withdrawal manager", async function () {
            const PoolFactory = await ethers.getContractFactory("CsigmaV3Pool");
            const poolLogic = await PoolFactory.deploy();

            const newProxy = await proxyFactory.deploy(
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

            const newV3Pool = await ethers.getContractAt("CsigmaV3Pool", await newProxy.getAddress());

            await oracle.connect(roleManager).addSupportedAsset(
                await newV3Pool.getAddress(),
                await dummy.getAddress(),
                await mockFeed.getAddress(),
                0,
                ethers.parseUnits("0.85", 18),
                ethers.parseUnits("1.10", 18)
            );
            await newV3Pool.connect(roleManager).updateNonReservePercentage("9000");

            // Create new withdrawal manager 
            const routerAddress = accounts[14].address;
            const tx = await newV3Pool.connect(roleManager).createWithdrawalManager(routerAddress);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.eventName === "WithdrawalManagerCreated");
            const newWM = event.args._withdrawalManager;

            expect(event.args._pool).to.equal(await newV3Pool.getAddress());
            expect(await newV3Pool.withdrawalManager()).to.equal(newWM);

            await newV3Pool.connect(roleManager).activatePool();
            await csUSD.addController(await newV3Pool.getAddress());

            // Mint and deposit
            await dummy.mint(accounts[19].address, ethers.parseUnits("100", 18));
            await dummy.connect(accounts[19]).approve(await newV3Pool.getAddress(), ethers.parseEther("100"));
            await newV3Pool.connect(accounts[19]).deposit(ethers.parseEther("100"), accounts[19].address);

            // Withdraw after creating withdraw manager
            const shares = await newV3Pool.balanceOf(accounts[19].address);
            const dummyBalance = await dummy.balanceOf(accounts[19].address);
            const usedShares = await newV3Pool.convertToShares(ethers.parseEther("10"));

            await expect(newV3Pool.connect(accounts[19]).withdraw(ethers.parseEther("10"), accounts[19].address, accounts[19].address))
                .to.emit(newV3Pool, "Withdraw")
                .withArgs(accounts[19].address, accounts[19].address, accounts[19].address, ethers.parseEther("10"), usedShares);

            expect(await newV3Pool.balanceOf(accounts[19].address)).to.equal(shares - usedShares);
            expect(await dummy.balanceOf(accounts[19].address)).to.equal(dummyBalance + ethers.parseEther("10"));
        });

        it("Should fail to create withdrawal manager if not ROLE_MANAGER", async function () {
            await expect(v3Pool.connect(accounts[12]).createWithdrawalManager(accounts[10].address)).to.be.revertedWith("AccessControl: account " + accounts[12].address.toLowerCase() + " is missing role " + await oracle.ROLE_MANAGER());
        });

        it("Should upgrade withdrawal manager", async function () {
            // deploy a mock implementation upgrade
            const NewWMFactory = await ethers.getContractFactory("CsigmaV3WithdrawalManager");
            const newImpl = await NewWMFactory.deploy();

            const oldImpl = await v3Pool.withdrawalManagerImplementation();
            await v3Pool.connect(admin).upgradeWithdrawalManager(await newImpl.getAddress());

            expect(await v3Pool.withdrawalManagerImplementation()).to.equal(await newImpl.getAddress());
            
        });

        it("Should fail to upgrade withdrawal manager if not admin", async function () {
            const NewWMFactory = await ethers.getContractFactory("CsigmaV3WithdrawalManager");
            const newImpl = await NewWMFactory.deploy();

            await expect(v3Pool.connect(accounts[9]).upgradeWithdrawalManager(await newImpl.getAddress())).to.be.revertedWith("AccessControl: account " + accounts[9].address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });
    });

     describe("Roles on target", async function () {
         it("Should Grant Roles on target", async function () {
            const withdrawalManager = await ethers.getContractAt("CsigmaV3WithdrawalManager", await v3Pool.withdrawalManager());
            await expect(v3Pool.connect(admin).grantRoleTarget(await withdrawalManager.getAddress(), await withdrawalManager.MANAGER_ROLE(), accounts[19].address)).to.emit(withdrawalManager, "RoleGranted").withArgs(await withdrawalManager.MANAGER_ROLE(), accounts[19].address, await v3Pool.getAddress());
            expect(await withdrawalManager.hasRole(await withdrawalManager.MANAGER_ROLE(), accounts[19].address)).to.be.true;
        });

        it("Should fail to grant roles on target if not admin", async function () {
            const withdrawalManager = await ethers.getContractAt("CsigmaV3WithdrawalManager", await v3Pool.withdrawalManager());
            await expect(v3Pool.connect(accounts[8]).grantRoleTarget(await withdrawalManager.getAddress(), await withdrawalManager.MANAGER_ROLE(), accounts[19].address)).to.be.reverted;
        });

        it("Should revoke roles on target", async function () {
            const withdrawalManager = await ethers.getContractAt("CsigmaV3WithdrawalManager", await v3Pool.withdrawalManager());
            await expect(v3Pool.connect(admin).revokeRoleTarget(await withdrawalManager.getAddress(), await withdrawalManager.MANAGER_ROLE(), accounts[19].address)).to.emit(withdrawalManager, "RoleRevoked").withArgs(await withdrawalManager.MANAGER_ROLE(), accounts[19].address, await v3Pool.getAddress());
            expect(await withdrawalManager.hasRole(await withdrawalManager.MANAGER_ROLE(), accounts[19].address)).to.be.false;
        });

        it("Should fail to revoke roles on target if not admin", async function () {
            const withdrawalManager = await ethers.getContractAt("CsigmaV3WithdrawalManager", await v3Pool.withdrawalManager());
            await expect(v3Pool.connect(accounts[8]).revokeRoleTarget(await withdrawalManager.getAddress(), await withdrawalManager.MANAGER_ROLE(), accounts[19].address)).to.be.reverted;
        });
    });

    describe("Emergency Functions", function () {
        it("should allow emergencyWithdraw by admin", async () => {
            await dummy.mint(admin.address, ethers.parseUnits("10", 18));
            await dummy.transfer(v3Pool.target, ethers.parseEther("10"));
            await expect(v3Pool.emergencyWithdraw(dummy.target, user.address, ethers.parseEther("5")))
                .to.emit(v3Pool, "EmergencyWithdraw");
        });

        it("should allow emergencyUpdateAUM", async () => {
            await expect(v3Pool.emergencyUpdateAUM(ethers.parseEther("1234"))).to.emit(
                v3Pool,
                "AssetUnderManagementUpdated"
            );
        });
    });

    describe("Admin Transfers", function () {
        it("should transfer admin role", async () => {
            await expect(v3Pool.transferAdmin(user.address)).to.emit(v3Pool, "AdminTransferred");
            expect(await v3Pool.hasRole(await v3Pool.DEFAULT_ADMIN_ROLE(), user.address)).to.be.true;
        });
    });

    describe("Upgradeability", function () {
        it("should reject upgrade from non-admin", async () => {
            const NewLogic = await ethers.getContractFactory("CsigmaV3Pool");
            const newLogic = await NewLogic.deploy();

            await expect(
                v3Pool.connect(roleManager).upgradeTo(newLogic.target)
            )
                .to.be.revertedWith("AccessControl: account " + roleManager.address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });

        it("should upgrade from admin", async () => {
            const NewLogic = await ethers.getContractFactory("CsigmaV3Pool");
            const newLogic = await NewLogic.deploy();

            await expect(
                v3Pool.connect(user).upgradeTo(newLogic.target)
            ).not.to.be.reverted;
        });
    });
});