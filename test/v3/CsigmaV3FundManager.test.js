const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
    time: {
        latest,
        increase,
        duration: { days },
    },
} = require("@nomicfoundation/hardhat-network-helpers");
const { ZeroAddress, parseEther } = require("ethers");

describe("CSUSD Fund Manager ", function () {
    let oracle, proxy, proxyFactory, dummy, dummyFactory, csUSD, mockFeed, pool, admin, roleManager, oracleManager, controller, poolManager, user;
    let MockFeed, MockPool, Oracle, accounts, v3Pool, v3FundManager, paymentInfo, request, claimRequest;

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
        // v3FundManager.setChainAnalysis(await chainAnalysis.getAddress());

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
        await csUSD.addController(await v3Pool.getAddress());
        await v3Pool.connect(roleManager).activatePool();
        await v3Pool.connect(roleManager).updateNonReservePercentage("9000");

        await v3FundManager.connect(roleManager).addTokenToWhitelist(await v3Pool.getAddress());
        for (let i = 0; i < 19; i++) {
            await dummy.mint(accounts[i].address, ethers.parseEther("10000"));
            await dummy.connect(accounts[i]).approve(await v3Pool.getAddress(), ethers.parseEther("10000"));
        }
    });

    it("Should have initialized the fund manager correctly", async function() {

        expect(await v3FundManager.diamondV1()).to.be.equal(await diamondV1.getAddress());
        expect(await v3FundManager.fundManagerLenderId()).to.be.equal("LENDER1");
        expect(await v3FundManager.hasRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
        expect(await v3FundManager.hasRole(await v3FundManager.ROLE_MANAGER(), roleManager.address)).to.be.true;
        expect(await v3FundManager.totalV1Pools(await dummy.getAddress())).to.be.equal(0);
        expect(await v3FundManager.pool(await dummy.getAddress())).to.be.equal(await v3Pool.getAddress());
        expect(await v3FundManager.router()).to.be.equal(accounts[20].address);
        expect(await v3FundManager.poolManager()).to.be.equal(poolManager.address);
        expect(await v3FundManager.permit2()).to.be.equal(accounts[20].address);
    });

    describe("Access Control Tests", async function() {
        it("Should grant roles", async function() {
            await expect(v3FundManager.grantRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v3FundManager, "RoleGranted").withArgs(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, await admin.address);
            expect(await v3FundManager.hasRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.true;
        });

        it("Should fail to grant roles if not admin", async function() {
            await expect(v3FundManager.connect(accounts[8]).grantRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[18].address)).to.be.reverted;
        });

        it("Should revoke roles", async function() {
            await expect(v3FundManager.revokeRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v3FundManager, "RoleRevoked").withArgs(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, admin.address);
            expect(await v3FundManager.hasRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19])).to.be.false;
        });

        it("Should fail to revoke roles if not admin", async function() {
            await expect(v3FundManager.connect(accounts[8]).revokeRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), await v3FundManager.getAddress())).to.be.reverted;
        });            

        it("Should transfer admin", async function() {
            await expect(v3FundManager.grantRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.emit(v3FundManager, "RoleGranted").withArgs(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address, admin.address);
            await expect(v3FundManager.connect(accounts[19]).transferAdmin(accounts[7].address)).to.emit(v3FundManager, "AdminTransferred").withArgs(accounts[19].address, accounts[7].address);
            expect(await v3FundManager.hasRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[19].address)).to.be.false;
            expect(await v3FundManager.hasRole(await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[7].address)).to.be.true;
        });

        it("Should fail to transfer admin if not admin", async function() {
            await expect(v3FundManager.connect(accounts[8]).transferAdmin(accounts[7].address)).to.be.reverted;
        });

        it("Should emergency withdraw", async function() {
            await dummy.mint(await v3FundManager.getAddress(), ethers.parseEther("100"));
            await expect(v3FundManager.connect(accounts[7]).emergencyWithdraw(await dummy.getAddress(), accounts[10].address, ethers.parseEther("100"))).to.emit(v3FundManager, "EmergencyWithdraw").withArgs(await dummy.getAddress(), accounts[10].address, ethers.parseEther("100"));
        });

        it("Should fail to emergency withdraw if not admin", async function() {
            await expect(v3FundManager.connect(accounts[8]).emergencyWithdraw(await dummy.getAddress(), accounts[10].address, ethers.parseEther("100"))).to.be.reverted;
        });
    });

    describe("Add/Remove/Update V1 Pools Tests", async function() {
        
        it("Should fail to add pool if not pool manager", async function() {
            await expect(v3FundManager.connect(accounts[18]).addPool(await dummy.getAddress(), "cPool 1", 10000)).to.be.revertedWithCustomError(v3FundManager, "AccessDenied").withArgs(accounts[18].address);
        });
        
        it("Should fail to add pool if pool is not active", async function() {
            await expect(v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 2", 10000)).to.be.revertedWithCustomError(v3FundManager, "V1PoolIsNotActive").withArgs("cPool 2");
        });
        
        it("Should fail to add pool if pool has different pool token", async function() {
            await diamondV1.setPoolStatus("cPool 1", 1);
            await expect(v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 1", 10000)).to.be.revertedWithCustomError(v3FundManager, "InvalidV1Pool").withArgs("cPool 1");
        });
        
        it("Should add pool", async function() {
            await diamondV1.setPoolToken(await dummy.getAddress());
            await expect(v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 1", 10000)).to.emit(v3FundManager, "V1PoolAdded").withArgs(poolManager.address, await dummy.getAddress(), 10000, "cPool 1");
        });

        it("Should fail to add pool if pool already exists", async function() {
            await expect(v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 1", 10000)).to.be.revertedWithCustomError(v3FundManager, "DuplicatePool").withArgs("cPool 1");
        });

        it("Should remove pool", async function() {
            await expect(v3FundManager.connect(poolManager).removePool(await dummy.getAddress(), 0)).to.emit(v3FundManager, "V1PoolRemoved").withArgs(poolManager.address, await dummy.getAddress(), 10000, "cPool 1");
            expect(await v3FundManager.totalV1Pools(await dummy.getAddress())).to.be.equal(0);
            expect(await v3FundManager.totalAllocation(await dummy.getAddress())).to.be.equal(0);
        });

        it("Should fail to remove pool if not pool manager", async function() {
            await expect(v3FundManager.connect(accounts[18]).removePool(await dummy.getAddress(), 0)).to.be.revertedWithCustomError(v3FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should update allocation", async function() {
            await diamondV1.setPoolStatus("cPool 1", 1);
            await v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 1", 10000);
            await expect(v3FundManager.connect(poolManager).updatePoolAllocation(await dummy.getAddress(), 0, 5000)).to.emit(v3FundManager, "V1PoolAllocationUpdated").withArgs(poolManager.address, await dummy.getAddress(), 10000, 5000, "cPool 1");
            expect(await v3FundManager.totalV1Pools(await dummy.getAddress())).to.be.equal(1);
            expect(await v3FundManager.totalAllocation(await dummy.getAddress())).to.be.equal(5000);
        });

        it("Should fail to update allocation if not pool manager", async function() {
            await expect(v3FundManager.connect(accounts[18]).updatePoolAllocation(await dummy.getAddress(), 0, 5000)).to.be.revertedWithCustomError(v3FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should fail to update allocation if total exceeds 100%", async function() {
            await expect(v3FundManager.connect(poolManager).updatePoolAllocation(await dummy.getAddress(), 0, 20000)).to.be.revertedWithCustomError(v3FundManager, "InvalidAllocation").withArgs(20000, await dummy.getAddress());
        });
    });

    describe("Manage Funds Tests", async function() {
        before(async function() {
            await v3FundManager.connect(poolManager).updatePoolAllocation(await dummy.getAddress(), 0, 10000);
            await diamondV1.setPoolStatus("cPool 2", 1);
            await diamondV1.setPoolStatus("cPool 3", 1);
            await diamondV1.setPoolStatus("cPool 4", 1);
            await v3Pool.deposit(ethers.parseEther("100"), accounts[0]);
        });

        it("Should deploy funds in a single pool", async function() {
            await expect(v3FundManager.connect(poolManager).deployFunds(await dummy.getAddress())).to.emit(v3FundManager, "FundDeployed").withArgs(poolManager.address, await dummy.getAddress(), ethers.parseEther("90"));
            expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.be.equal(ethers.parseEther("0"));
        });

        it("Should partially deploy funds in a single pool", async function() {
            await v3Pool.deposit(ethers.parseEther("100"), accounts[0]);
            await expect(v3FundManager.connect(poolManager).deployFundsPartially(await dummy.getAddress(), ethers.parseEther("50"))).to.emit(v3FundManager, "FundDeployed").withArgs(poolManager.address, await dummy.getAddress(), ethers.parseEther("50"));
            expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.be.equal(ethers.parseEther("40"));
        });

        it("Should deploy funds to multiple pool", async function() {
            await v3FundManager.connect(poolManager).updatePoolAllocation(await dummy.getAddress(), 0, 5000);
            await v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 2", 1000);
            await v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 3", 1000);
            await v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 4", 3000);
            await v3Pool.connect(accounts[7]).deposit(ethers.parseEther("200"), accounts[7].address);
            await expect(v3FundManager.connect(poolManager).deployFunds(await dummy.getAddress())).to.emit(v3FundManager, "FundDeployed").withArgs(poolManager.address, await dummy.getAddress(), ethers.parseEther("220"));
            expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.be.equal(ethers.parseEther("0"));
        });

        it("Should partially deploy funds to multiple pool", async function() {
            await v3Pool.connect(accounts[7]).deposit(ethers.parseEther("200"), accounts[7].address);
            await expect(v3FundManager.connect(poolManager).deployFundsPartially(await dummy.getAddress(), ethers.parseEther("100"))).to.emit(v3FundManager, "FundDeployed").withArgs(poolManager.address, await dummy.getAddress(), ethers.parseEther("100"));
            expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.be.equal(ethers.parseEther("80"));
        });

        it("Should fail to deploy funds if not pool manager", async function() {
            await expect(v3FundManager.connect(accounts[18]).deployFunds(await dummy.getAddress())).to.be.revertedWithCustomError(v3FundManager, "AccessDenied").withArgs(accounts[18].address);
            await expect(v3FundManager.connect(accounts[18]).deployFundsPartially(await dummy.getAddress(), ethers.parseEther("80"))).to.be.revertedWithCustomError(v3FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should fail if total allocation is not 100%", async function() {
            await v3FundManager.connect(poolManager).updatePoolAllocation(await dummy.getAddress(), 1, 100);
            await expect(v3FundManager.connect(poolManager).deployFunds(await dummy.getAddress())).to.be.revertedWithCustomError(v3FundManager, "InvalidAllocation").withArgs(9100, await dummy.getAddress());
            await expect(v3FundManager.connect(poolManager).deployFundsPartially(await dummy.getAddress(), ethers.parseEther("80"))).to.be.revertedWithCustomError(v3FundManager, "InvalidAllocation").withArgs(9100, await dummy.getAddress());
        });

        it("Shouble able to get correct totalAssets", async function() {
            expect(await v3FundManager.totalAssets(await dummy.getAddress())).to.equal(ethers.parseEther("540"));
        });

        it("Should claim funds", async function() {
            paymentInfo = {
                amount: ethers.parseEther("100"),
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
            await expect(v3FundManager.connect(poolManager).claimFunds(await dummy.getAddress(), [claimRequest,claimRequest,claimRequest,claimRequest])).to.emit(v3FundManager, "FundClaimed").withArgs(poolManager.address, await dummy.getAddress(), ethers.parseEther("460"));
        });

        it("Should fail to claim funds if not pool manager", async function() {
            await expect(v3FundManager.connect(accounts[18]).claimFunds(await dummy.getAddress(), [claimRequest,claimRequest,claimRequest,claimRequest])).to.be.revertedWithCustomError(v3FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should fail to send to v2 Reserve if not pool manager", async function() {
            await expect(v3FundManager.connect(accounts[18]).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("100"), 1)).to.be.revertedWithCustomError(v3FundManager, "AccessDenied").withArgs(accounts[18].address);
        });

        it("Should send to v2 Reserve", async function() {
            await dummy.mint(await v3FundManager.getAddress(), ethers.parseEther("100"));
            balanceBefore = await dummy.balanceOf(await v3FundManager.getAddress());
            balanceBeforePool = await dummy.balanceOf(await v3Pool.getAddress());
            await v3FundManager.connect(poolManager).sendToV2Reserve(await dummy.getAddress(), ethers.parseEther("100"), 1);
            expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.be.equal(balanceBefore - ethers.parseEther("100"));
            expect(await dummy.balanceOf(await v3Pool.getAddress())).to.be.equal(balanceBeforePool + ethers.parseEther("100"));
        });
    });

    describe("Pausability Tests", async function() {
        before(async function() {
            await v3FundManager.grantRole( await v3FundManager.DEFAULT_ADMIN_ROLE(), accounts[0].address);
        });
        it("Should pause contract", async function() {
            await expect(v3FundManager.connect(roleManager).pause()).to.emit(v3FundManager, "Paused").withArgs(roleManager.address);
            expect(await v3FundManager.paused()).to.be.true;
        });

        it("Should fail to execute functions if contract is paused", async function() {
            await expect(v3FundManager.connect(poolManager).deployFunds(await dummy.getAddress())).to.be.revertedWith("Pausable: paused");
            await expect(v3FundManager.connect(poolManager).claimFunds(await dummy.getAddress(), [claimRequest,claimRequest,claimRequest,claimRequest])).to.be.revertedWith("Pausable: paused");
            await expect(v3FundManager.connect(poolManager).addPool(await dummy.getAddress(), "cPool 1", 10000)).to.be.revertedWith("Pausable: paused");
            await expect(v3FundManager.connect(poolManager).removePool(await dummy.getAddress(), 0)).to.be.revertedWith("Pausable: paused");
            await expect(v3FundManager.connect(poolManager).updatePoolAllocation(await dummy.getAddress(), 0, 5000)).to.be.revertedWith("Pausable: paused");
        });

        it("Should fail to pause contract if not admin", async function() {
            await expect(v3FundManager.connect(accounts[8]).pause()).to.be.reverted;
        });

        it("Should unpause contract", async function() {
            await expect(v3FundManager.connect(roleManager).unpause()).to.emit(v3FundManager, "Unpaused").withArgs(roleManager.address);
            expect(await v3FundManager.paused()).to.be.false;
        });

        it("Should fail to unpause contract if not admin", async function() {
            await expect(v3FundManager.connect(accounts[8]).unpause()).to.be.reverted;
        });
    });

    describe("Whitelist Management", function () {

        it("should remove token from whitelist", async function () {
            const token = await v3Pool.poolToken();

            await expect(v3FundManager.connect(roleManager).removeTokenFromWhitelist(await v3Pool.getAddress()))
                .to.emit(v3FundManager, "PoolTokenRemoved")
                .withArgs(token);

            expect(await v3FundManager.isWhitelistedToken(token)).to.be.false;
            expect(await v3FundManager.pool(token)).to.equal(ZeroAddress);
        });

        it("should add token to whitelist", async function () {
            const token = await v3Pool.poolToken();

            await expect(v3FundManager.connect(roleManager).addTokenToWhitelist(await v3Pool.getAddress()))
                .to.emit(v3FundManager, "PoolTokenAdded")
                .withArgs(token);

            expect(await v3FundManager.isWhitelistedToken(token)).to.be.true;
            expect(await v3FundManager.pool(token)).to.equal(await v3Pool.getAddress());
        });

        it("should revert when token is already whitelisted", async function () {
            await expect(v3FundManager.connect(roleManager).addTokenToWhitelist(await v3Pool.getAddress()))
                .to.be.revertedWithCustomError(v3FundManager, "InvalidAddress");
        });

        it("should revert if token address is zero", async function () {
            const newPool = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            await expect(v3FundManager.connect(roleManager).addTokenToWhitelist(await newPool.getAddress()))
                .to.be.revertedWithCustomError(v3FundManager, "InvalidAddress");
        });

        it("should not allow non-roleManager to add token", async function () {
            await expect(v3FundManager.connect(accounts[10]).addTokenToWhitelist(await v3Pool.getAddress()))
                .to.be.revertedWith("AccessControl: account " + accounts[10].address.toLowerCase() + " is missing role " + await oracle.ROLE_MANAGER());
        });

        it("should revert if token is not whitelisted", async function () {
            const anotherPool = await (await ethers.getContractFactory("MockPoolV3")).deploy();

            await expect(v3FundManager.connect(roleManager).removeTokenFromWhitelist(await anotherPool.getAddress()))
                .to.be.revertedWithCustomError(v3FundManager, "InvalidAddress");
        });

        it("should not allow non-roleManager to remove token", async function () {
            await expect(v3FundManager.connect(accounts[9]).removeTokenFromWhitelist(await v3Pool.getAddress()))
                .to.be.revertedWith("AccessControl: account " + accounts[9].address.toLowerCase() + " is missing role " + await oracle.ROLE_MANAGER());
        });
    });

    describe("Manual Swaps Tests", function () {
        const swapAmount = ethers.parseEther("50");

        it("Should perform manual swap out", async function () {
            // Fund contract with dummy tokens
            await dummy.mint(await v3FundManager.getAddress(), swapAmount);

            // Check initial off-chain balance
            const initialAccountBalance = await dummy.balanceOf(accounts[10].address);
            const initialOffChain = await v3FundManager.offChainBalance(await dummy.getAddress());

            await expect(
                v3FundManager.connect(poolManager).manualSwapOut(
                    await dummy.getAddress(),
                    accounts[10].address,
                    swapAmount
                )
            )
                .to.emit(v3FundManager, "SwapOut")
                .withArgs(poolManager.address, accounts[10].address, await dummy.getAddress(), swapAmount);

            expect(await dummy.balanceOf(accounts[10].address)).to.equal(initialAccountBalance+swapAmount);
            expect(await v3FundManager.offChainBalance(await dummy.getAddress()))
                .to.equal(initialOffChain + swapAmount);
        });

        it("Should fail manual swap out if not pool manager", async function () {
            await expect(
                v3FundManager.connect(accounts[3]).manualSwapOut(
                    await dummy.getAddress(),
                    accounts[10].address,
                    swapAmount
                )
            ).to.be.revertedWithCustomError(v3FundManager, "AccessDenied");
        });

        it("Should perform manual swap in", async function () {
            await dummy.connect(poolManager).approve(await v3FundManager.getAddress(), swapAmount);

            const offChainBefore = await v3FundManager.offChainBalance(await dummy.getAddress());
            const swapInAmount = swapAmount - ethers.parseEther("10");

            await expect(
                v3FundManager.connect(poolManager).manualSwapIn(
                    await dummy.getAddress(),
                    swapInAmount,
                    await dummy.getAddress(),
                    swapAmount
                )
            )
                .to.emit(v3FundManager, "SwapIn")
                .withArgs(poolManager.address, await dummy.getAddress(), swapInAmount, await dummy.getAddress(), swapAmount);

            expect(await v3FundManager.offChainBalance(await dummy.getAddress()))
                .to.equal(offChainBefore - swapAmount);
            expect(await dummy.balanceOf(await v3FundManager.getAddress())).to.be.gte(swapAmount);
        });

        it("Should fail manual swap in if not pool manager", async function () {
            await expect(
                v3FundManager.connect(accounts[3]).manualSwapIn(
                    await dummy.getAddress(),
                    swapAmount,
                    await dummy.getAddress(),
                    swapAmount
                )
            ).to.be.revertedWithCustomError(v3FundManager, "AccessDenied");
        });

        it("Should fail if input token is not whitelisted", async function () {
            const badToken = await (await ethers.getContractFactory("MockERC20")).deploy();

            await badToken.mint(poolManager.address, swapAmount);
            await badToken.connect(poolManager).approve(await v3FundManager.getAddress(), swapAmount);

            await expect(
                v3FundManager.connect(poolManager).manualSwapIn(
                    await badToken.getAddress(),
                    swapAmount,
                    await dummy.getAddress(),
                    swapAmount
                )
            ).to.be.revertedWithCustomError(v3FundManager, "InvalidAddress");
        });
    });

    describe("swapExactInputSingle", function () {
        let mockRouter, tokenIn, tokenOut, fm2, poolIn, poolOut, key;
        const preExisting = ethers.parseEther("500");
        const amountIn = ethers.parseEther("100");
        const swapOutput = ethers.parseEther("100");

        before(async function () {
            mockRouter = await (await ethers.getContractFactory("MockSwapRouter")).deploy();

            // A second fund manager wired to the mock, since the shared fixture points
            // router/permit2 at an EOA and cannot reach the swap body.
            const fmLogic = await (await ethers.getContractFactory("CSUSDFundManager")).deploy();
            const fmProxy = await proxyFactory.deploy(
                await fmLogic.getAddress(),
                fmLogic.interface.encodeFunctionData("initialize", [
                    await diamondV1.getAddress(),
                    "LENDER2",
                    roleManager.address,
                    await mockRouter.getAddress(),
                    accounts[20].address,
                    await mockRouter.getAddress()
                ])
            );
            fm2 = await ethers.getContractAt("CSUSDFundManager", await fmProxy.getAddress());

            tokenIn = await dummyFactory.deploy();
            tokenOut = await dummyFactory.deploy();

            poolIn = await MockPool.deploy();
            await poolIn.setPoolToken(await tokenIn.getAddress());
            await poolIn.setPoolManager(poolManager.address);

            poolOut = await MockPool.deploy();
            await poolOut.setPoolToken(await tokenOut.getAddress());
            await poolOut.setPoolManager(poolManager.address);

            await fm2.connect(roleManager).addTokenToWhitelist(await poolIn.getAddress());
            await fm2.connect(roleManager).addTokenToWhitelist(await poolOut.getAddress());

            key = [await tokenIn.getAddress(), await tokenOut.getAddress(), 3000, 60, ZeroAddress];

            await tokenIn.mint(await fm2.getAddress(), ethers.parseEther("1000"));
            await tokenOut.mint(await fm2.getAddress(), preExisting); // pre-existing balance
        });

        it("Should revert if the output token is not whitelisted", async function () {
            const badToken = await dummyFactory.deploy();

            await expect(
                v3FundManager.connect(poolManager).swapExactInputSingle(
                    [await dummy.getAddress(), await badToken.getAddress(), 3000, 60, ZeroAddress],
                    true,
                    amountIn,
                    0,
                    await dummy.getAddress(),
                    await badToken.getAddress()
                )
            ).to.be.revertedWithCustomError(v3FundManager, "InvalidAddress");
        });

        it("Should revert if the input token is not whitelisted", async function () {
            const badPool = await MockPool.deploy();
            const badToken = await dummyFactory.deploy();
            await badPool.setPoolToken(await badToken.getAddress());
            await badPool.setPoolManager(poolManager.address);
            await fm2.connect(roleManager).addTokenToWhitelist(await badPool.getAddress());
            await fm2.connect(roleManager).removeTokenFromWhitelist(await badPool.getAddress());

            await expect(
                fm2.connect(poolManager).swapExactInputSingle(
                    key, true, amountIn, 0, await badToken.getAddress(), await tokenOut.getAddress()
                )
            ).to.be.reverted;
        });

        it("Should report amountOut as the swap delta, not the total output token balance", async function () {
            await tokenOut.mint(await mockRouter.getAddress(), swapOutput);
            await mockRouter.setSwap(
                await tokenIn.getAddress(), amountIn, await tokenOut.getAddress(), swapOutput
            );

            const balanceBefore = await tokenOut.balanceOf(await fm2.getAddress());
            expect(balanceBefore).to.equal(preExisting); // the contract already holds the output token

            const returned = await fm2.connect(poolManager).swapExactInputSingle.staticCall(
                key, true, amountIn, swapOutput, await tokenIn.getAddress(), await tokenOut.getAddress()
            );
            expect(returned).to.equal(swapOutput); // not preExisting + swapOutput

            const tx = await fm2.connect(poolManager).swapExactInputSingle(
                key, true, amountIn, swapOutput, await tokenIn.getAddress(), await tokenOut.getAddress()
            );
            const receipt = await tx.wait();
            const swapEvent = receipt.logs
                .map((log) => { try { return fm2.interface.parseLog(log); } catch { return null; } })
                .find((log) => log && log.name === "Swap");

            expect(swapEvent.args.amountOut).to.equal(swapOutput); // event must not report the full balance
            expect(await tokenOut.balanceOf(await fm2.getAddress())).to.equal(balanceBefore + swapOutput);
        });

        it("Should revert on insufficient output even when the contract already holds the output token", async function () {
            // Pre-existing balance is far above minAmountOut, but the swap itself returns almost nothing
            await tokenOut.mint(await mockRouter.getAddress(), 1n);
            await mockRouter.setSwap(
                await tokenIn.getAddress(), amountIn, await tokenOut.getAddress(), 1n
            );

            await expect(
                fm2.connect(poolManager).swapExactInputSingle(
                    key, true, amountIn, swapOutput, await tokenIn.getAddress(), await tokenOut.getAddress()
                )
            ).to.be.revertedWith("Insufficient output amount");
        });

        it("Should revert if not called by the pool manager", async function () {
            await expect(
                fm2.connect(accounts[3]).swapExactInputSingle(
                    key, true, amountIn, 0, await tokenIn.getAddress(), await tokenOut.getAddress()
                )
            ).to.be.revertedWithCustomError(fm2, "AccessDenied");
        });
    });

    describe("Upgradeability", function () {
        it("should reject upgrade from non-admin", async () => {
            const NewLogic = await ethers.getContractFactory("CSUSDFundManager");
            const newLogic = await NewLogic.deploy();

            await expect(
                v3FundManager.connect(roleManager).upgradeTo(newLogic.target)
            )
                .to.be.revertedWith("AccessControl: account " + roleManager.address.toLowerCase() + " is missing role " + await v3FundManager.DEFAULT_ADMIN_ROLE());
        });

        it("should upgrade from admin", async () => {
            const NewLogic = await ethers.getContractFactory("CSUSDFundManager");
            const newLogic = await NewLogic.deploy();

            await expect(
                v3FundManager.connect(accounts[7]).upgradeTo(newLogic.target)
            ).not.to.be.reverted;
        });
    });
});