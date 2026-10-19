const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CsigmaAssetOracle", function () {
    let oracle, proxy, proxyFactory, dummy, dummyFactory, csUSD, mockFeed, pool, admin, roleManager, controller, user;
    let MockFeed, MockPool, Oracle, accounts;

    beforeEach(async function () {
        accounts = await ethers.getSigners();
        [admin, roleManager, controller, user] = accounts;

        const CsigmaUSD = await ethers.getContractFactory("CsigmaUSD");
        csUSD = await CsigmaUSD.deploy();
        proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
        proxy = await proxyFactory.deploy(await csUSD.getAddress(), "0x");
        csUSD = await ethers.getContractAt("CsigmaUSD",await proxy.getAddress());

        let chainAnalysisFactory = await ethers.getContractFactory("MockChainAnalysis");
        chainAnalysis = await chainAnalysisFactory.deploy();
        await chainAnalysis.sanction(controller.address, true);
        // v2Factory.setChainAnalysis(await chainAnalysis.getAddress());

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
        oracle = await ethers.getContractAt("CsigmaAssetOracle",await proxy.getAddress());
        await oracle.connect(roleManager).addSupportedAsset(
            await pool.getAddress(),
            await dummy.getAddress(),
            await mockFeed.getAddress(),
            0,
            ethers.parseUnits("0.90", 18),
            ethers.parseUnits("1.10", 18)
        );
    });

    describe("Initialization", function () {
        it("should initialize correctly", async function () {
            expect(await oracle.shareToken()).to.equal(await csUSD.getAddress());
            expect(await oracle.hasRole(await oracle.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
            expect(await oracle.hasRole(await oracle.ROLE_MANAGER(), roleManager.address)).to.be.true;

            // const poolFundManager = await pool.fundManager();
            // expect(await oracle.hasRole(await oracle.ROLE_ORACLE_MANAGER(), poolFundManager)).to.be.true;
        
            expect(await oracle.isSupported(await dummy.getAddress())).to.be.true;
        
            // const aum = await oracle.getAssetUnderManagement(pool.getAddress());
            // expect(aum).to.equal(0);
        
            // const aumInfo = await oracle.aumInfo(pool.getAddress());
            // expect(aumInfo.AUMLastUpdatedAt).to.equal(0);
            // expect(aumInfo.AUMChangeThresholdPercentage).to.equal(10008);
            // expect(aumInfo.AUMUpdateCooldownPeriod).to.equal(2 * 60 * 60); // 2 hours

            const info = await oracle.assetInfo(await dummy.getAddress());
            expect(info.pool).to.equal(await pool.getAddress());
            expect(info.priceFeed).to.equal(await mockFeed.getAddress());
            expect(info.tokenDecimals).to.equal(await dummy.decimals());
            expect(info.priceFeedDecimals).to.equal(8);
            expect(info.lowerBound).to.equal(ethers.parseUnits("0.9", 18));
            expect(info.upperBound).to.equal(ethers.parseUnits("1.1", 18));
            expect(info.validityPeriod).to.equal(0);
        });
    });

    describe("Access Control Tests for CsigmaAssetOracle", function () {
        it("should grant ROLE_MANAGER by admin", async function () {
            await expect(oracle.addRoleManager(accounts[6].address))
                .to.emit(oracle, "RoleManagerAdded")
                .withArgs(accounts[6].address);
            expect(await oracle.hasRole(await oracle.ROLE_MANAGER(), accounts[6].address)).to.be.true;
        });
    
        it("should revoke ROLE_MANAGER by admin", async function () {
            await oracle.grantRole(await oracle.ROLE_MANAGER(), accounts[6].address);
            await expect(oracle.removeRoleManager(accounts[6].address))
                .to.emit(oracle, "RoleManagerRemoved")
                .withArgs(accounts[6].address);
            expect(await oracle.hasRole(await oracle.ROLE_MANAGER(), accounts[6].address)).to.be.false;
        });
    
        it("should revert addRoleManager if not admin", async function () {
            await expect(oracle.connect(accounts[8]).addRoleManager(accounts[9].address))
                .to.be.revertedWith("AccessControl: account " + accounts[8].address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });
    
        it("should revert removeRoleManager if not admin", async function () {
            await expect(oracle.connect(accounts[8]).removeRoleManager(accounts[9].address))
                .to.be.revertedWith("AccessControl: account " + accounts[8].address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });
    
        it("should allow admin to upgrade the oracle contract", async function () {
            const NewOracleLogic = await ethers.getContractFactory("CsigmaAssetOracle");
            const newImpl = await NewOracleLogic.deploy();

            // Perform the upgrade from the admin account
            await expect(
                oracle.connect(admin).upgradeTo(await newImpl.getAddress())
            ).to.not.be.reverted;
        });

        it("should revert upgrade if not called by admin", async function () {
            const NewOracleLogic = await ethers.getContractFactory("CsigmaAssetOracle");
            const newImpl = await NewOracleLogic.deploy();

            await expect(
                oracle.connect(accounts[8]).upgradeTo(await newImpl.getAddress())
            ).to.be.revertedWith("AccessControl: account " + accounts[8].address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });

    });
    

    describe("Asset Details Management", function () {
        let newToken, newFeed;
    
        beforeEach(async function () {
            newToken = await dummyFactory.deploy();
            newFeed = await MockFeed.deploy(8, "101000000"); // $1.01
        });
    
        it("Should allow ROLE_MANAGER to add asset and emit event", async function () {
            await expect(
                oracle.connect(roleManager).addSupportedAsset(
                    await pool.getAddress(),
                    await newToken.getAddress(),
                    await newFeed.getAddress(),
                    3600,
                    ethers.parseUnits("0.80", 18),
                    ethers.parseUnits("1.20", 18)
                )
            ).to.emit(oracle, "AssetAdded");
    
            expect(await oracle.isSupported(await newToken.getAddress())).to.be.true;
    
            const info = await oracle.assetInfo(await newToken.getAddress());
            expect(info.pool).to.equal(await pool.getAddress());
            expect(info.priceFeed).to.equal(await newFeed.getAddress());
            expect(info.tokenDecimals).to.equal(await newToken.decimals());
            expect(info.priceFeedDecimals).to.equal(8);
            expect(info.lowerBound).to.equal(ethers.parseUnits("0.80", 18));
            expect(info.upperBound).to.equal(ethers.parseUnits("1.20", 18));
            expect(info.validityPeriod).to.equal(3600);
        });
    
        it("Should allow ROLE_MANAGER to remove asset and emit event", async function () {
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                3600,
                ethers.parseUnits("0.80", 18),
                ethers.parseUnits("1.20", 18)
            );
    
            expect(await oracle.isSupported(await newToken.getAddress())).to.be.true;
    
            await expect(
                oracle.connect(roleManager).removeAsset(await newToken.getAddress())
            ).to.emit(oracle, "AssetRemoved").withArgs(await newToken.getAddress());
    
            expect(await oracle.isSupported(await newToken.getAddress())).to.be.false;
        });
    
        it("Should revert if non-manager adds asset", async function () {
            await expect(
                oracle.connect(user).addSupportedAsset(
                    await pool.getAddress(),
                    await newToken.getAddress(),
                    await newFeed.getAddress(),
                    3600,
                    ethers.parseUnits("0.99", 18),
                    ethers.parseUnits("1.01", 18)
                )
            ).to.be.revertedWith(/AccessControl/);
        });

        it("Should revert if non-manager removes asset", async function () {
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                3600,
                ethers.parseUnits("0.80", 18),
                ethers.parseUnits("1.20", 18)
            );
    
            await expect(
                oracle.connect(user).removeAsset(await dummy.getAddress())
            ).to.be.revertedWith(/AccessControl/);
        });
    
        it("Should revert if any input is zero address", async function () {
            await expect(
                oracle.connect(roleManager).addSupportedAsset(
                    ethers.ZeroAddress,
                    await newToken.getAddress(),
                    await newFeed.getAddress(),
                    3600,
                    ethers.parseUnits("0.99", 18),
                    ethers.parseUnits("1.01", 18)
                )
            ).to.be.revertedWith("invalid input");
    
            await expect(
                oracle.connect(roleManager).addSupportedAsset(
                    await pool.getAddress(),
                    ethers.ZeroAddress,
                    await newFeed.getAddress(),
                    3600,
                    ethers.parseUnits("0.99", 18),
                    ethers.parseUnits("1.01", 18)
                )
            ).to.be.revertedWith("invalid input");
    
            await expect(
                oracle.connect(roleManager).addSupportedAsset(
                    await pool.getAddress(),
                    await newToken.getAddress(),
                    ethers.ZeroAddress,
                    3600,
                    ethers.parseUnits("0.99", 18),
                    ethers.parseUnits("1.01", 18)
                )
            ).to.be.revertedWith("invalid input");
        });

        it("Should update existing asset without duplicating in supportedAssets array", async function () {
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                3600,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
        
            const initialSupportedAssets = await oracle.getSupportedAssets();
            expect(initialSupportedAssets).to.include(await newToken.getAddress());
            const initialLength = initialSupportedAssets.length;
        
            // Call again with updated feed + bounds
            const updatedFeed = await MockFeed.deploy(8, "101000000");
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await newToken.getAddress(),
                await updatedFeed.getAddress(),
                1800,
                ethers.parseUnits("0.95", 18),
                ethers.parseUnits("1.05", 18)
            );
        
            const updatedSupportedAssets = await oracle.getSupportedAssets();
            expect(updatedSupportedAssets.length).to.equal(initialLength); // no new element
        
            const updatedInfo = await oracle.assetInfo(await newToken.getAddress());
            expect(updatedInfo.priceFeed).to.equal(await updatedFeed.getAddress());
            expect(updatedInfo.lowerBound).to.equal(ethers.parseUnits("0.95", 18));
            expect(updatedInfo.upperBound).to.equal(ethers.parseUnits("1.05", 18));
            expect(updatedInfo.validityPeriod).to.equal(1800);
        });

        it("Should not duplicate a disabled asset in supportedAssets when it is re-added", async function () {
            const newPool = await MockPool.deploy();
            await newPool.setTotalAssets(ethers.parseUnits("1000", await newToken.decimals()));

            await oracle.connect(roleManager).addSupportedAsset(
                await newPool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                0,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );

            const lengthAfterAdd = (await oracle.getSupportedAssets()).length;
            const totalAfterAdd = await oracle.totalAssetsUSD();

            // Disable, then re-enable the same asset
            await oracle.connect(roleManager).removeAsset(await newToken.getAddress());
            expect(await oracle.isSupported(await newToken.getAddress())).to.be.false;

            await oracle.connect(roleManager).addSupportedAsset(
                await newPool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                0,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
            expect(await oracle.isSupported(await newToken.getAddress())).to.be.true;

            const newTokenAddress = await newToken.getAddress();
            const supportedAssets = await oracle.getSupportedAssets();
            expect(supportedAssets.length).to.equal(lengthAfterAdd); // no new element
            expect(supportedAssets.filter((a) => a === newTokenAddress).length).to.equal(1);

            // a duplicate entry would count the pool's assets twice
            expect(await oracle.totalAssetsUSD()).to.equal(totalAfterAdd);
        });

        it("should support price feed with 12 decimals", async function () {
            const token = await dummyFactory.deploy();
            const feed = await MockFeed.deploy(12, "1234567890120"); // 12 decimal feed
        
            const pool12 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            await oracle.connect(roleManager).addSupportedAsset(
                pool12.getAddress(),
                token.getAddress(),
                feed.getAddress(),
                0,
                ethers.parseUnits("0.5", 18),
                ethers.parseUnits("2.0", 18)
            );
        
            const info = await oracle.assetInfo(token.getAddress());
            expect(info.priceFeedDecimals).to.equal(12);
        
            const price = await oracle.getPrice(token.getAddress(), false);
            expect(price).to.equal("1234567890120000000"); // normalize to 1e18
        });

        it("should support price feed with 18 decimals", async function () {
            const token = await dummyFactory.deploy();
            const feed = await MockFeed.deploy(18, "2000000000000000000"); // 2.0 USD
        
            const pool18 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            await oracle.connect(roleManager).addSupportedAsset(
                pool18.getAddress(),
                token.getAddress(),
                feed.getAddress(),
                0,
                ethers.parseUnits("1.0", 18),
                ethers.parseUnits("3.0", 18)
            );
        
            const info = await oracle.assetInfo(token.getAddress());
            expect(info.priceFeedDecimals).to.equal(18);
        
            const price = await oracle.getPrice(token.getAddress(), false);
            expect(price).to.equal("2000000000000000000"); // already 1e18
        });

        describe("Asset Price Tolerance Updates", function () {
            it("should allow ROLE_MANAGER to update price tolerance", async function () {
                const lower = ethers.parseUnits("0.85", 18);
                const upper = ethers.parseUnits("1.10", 18);
                await expect(oracle.connect(roleManager).updateAssetPriceRange(await dummy.getAddress(), lower, upper))
                    .to.not.be.reverted;
        
                const info = await oracle.assetInfo(await dummy.getAddress());
                expect(info.lowerBound).to.equal(lower);
                expect(info.upperBound).to.equal(upper);
            });
        
            it("should revert if non-manager tries to update price tolerance", async function () {
                const lower = ethers.parseUnits("0.85", 18);
                const upper = ethers.parseUnits("1.10", 18);
                await expect(
                    oracle.connect(user).updateAssetPriceRange(await dummy.getAddress(), lower, upper)
                ).to.be.revertedWith(/AccessControl/);
            });
        
            it("should revert if asset is not supported", async function () {
                const newToken = await dummyFactory.deploy();
                await expect(
                    oracle.connect(roleManager).updateAssetPriceRange(await newToken.getAddress(), 0, 0)
                ).to.be.revertedWith("unsupported asset");
            });
        });
    });    

    describe("Price Oracle", function () {
        it("Should return normalized price without bounds check (strict = false)", async function () {
            const price = await oracle.getPrice(await dummy.getAddress(), false);
            expect(price).to.equal(ethers.parseUnits("1", 18));
        });
    
        it("Should revert if price is out of upper bounds when strict = true", async function () {
            await mockFeed.setAnswer("120000000"); // 1.2 USD
            await expect(oracle.getPrice(await dummy.getAddress(), true)).to.be.revertedWith("price out-of-range");
        });

        it("Should revert if price is out of lower bounds when strict = true", async function () {
            await mockFeed.setAnswer("80000000"); // 0.8 USD
            await expect(oracle.getPrice(await dummy.getAddress(), true)).to.be.revertedWith("price out-of-range");
        });

        it("Should not revert if price is out of configration bounds when strict = false", async function () {
            await mockFeed.setAnswer("80000000"); // 0.8 USD
            await expect(oracle.getPrice(await dummy.getAddress(), false)).to.be.not.reverted;

            await mockFeed.setAnswer("120000000"); // 1.2 USD
            await expect(oracle.getPrice(await dummy.getAddress(), false)).to.be.not.reverted;
        });
    
        it("Should succeed if price is within bounds when strict = true", async function () {
            await mockFeed.setAnswer("100000000"); // Reset back to 1.0 USD
            const price = await oracle.getPrice(await dummy.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1", 18));
        });
    
        it("Should revert with 'unsupported asset' if token is not whitelisted", async function () {
            const fakeToken = await dummyFactory.deploy();
            await expect(oracle.getPrice(await fakeToken.getAddress(), false)).to.be.reverted;
        });
    
        it("Should revert if price is stale based on validityPeriod", async function () {
            const newToken = await dummyFactory.deploy();
            const newFeed = await MockFeed.deploy(8, "100000000");
    
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                3600, // 1 hour validity
                ethers.parseUnits("0.99", 18),
                ethers.parseUnits("1.01", 18)
            );
    
            // Simulate time passing
            await network.provider.send("evm_increaseTime", [3601]);
            await network.provider.send("evm_mine");
    
            await expect(oracle.getPrice(await newToken.getAddress(), true)).to.be.revertedWith("stale oracle price");
        });
    
        it("Should succeed if price is within validity period", async function () {
            const newToken = await dummyFactory.deploy();
            const newFeed = await MockFeed.deploy(8, "100000000");
    
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                3600,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
    
            const price = await oracle.getPrice(await newToken.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1", 18));
        });

        it("Should correctly normalize price for 6 decimal token", async function () {
            // USDT/USDC
            const token6 = await dummyFactory.deploy();
            await token6.setDecimals(6);
            const feed6 = await MockFeed.deploy(8, "100000000"); // $1.00
            
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed6.getAddress(),
                0,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
    
            const price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1", 18)); // should normalize to 18 decimals
        });

        it("Should correctly normalize price for 6 decimal token with various feed values", async function () {
            const token6 = await dummyFactory.deploy();
            await token6.setDecimals(6);
        
            // Price Feed with 8 decimals returning $1.00
            const feed = await MockFeed.deploy(8, "100000000"); // 1.00
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
        
            let price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1", 18));
        
            // Replace with feed value $1.23 (123_000_000)
            await feed.setAnswer(123000000);
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("1.0", 18),
                ethers.parseUnits("1.50", 18)
            );
        
            price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1.23", 18));
        
            // Replace with feed value $0.89 (89_000_000)
            await feed.setAnswer(89000000);
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("0.85", 18),
                ethers.parseUnits("1.10", 18)
            );
        
            price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("0.89", 18));
        
            // Replace with feed value $2.15 (215_000_000)
            await feed.setAnswer(215000000);
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("2.00", 18),
                ethers.parseUnits("2.50", 18)
            );
        
            price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("2.15", 18));
        });        
    
        it("Should correctly normalize price for 12 decimal token", async function () {
            // USDX-12
            const token12 = await dummyFactory.deploy();
            await token12.setDecimals(12);
            const feed12 = await MockFeed.deploy(8, "100000000"); // $1.00
    
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token12.getAddress(),
                await feed12.getAddress(),
                0,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
    
            const price = await oracle.getPrice(await token12.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1", 18)); // should normalize to 18 decimals
        });

        it("Should correctly normalize price for 12 decimal token with various feed values", async function () {
            const token6 = await dummyFactory.deploy();
            await token6.setDecimals(12);
        
            // Price Feed with 8 decimals returning $1.00
            const feed = await MockFeed.deploy(8, "100000000"); // 1.00
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
        
            let price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1", 18));
        
            // Replace with feed value $1.23 (123_000_000)
            await feed.setAnswer(123000000);
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("1.0", 18),
                ethers.parseUnits("1.50", 18)
            );
        
            price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("1.23", 18));
        
            // Replace with feed value $0.89 (89_000_000)
            await feed.setAnswer(89000000);
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("0.85", 18),
                ethers.parseUnits("1.10", 18)
            );
        
            price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("0.89", 18));
        
            // Replace with feed value $2.15 (215_000_000)
            await feed.setAnswer(215000000);
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("2.00", 18),
                ethers.parseUnits("2.50", 18)
            );
        
            price = await oracle.getPrice(await token6.getAddress(), true);
            expect(price).to.equal(ethers.parseUnits("2.15", 18));
        }); 
    
        it("Should revert if token has unsupported decimals (e.g. > 18)", async function () {
            const token20 = await dummyFactory.deploy();
            await token20.setDecimals(20);
            const feed = await MockFeed.deploy(8, "100000000");
    
            await expect(
                oracle.connect(roleManager).addSupportedAsset(
                    await pool.getAddress(),
                    await token20.getAddress(),
                    await feed.getAddress(),
                    0,
                    ethers.parseUnits("0.90", 18),
                    ethers.parseUnits("1.10", 18)
                )
            ).to.not.be.reverted;
    
            const price = await oracle.getPrice(await token20.getAddress(), false);
            expect(price).to.equal(ethers.parseUnits("1", 18)); // still normalize; overflow handled by uint256
        });
    });

    describe("Total Assets USD", function () {
        it("should return correct totalAssetsUSD value", async function () {
            await dummy.mint(admin.address, ethers.parseUnits("1000000", 6));
            await dummy.transfer(await pool.getAddress(), ethers.parseUnits("1000000", 6));
            await pool.setTotalAssets(ethers.parseUnits("1000000", 18));
    
            const total = await oracle.totalAssetsUSD();
            expect(total).to.equal(ethers.parseUnits("1000000", 18));
        });
    
        it("should skip unsupported assets", async function () {
            const newToken = await dummyFactory.deploy();
            const newFeed = await MockFeed.deploy(8, "200000000"); // $2.00
            const newPool = await (await ethers.getContractFactory("MockPoolV3")).deploy();
    
            await oracle.connect(roleManager).addSupportedAsset(
                await newPool.getAddress(),
                await newToken.getAddress(),
                await newFeed.getAddress(),
                3600,
                ethers.parseUnits("1.0", 18),
                ethers.parseUnits("2.5", 18)
            );
    
            await newToken.mint(admin.address, ethers.parseUnits("1000", 6));
            await newToken.transfer(newPool.getAddress(), ethers.parseUnits("1000", 6));
            await newPool.setTotalAssets(ethers.parseUnits("1000", 18));
    
            const total = await oracle.totalAssetsUSD();
            expect(total).to.equal(ethers.parseUnits("2000", 18)); // combines old + new pool value
        });
    });

    describe("Preview Functions", function () {
        it("should return correct convertToShares for 6 decimal token", async function () {
            const token6 = await dummyFactory.deploy();
            await token6.setDecimals(6);
    
            const feed = await MockFeed.deploy(8, "100000000"); // $1.00
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("0.95", 18),
                ethers.parseUnits("1.05", 18)
            );
    
            const depositAmount = 500000000; // 6 decimals 500 usdc
            const preview = await oracle.convertToShares(await token6.getAddress(), depositAmount);
            expect(preview).to.equal(ethers.parseUnits("500", 6));
        });
    
        it("should return correct convertToShares for 12 decimal token", async function () {
            const token12 = await dummyFactory.deploy();
            await token12.setDecimals(12);
    
            const feed = await MockFeed.deploy(8, "123000000"); // $1.23
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token12.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("1.0", 18),
                ethers.parseUnits("1.5", 18)
            );
    
            const depositAmount = 10_000_000_000_000; // 12 decimals
            const preview = await oracle.convertToShares(await token12.getAddress(), depositAmount);
            expect(preview).to.equal(ethers.parseUnits("12.3", 6));
        });

        it("should return correct convertToShares for 18 decimal token", async function () {
            const token12 = await dummyFactory.deploy();
    
            const feed = await MockFeed.deploy(8, "123000000"); // $1.23
            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await token12.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("1.0", 18),
                ethers.parseUnits("1.5", 18)
            );
    
            const depositAmount = ethers.parseUnits("100", 18); // 18 decimals
            const preview = await oracle.convertToShares(await token12.getAddress(), depositAmount);
            expect(preview).to.equal(ethers.parseUnits("123", 6));
        });

        it("should return correct convertToShares for multiple tokens with 6, 12, and 18 decimals and prices 1, 1.5, 2", async function () {
            // Token with 6 decimals and $1.00 price
            const token6 = await dummyFactory.deploy();
            await token6.setDecimals(6);
            const feed6 = await MockFeed.deploy(8, "100000000"); // $1.00
            const pool6 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            await oracle.connect(roleManager).addSupportedAsset(
                pool6.getAddress(),
                token6.getAddress(),
                feed6.getAddress(),
                0,
                ethers.parseUnits("0.95", 18),
                ethers.parseUnits("1.05", 18)
            );
        
            // Token with 12 decimals and $1.50 price
            const token12 = await dummyFactory.deploy();
            await token12.setDecimals(12);
            const feed12 = await MockFeed.deploy(8, "150000000"); // $1.50
            const pool12 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            await oracle.connect(roleManager).addSupportedAsset(
                pool12.getAddress(),
                token12.getAddress(),
                feed12.getAddress(),
                0,
                ethers.parseUnits("1.40", 18),
                ethers.parseUnits("1.60", 18)
            );
        
            // Token with 18 decimals and $2.00 price
            const token18 = await dummyFactory.deploy();
            await token18.setDecimals(18);
            const feed18 = await MockFeed.deploy(8, "200000000"); // $2.00
            const pool18 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            await oracle.connect(roleManager).addSupportedAsset(
                pool18.getAddress(),
                token18.getAddress(),
                feed18.getAddress(),
                0,
                ethers.parseUnits("1.90", 18),
                ethers.parseUnits("2.10", 18)
            );

            const amount6 = ethers.parseUnits("1", 6);        // $1.00
            const amount12 = ethers.parseUnits("1", 12);      // $1.50
            const amount18 = ethers.parseUnits("1", 18);      // $2.00

            let preview6 = await oracle.convertToShares(token6.getAddress(), amount6);      // $1 → 1 csUSD
            let preview12 = await oracle.convertToShares(token12.getAddress(), amount12);   // $1.5 → 1.5 csUSD
            let preview18 = await oracle.convertToShares(token18.getAddress(), amount18);   // $2 → 2 csUSD
        
            expect(preview6).to.equal(ethers.parseUnits("1", 6));  
            expect(preview12).to.equal(ethers.parseUnits("1.5", 6));  
            expect(preview18).to.equal(ethers.parseUnits("2", 6));     
        
            // Simulate initial deposit (bootstrapping supply and AUM)
            await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("3000000", 6));
            await csUSD.transfer(pool6.getAddress(), ethers.parseUnits("1000000", 6));
            await csUSD.transfer(pool12.getAddress(), ethers.parseUnits("1000000", 6));
            await csUSD.transfer(pool18.getAddress(), ethers.parseUnits("1000000", 6));
            await pool6.setTotalAssets(ethers.parseUnits("1000000", 6));
            await pool12.setTotalAssets(ethers.parseUnits("1000000", 12));
            await pool18.setTotalAssets(ethers.parseUnits("1000000", 18));
        
            
            preview6 = await oracle.convertToShares(token6.getAddress(), amount6);      // $1 → 1 csUSD
            preview12 = await oracle.convertToShares(token12.getAddress(), amount12);   // $1.5 → 1.5 csUSD
            preview18 = await oracle.convertToShares(token18.getAddress(), amount18);   // $2 → 2 csUSD
        
            expect(preview6).to.equal("666666");      // (3.00/4.50)*1.00 USD in 6 decimals
            expect(preview12).to.equal("1000000");     // (3.00/4.50)*1.50 USD in 6 decimals
            expect(preview18).to.equal("1333333");     // (3.00/4.50)*2.00 USD in 6 decimals
        });

        it("should return correct convertToAssets for 6 decimal token using separate pool", async function () {
            // Deploy token with 6 decimals
            const token6 = await dummyFactory.deploy();
            await token6.setDecimals(6);
        
            // Deploy a fresh pool for this token
            let poolFactory = await ethers.getContractFactory("MockPoolV3");
            const pool6 = await poolFactory.deploy();
        
            // Deploy a mock feed returning 0.89 (8 decimals)
            const feed = await MockFeed.deploy(8, "89000000"); // $0.89
        
            // Register this token + pool + feed in oracle
            await oracle.connect(roleManager).addSupportedAsset(
                await pool6.getAddress(),
                await token6.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("0.85", 18),
                ethers.parseUnits("1.10", 18)
            );
        
            // Setup vault asset balance for convertToAssets to reference
            await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("1000000", 6));
            await csUSD.transfer(await pool6.getAddress(), ethers.parseUnits("1000000", 6));
            await pool6.setTotalAssets(ethers.parseUnits("1000000", 6));
        
            // Try to withdraw 100 shares
            const shares = ethers.parseUnits("100", 6);
            const assets = await oracle.convertToAssets(await token6.getAddress(), shares);
        
            // $0.89 per share → 100 * 0.89 = 89 USD asset / 0.89 = 100
            expect(assets).to.equal(ethers.parseUnits("100", 6));
        });
    
        it("should return correct convertToAssets for 12 decimal token", async function () {
            const token12 = await dummyFactory.deploy();
            await token12.setDecimals(12);

            // Deploy a fresh pool for this token
            let poolFactory = await ethers.getContractFactory("MockPoolV3");
            const pool12 = await poolFactory.deploy();
    
            const feed = await MockFeed.deploy(8, "215000000"); // $2.15
            await oracle.connect(roleManager).addSupportedAsset(
                await pool12.getAddress(),
                await token12.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("2.00", 18),
                ethers.parseUnits("2.50", 18)
            );

            await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("1000000", 6));
            await csUSD.transfer(await pool.getAddress(), ethers.parseUnits("1000000", 6));
            await pool.setTotalAssets(ethers.parseUnits("1000000", 18));
    
            await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("1000000", 6));
            await csUSD.transfer(await pool12.getAddress(), ethers.parseUnits("1000000", 6));
            await pool12.setTotalAssets(ethers.parseUnits("1000000", 12));
            
            
            const shares = ethers.parseUnits("10", 6);
            const assets = await oracle.convertToAssets(await token12.getAddress(), shares);
            expect(assets).to.equal("7325581395348");

            const depositAmount = "7325581395348"; // 12 decimals
            const preview = await oracle.convertToShares(await token12.getAddress(), depositAmount);
            expect((preview > shares ? preview - shares : shares - preview) <= 1n).to.be.true;
        });

        it("should return correct convertToAssets with 18 decimal token", async function () {
            await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("100", 6));
            await csUSD.transfer(await pool.getAddress(), ethers.parseUnits("100", 6));
            await pool.setTotalAssets(ethers.parseUnits("100", 18));

            const feed = await MockFeed.deploy(8, "140000000"); // $1.4

            await oracle.connect(roleManager).addSupportedAsset(
                await pool.getAddress(),
                await dummy.getAddress(),
                await feed.getAddress(),
                0,
                ethers.parseUnits("1.0", 18),
                ethers.parseUnits("1.5", 18)
            );

            const depositAmount = ethers.parseUnits("100", 18); // 6 decimals 500 usdc
            const preview = await oracle.convertToShares(await dummy.getAddress(), depositAmount);

            const shares = ethers.parseUnits("100", 6);
            const assets = await oracle.convertToAssets(await dummy.getAddress(), shares);
            expect(assets).to.equal(ethers.parseUnits("100", 18));
            expect(preview).to.equal(shares);
        });

        it("should return accurate convertToAssets and convertToShares with mixed decimals and prices", async function () {
            const token6 = await dummyFactory.deploy();
            const token12 = await dummyFactory.deploy();
            const token18 = await dummyFactory.deploy();
        
            await token6.setDecimals(6);
            await token12.setDecimals(12);
            await token18.setDecimals(18);
        
            const feed6 = await MockFeed.deploy(8, "100000000");   // $1.00
            const feed12 = await MockFeed.deploy(8, "150000000");  // $1.50
            const feed18 = await MockFeed.deploy(8, "200000000");  // $2.00
        
            const pool6 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            const pool12 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
            const pool18 = await (await ethers.getContractFactory("MockPoolV3")).deploy();
        
            await oracle.connect(roleManager).addSupportedAsset(pool6.getAddress(), token6.getAddress(), feed6.getAddress(), 0, ethers.parseUnits("0.99", 18), ethers.parseUnits("1.01", 18));
            await oracle.connect(roleManager).addSupportedAsset(pool12.getAddress(), token12.getAddress(), feed12.getAddress(), 0, ethers.parseUnits("1.40", 18), ethers.parseUnits("1.60", 18));
            await oracle.connect(roleManager).addSupportedAsset(pool18.getAddress(), token18.getAddress(), feed18.getAddress(), 0, ethers.parseUnits("1.90", 18), ethers.parseUnits("2.10", 18));

            let shares = ethers.parseUnits("100", 6);
        
            let assets6 = await oracle.convertToAssets(token6.getAddress(), shares);
            let assets12 = await oracle.convertToAssets(token12.getAddress(), shares);
            let assets18 = await oracle.convertToAssets(token18.getAddress(), shares);
        
            expect(assets6).to.equal(ethers.parseUnits("100", 6));   //  ($1.5 * 1e18) / $1.00
            expect(assets12).to.equal("66666666666666"); //  ($1.5 * 1e18) / $1.50
            expect(assets18).to.equal(ethers.parseUnits("50", 18));  // ($1.5 * 1e18) / $2.00
        
            // Mint 1M csUSD and distribute to each pool
            for (let p of [pool6, pool12, pool18]) {
                await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("1000000", 6));
                await csUSD.transfer(await p.getAddress(), ethers.parseUnits("1000000", 6));
            }
        
            await pool6.setTotalAssets(ethers.parseUnits("1000000", 6));
            await pool12.setTotalAssets(ethers.parseUnits("1000000", 12));
            await pool18.setTotalAssets(ethers.parseUnits("1000000", 18));
        
            shares = ethers.parseUnits("100", 6);
        
            assets6 = await oracle.convertToAssets(token6.getAddress(), shares);
            assets12 = await oracle.convertToAssets(token12.getAddress(), shares);
            assets18 = await oracle.convertToAssets(token18.getAddress(), shares);
        
            expect(assets6).to.equal(ethers.parseUnits("150", 6));   //  ($1.5 * 1e18) / $1.00
            expect(assets12).to.equal(ethers.parseUnits("100", 12)); //  ($1.5 * 1e18) / $1.50
            expect(assets18).to.equal(ethers.parseUnits("75", 18));  // ($1.5 * 1e18) / $2.00
        
            const usdVal6 = await oracle.convertToShares(token6.getAddress(), assets6);
            const usdVal12 = await oracle.convertToShares(token12.getAddress(), assets12);
            const usdVal18 = await oracle.convertToShares(token18.getAddress(), assets18);
        
            for (let val of [usdVal6, usdVal12, usdVal18]) {
                expect(val).to.equal(shares);
            }
        });

        it("should return 1e18 when supply is 0", async function () {
            const rate = await oracle.exchangeRate();
            expect(rate).to.equal(ethers.WeiPerEther); // 1e18
        });
    
        it("should return correct exchange rate", async function () {
            await dummy.mint(admin.address, ethers.parseUnits("1000000", 6));
            await dummy.transfer(await pool.getAddress(), ethers.parseUnits("1000000", 6));
            await pool.setTotalAssets(ethers.parseUnits("1000000", 18));
    
            await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("1000000", 6));
    
            const rate = await oracle.exchangeRate();
            expect(rate).to.equal(ethers.WeiPerEther); // 1e18 = 1 USD/share
        });

        it("should return correct exchange rate with multiple tokens", async function () {
            // Token 1: 6 decimals, $1.00
            const token6 = await dummyFactory.deploy();
            await token6.setDecimals(6);
            const feed6 = await MockFeed.deploy(8, "100000000");
        
            // Token 2: 12 decimals, $2.00
            const token12 = await dummyFactory.deploy();
            await token12.setDecimals(12);
            const feed12 = await MockFeed.deploy(8, "200000000");
        
            // Token 3: 18 decimals, $1.50
            const token18 = await dummyFactory.deploy();
            await token18.setDecimals(18);
            const feed18 = await MockFeed.deploy(8, "150000000");
        
            // Pools
            const poolFactory = await ethers.getContractFactory("MockPoolV3");
            const pool6 = await poolFactory.deploy();
            const pool12 = await poolFactory.deploy();
            const pool18 = await poolFactory.deploy();
        
            // Register all 3 tokens
            await oracle.connect(roleManager).addSupportedAsset(
                await pool6.getAddress(),
                await token6.getAddress(),
                await feed6.getAddress(),
                0,
                ethers.parseUnits("0.90", 18),
                ethers.parseUnits("1.10", 18)
            );
            await oracle.connect(roleManager).addSupportedAsset(
                await pool12.getAddress(),
                await token12.getAddress(),
                await feed12.getAddress(),
                0,
                ethers.parseUnits("1.90", 18),
                ethers.parseUnits("2.10", 18)
            );
            await oracle.connect(roleManager).addSupportedAsset(
                await pool18.getAddress(),
                await token18.getAddress(),
                await feed18.getAddress(),
                0,
                ethers.parseUnits("1.40", 18),
                ethers.parseUnits("1.60", 18)
            );
        
            // Simulate AUM in all pools
            await token6.mint(admin.address, ethers.parseUnits("1000000", 6));
            await token6.transfer(await pool6.getAddress(), ethers.parseUnits("1000000", 6));
            await pool6.setTotalAssets(ethers.parseUnits("1000000", 6));
        
            await token12.mint(admin.address, ethers.parseUnits("1000000", 12));
            await token12.transfer(await pool12.getAddress(), ethers.parseUnits("1000000", 12));
            await pool12.setTotalAssets(ethers.parseUnits("1000000", 12));
        
            await token18.mint(admin.address, ethers.parseUnits("1000000", 18));
            await token18.transfer(await pool18.getAddress(), ethers.parseUnits("1000000", 18));
            await pool18.setTotalAssets(ethers.parseUnits("1000000", 18));
        
            // Mint csUSD
            await csUSD.connect(controller).mint(admin.address, ethers.parseUnits("3000000", 6));
        
            // Expect total USD value = $1M + $2M + $1.5M = $4.5M
            // Total supply = 3M * 1e6 = 3e6 * 1e6 = 3e12 (in 6 decimals)
            // exchangeRate = totalAssetsUSD * 1e18 / (3e12 * 1e12) = 4.5e18 / 3e12 = 1.5e6 * 1e12 = 1.5e18
            const rate = await oracle.exchangeRate();
            expect(rate).to.equal(ethers.parseUnits("1.5", 18));
        });
        
    });    

    // describe("AUM Updates", function () {

    //     it("should allow emergency AUM update by admin", async function () {
    //         const tx = await oracle.emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("500", 18));
    //         await expect(tx).to.emit(oracle, "AssetUnderManagementUpdated")
    //             .withArgs(await pool.getAddress(), admin.address, 0, ethers.parseUnits("500", 18));
    
    //         const aum = await oracle.getAssetUnderManagement(await pool.getAddress());
    //         expect(aum).to.equal(ethers.parseUnits("500", 18));
    //     });
    
    //     it("should restrict emergency AUM update to admin only", async function () {
    //         await expect(
    //             oracle.connect(user).emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("1", 18))
    //         ).to.be.revertedWith(/AccessControl/);
    //     });
    
    //     it("should allow AUM update with pause logic by fundManager", async function () {
    //         await oracle.emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("1000000", 18));
    //         await pool.setStatus(1); // ACTIVE
    //         await pool.setPauseConfig(0, 3600); // pause from 0-3600 seconds
    //         const tx = await oracle.connect(oracleManager).updateAssetUnderManagement(
    //             await pool.getAddress(),
    //             ethers.parseUnits("1000010", 18)
    //         );
    //         await expect(tx).to.emit(oracle, "AssetUnderManagementUpdated")
    //             .withArgs(await pool.getAddress(), oracleManager.address, ethers.parseUnits("1000000", 18), ethers.parseUnits("1000010", 18));
    
    //         const aum = await oracle.getAssetUnderManagement(await pool.getAddress());
    //         expect(aum).to.equal(ethers.parseUnits("1000010", 18));
    //     });
    
    //     it("should fail AUM update if threshold is not met", async function () {
    //         await oracle.emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("1000000", 18));
    //         await pool.setStatus(1);
    //         await pool.setPauseConfig(0, 3600);
    //         await expect(
    //             oracle.connect(oracleManager).updateAssetUnderManagement(
    //                 await pool.getAddress(),
    //                 ethers.parseUnits("1000801", 18) // < 0.08% threshold
    //             )
    //         ).to.be.revertedWith("Threshold not met");
    //     });

    //     it("should fail AUM update if threshold is not met when new aum is less the currect", async function () {
    //         await oracle.emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("1000000", 18));
    //         await pool.setStatus(1);
    //         await pool.setPauseConfig(0, 3600);
    //         await expect(
    //             oracle.connect(oracleManager).updateAssetUnderManagement(
    //                 await pool.getAddress(),
    //                 ethers.parseUnits("100000", 18) // old aum > new aum
    //             )
    //         ).to.be.revertedWith("Threshold not met");
    //     });
    
    //     it("should fail AUM update if cooldown not elapsed", async function () {
    //         await oracle.emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("1000000", 18));
    //         await pool.setStatus(1);
    //         await pool.setPauseConfig(0, 3600);
    //         await oracle.connect(oracleManager).updateAssetUnderManagement(
    //             await pool.getAddress(),
    //             ethers.parseUnits("1000010", 18)
    //         );
    
    //         await expect(
    //             oracle.connect(oracleManager).updateAssetUnderManagement(
    //                 await pool.getAddress(),
    //                 ethers.parseUnits("1000020", 18)
    //             )
    //         ).to.be.revertedWith("Cooldown period not elapsed");
    //     });
    
    //     it("should fail AUM update if not paused and not fundManager", async function () {
    //         await oracle.emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("1000000", 18));
    //         await pool.setStatus(1);
    //         await pool.setPauseConfig(3600, 7200); // outside pause window
    //         await pool.setPaused(false); // simulate `paused()` = false
    
    //         await expect(
    //             oracle.connect(oracleManager).updateAssetUnderManagement(
    //                 await pool.getAddress(),
    //                 ethers.parseUnits("1000010", 18)
    //             )
    //         ).to.be.revertedWith("Pausable: not paused");
    //     });
    
    //     it("should fail AUM update if pool is inactive", async function () {
    //         await pool.setStatus(0); // INACTIVE
    //         await expect(
    //             oracle.connect(oracleManager).updateAssetUnderManagement(
    //                 await pool.getAddress(),
    //                 ethers.parseUnits("1000010", 18)
    //             )
    //         ).to.be.revertedWith("Inactive pool");
    //     });
    
    //     it("should bypass threshold and cooldown if fundManager directly calls", async function () {
    //         await oracle.emergencyUpdateAUM(await pool.getAddress(), ethers.parseUnits("1000000", 18));
    //         await pool.setStatus(1);
    //         await pool.setPauseConfig(3600, 7200);
    //         await pool.setPaused(false); // bypass pause checks for fundManager
    
    //         await expect(
    //             oracle.connect(await ethers.getSigner(await pool.fundManager())).updateAssetUnderManagement(
    //                 await pool.getAddress(),
    //                 ethers.parseUnits("2000000", 18)
    //             )
    //         ).to.emit(oracle, "AssetUnderManagementUpdated")
    //          .withArgs(await pool.getAddress(), await pool.fundManager(), ethers.parseUnits("1000000", 18), ethers.parseUnits("2000000", 18));
    //     });
    // });
    
});