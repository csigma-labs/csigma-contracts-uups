const { expect } = require("chai");
const { ethers } = require("hardhat");

// helper: parse units
const parseUnits = (n, decimals = 18) => ethers.parseUnits(n.toString(), decimals);

describe("Migration", function () {
    let deployer, admin, user1, user2, user3, users;
    let MockERC20, MockERC4626, Migration;
    let underlying, legacyVault, newVault, migration;

    beforeEach(async () => {
        [deployer, admin, user1, user2, user3, ...users] = await ethers.getSigners();

        // Factories (assumes these mocks exist in your contracts/ folder)
        MockERC20 = await ethers.getContractFactory("MockERC20");
        MockERC4626 = await ethers.getContractFactory("MockERC4626");
        Migration = await ethers.getContractFactory("Migration");

        // Deploy underlying token and mint to test accounts
        underlying = await MockERC20.deploy();
        await underlying.waitForDeployment();

        // mint some underlying to user1/user2/user3 to simulate deposits
        await underlying.mint(user1.address, parseUnits(10000, 6));
        await underlying.mint(user2.address, parseUnits(10000, 6));
        await underlying.mint(user3.address, parseUnits(10000, 6));

        // Deploy a legacy ERC4626 vault and a new ERC4626 vault (both accept same underlying)
        legacyVault = await MockERC4626.deploy(underlying.target, "LegacyVault", "LV");
        await legacyVault.waitForDeployment();

        newVault = await MockERC4626.deploy(underlying.target, "NewVault", "NV");
        await newVault.waitForDeployment();

        // user1, user2 deposit to legacy vault to obtain LP shares
        // approve underlying -> legacyVault; deposit assets -> receive shares
        await underlying.connect(user1).approve(legacyVault.target, parseUnits(500, 6));
        await legacyVault.connect(user1).deposit(parseUnits(500, 6), user1.address); // user1 gets shares

        await underlying.connect(user2).approve(legacyVault.target, parseUnits(300, 6));
        await legacyVault.connect(user2).deposit(parseUnits(300, 6), user2.address);

        // user3 deposits smaller amount to test rounding / small share
        await underlying.connect(user3).approve(legacyVault.target, parseUnits(1, 6));
        await legacyVault.connect(user3).deposit(parseUnits(1, 6), user3.address);

        // Deploy Migration (upgradeable init in contract, but we call initialize directly; tests assume initializer available)
        const migrationLogic = await Migration.deploy();
        await migrationLogic.waitForDeployment();

        const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
        const proxy = await proxyFactory.deploy(
            await migrationLogic.getAddress(),
            migrationLogic.interface.encodeFunctionData("initialize", [
                admin.address,
                Math.floor(Date.now() / 1000) + 3600
            ])
        );
        migration = await ethers.getContractAt("Migration", await proxy.getAddress());

        // Grant DEFAULT_ADMIN_ROLE to admin is done in initialize; ensure deployer doesn't have role
        expect(await migration.hasRole(await migration.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    });

    describe("Initialization", function () {
        it("should initialize correctly", async function () {
            expect(await migration.hasRole(await migration.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
            expect(await migration.sunsetTimeStamp()).to.equal(Math.floor(Date.now() / 1000) + 3600);
        });
    });

    describe("Pre-sunset: voluntary migrateBatch", function () {
        let legacyVault0, legacyVault1, legacyVault2, newVault;
        beforeEach(async () => {
            // set a future sunset so voluntary migration is allowed
            const future = Math.floor(Date.now()) + 3600;
            await migration.connect(admin).updateSunsetTime(future);

            legacyVault0 = await (await ethers.getContractFactory("MockERC4626"))
                .deploy(underlying.target, "LegacyVault0", "LV0");
            await legacyVault0.waitForDeployment();

            legacyVault1 = await (await ethers.getContractFactory("MockERC4626"))
                .deploy(underlying.target, "LegacyVault1", "LV1");
            await legacyVault1.waitForDeployment();

            legacyVault2 = await (await ethers.getContractFactory("MockERC4626"))
                .deploy(underlying.target, "LegacyVault2", "LV2");
            await legacyVault2.waitForDeployment();

            newVault = await (await ethers.getContractFactory("MockERC4626"))
                .deploy(underlying.target, "NewVault", "NV");
            await newVault.waitForDeployment();

            // Seed user2 with shares in each legacy vault
            await underlying.connect(user2).approve(legacyVault0.target, parseUnits(1000, 6));
            await legacyVault0.connect(user2).deposit(parseUnits(1000, 6), user2.address);

            await underlying.connect(user2).approve(legacyVault1.target, parseUnits(1000, 6));
            await legacyVault1.connect(user2).deposit(parseUnits(1000, 6), user2.address);

            await underlying.connect(user2).approve(legacyVault2.target, parseUnits(1000, 6));
            await legacyVault2.connect(user2).deposit(parseUnits(1000, 6), user2.address);
        });

        it("should allow a user to voluntarily migrate full LP -> deposit to new vault", async () => {
            // user1 calls migrateBatch with one legacy vault, deposit choice true, newVault address
            // user1 must approve LP (legacyVault shares) to migration contract
            const user1Shares = await legacyVault.balanceOf(user1.address);
            expect(user1Shares).to.be.equal(parseUnits(500, 6));

            // approve migration to pull LP shares
            await legacyVault.connect(user1).approve(migration.target, user1Shares);

            // Call migrateBatch
            await expect(
                migration.connect(user1).migrateBatch(
                    [legacyVault.target],
                    [true],
                    [newVault.target]
                )
            ).to.emit(migration, "VoluntaryMigrated");

            // After migration, user1 should have csUSD shares in newVault (via deposit)
            const user1NewVaultShares = await newVault.balanceOf(user1.address);
            expect(user1NewVaultShares).to.be.equal(parseUnits(500, 6));

            // legacyVault share balance for user1 should be zero (we redeemed the full balance)
            expect(await legacyVault.balanceOf(user1.address)).to.equal(0);
        });

        it("should allow a user to voluntarily migrate full LP -> refund underlying to wallet", async () => {
            const user2Shares = await legacyVault.balanceOf(user2.address);
            await legacyVault.connect(user2).approve(migration.target, user2Shares);

            const user2UnderlyingBefore = await underlying.balanceOf(user2.address);

            await expect(
                migration.connect(user2).migrateBatch(
                    [legacyVault.target],
                    [false],
                    [ethers.ZeroAddress]
                )
            ).to.emit(migration, "VoluntaryMigrated");

            // user2 should have received underlying back, and legacy shares burned
            const user2UnderlyingAfter = await underlying.balanceOf(user2.address);
            expect(user2UnderlyingAfter).to.be.gte(user2UnderlyingBefore); // at least same or more
            expect(await legacyVault.balanceOf(user2.address)).to.equal(0);
        });

        it("should allow a user to voluntarily migrate across multiple vaults with mixed options (true,false,true)", async () => {
            // Mint some shares for user2 in 3 different legacy vaults
            const user2Shares0 = await legacyVault0.balanceOf(user2.address);
            const user2Shares1 = await legacyVault1.balanceOf(user2.address);
            const user2Shares2 = await legacyVault2.balanceOf(user2.address);

            await legacyVault0.connect(user2).approve(migration.target, user2Shares0);
            await legacyVault1.connect(user2).approve(migration.target, user2Shares1);
            await legacyVault2.connect(user2).approve(migration.target, user2Shares2);

            const user2UnderlyingBefore = await underlying.balanceOf(user2.address);
            const newVaultSharesBefore = await newVault.balanceOf(user2.address);

            await expect(
                migration.connect(user2).migrateBatch(
                    [legacyVault0.target, legacyVault1.target, legacyVault2.target],
                    [true, false],
                    [newVault.target, ethers.ZeroAddress, newVault.target]
                )
            ).to.be.revertedWith("length mismatch");

            await expect(
                migration.connect(user2).migrateBatch(
                    [legacyVault0.target, legacyVault1.target, legacyVault2.target],
                    [true, false, true],
                    [newVault.target, ethers.ZeroAddress, newVault.target]
                )
            ).to.emit(migration, "VoluntaryMigrated");

            const user2UnderlyingAfter = await underlying.balanceOf(user2.address);
            const newVaultSharesAfter = await newVault.balanceOf(user2.address);

            // Case 0: migrated into newVault
            expect(await legacyVault0.balanceOf(user2.address)).to.equal(0);

            // Case 1: refunded to wallet
            expect(await legacyVault1.balanceOf(user2.address)).to.equal(0);
            expect(user2UnderlyingAfter).to.be.equal(user2UnderlyingBefore+user2Shares1);

            // Case 2: migrated into newVault
            expect(await legacyVault2.balanceOf(user2.address)).to.equal(0);
            expect(newVaultSharesAfter).to.be.gt(newVaultSharesBefore);
            expect(await newVault.balanceOf(user2.address)).to.equal(user2Shares0+user2Shares2);
        });


        it("should revert migrateBatch when user has zero shares", async () => {
            // user who has not deposited (users[0]) tries to migrate
            await expect(
                migration.connect(users[0]).migrateBatch(
                    [legacyVault.target],
                    [false],
                    [ethers.ZeroAddress]
                )
            ).to.be.revertedWith("no shares to migrate");
        });

        it("should revert migrateBatch after sunset", async () => {
            // set sunset to past
            const past = Math.floor(Date.now() / 1000) - 10;
            await migration.connect(admin).updateSunsetTime(past);

            const user1Shares = await legacyVault.balanceOf(user1.address);
            await legacyVault.connect(user1).approve(migration.target, user1Shares);

            await expect(
                migration.connect(user1).migrateBatch(
                    [legacyVault.target],
                    [true],
                    [newVault.target]
                )
            ).to.be.revertedWith("migration closed");
        });

        it("should revert deposit if asset mismatch between legacy and new vault", async () => {
            // Deploy different underlying token and newVaultMismatch with different asset
            const otherUnderlying = await MockERC20.deploy();
            await otherUnderlying.waitForDeployment();
            const newVaultMismatch = await MockERC4626.deploy(otherUnderlying.target, "NV2", "NV2");
            await newVaultMismatch.waitForDeployment();

            // user1 approves and calls migrateBatch pointing to newVaultMismatch
            const user1Shares = await legacyVault.balanceOf(user1.address);
            await legacyVault.connect(user1).approve(migration.target, user1Shares);

            await expect(
                migration.connect(user1).migrateBatch(
                    [legacyVault.target],
                    [true],
                    [newVaultMismatch.target]
                )
            ).to.be.revertedWith("asset mismatch");
        });
    });

    describe("Post-sunset: forced single-step migration (owner-only)", function () {
        beforeEach(async () => {
            // set sunset to past so forced migration allowed
            const past = Math.floor(Date.now() / 1000) - 1000;
            await migration.connect(admin).updateSunsetTime(past);

            // Owner needs shares to redeem on behalf of the vault: we'll simulate by reading vault's totalAssets and transferring underlying into migration
            // For reliability across mock implementations, we'll transfer underlying directly from deployer who holds underlying supply (MockERC20.mint allowed)
            // Mint extra underlying to deployer and transfer to migration contract
            await underlying.mint(deployer.address, parseUnits(2000, 6));
            await underlying.connect(deployer).transfer(migration.target, parseUnits(801, 6)); // all underlying we will use; enough for pro-rata
            // Now migration contract holds underlying tokens to deposit to newVault during forceMigrate
        });

        it("should revert forceMigrate when not admin", async () => {
            await expect(
                migration.connect(user1).forceMigrate(legacyVault.target, newVault.target, [user1.address, user2.address], true)
            ).to.be.revertedWith("AccessControl: account " + user1.address.toLowerCase() + " is missing role " + await migration.DEFAULT_ADMIN_ROLE());; // AccessControl revert message varies; generic revert captured
        });

        it("should revert forceMigrate if newVault has different asset", async () => {
            // Deploy a mismatch new vault backed by different underlying
            const otherUnderlying = await MockERC20.deploy();
            await otherUnderlying.waitForDeployment();
            const newVaultMismatch = await MockERC4626.deploy(otherUnderlying.target, "NV2", "NV2");
            await newVaultMismatch.waitForDeployment();

            // fund migration contract with legacy underlying (done in beforeEach) and attempt forced migration to mismatch vault
            await expect(
                migration.connect(admin).forceMigrate(legacyVault.target, newVaultMismatch.target, [user1.address, user2.address], true)
            ).to.be.revertedWith("asset mismatch");
        });

        it("should fail if migration contract has no underlying funds", async () => {
            // Deploy a fresh migration contract for this test to simulate zero-balance (or withdraw funds)
            let migration2 = await Migration.deploy();
            await migration2.waitForDeployment();
            const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
            const proxy = await proxyFactory.deploy(
                await migration2.getAddress(),
                migration2.interface.encodeFunctionData("initialize", [
                    admin.address,
                    Math.floor(Date.now() / 1000) - 100
                ])
            );
            migration2 = await ethers.getContractAt("Migration", await proxy.getAddress());

            await expect(
                migration2.connect(admin).forceMigrate(legacyVault.target, newVault.target, [user1.address], true)
            ).to.be.revertedWith("no assets available");
        });

        it("should allow admin to forceMigrate and deposit csUSD into new vault for users", async () => {
            // ensure balances: get user shares in legacy vault
            const user1Shares = await legacyVault.balanceOf(user1.address);
            const user2Shares = await legacyVault.balanceOf(user2.address);
            const user3Shares = await legacyVault.balanceOf(user3.address);

            // Pre-check: users have zero shares in newVault
            expect(await newVault.balanceOf(user1.address)).to.equal(0);
            expect(await newVault.balanceOf(user2.address)).to.equal(0);
            expect(await newVault.balanceOf(user3.address)).to.equal(0);

            // Admin triggers forceMigrate with users list
            await expect(
                migration.connect(admin).forceMigrate(legacyVault.target, newVault.target, [user1.address, user2.address, user3.address], true)
            ).to.emit(migration, "ForcedMigrationExecuted");

            // After migration, each user should have newVault shares approximating convertToAssets(userShares)
            const user1AssetEntitlement = await legacyVault.convertToAssets(user1Shares);
            const user2AssetEntitlement = await legacyVault.convertToAssets(user2Shares);
            const user3AssetEntitlement = await legacyVault.convertToAssets(user3Shares);

            // Users received deposits in newVault (which mints shares); the newVaultMock implementation might 1:1 map assets->shares,
            // so we check underlying balance increases or newVault share balances depending on mock behavior.
            // For our mock, deposit results in shares being minted proportionally — check newVault.balanceOf
            expect(await newVault.balanceOf(user1.address)).to.be.equal(user1Shares);
            expect(await newVault.balanceOf(user2.address)).to.be.equal(user2Shares);
            expect(await newVault.balanceOf(user3.address)).to.be.equal(user3Shares);

            // And the actual underlying held by newVault should have increased by sum entitlements
            const newVaultUnderlyingBal = await underlying.balanceOf(newVault.target);
            expect(newVaultUnderlyingBal).to.be.equal(user1AssetEntitlement + user2AssetEntitlement + user3AssetEntitlement);
        });

        it("should allow multiple batched forceMigrate calls if finalize=false (owner decides batching)", async () => {
            // Admin executes migration for user1 only (partial batch)
            await expect(
                migration.connect(admin).forceMigrate(legacyVault.target, newVault.target, [user1.address], false)
            ).to.emit(migration, "ForcedMigrationExecuted");

            // Then admin executes for user2 & user3
            await expect(
                migration.connect(admin).forceMigrate(legacyVault.target, newVault.target, [user2.address, user3.address], true)
            ).to.emit(migration, "ForcedMigrationExecuted");
        });
    });

    describe("Admin controls & edge cases", function () {
        it("only admin can update sunset timestamp", async () => {
            await expect(migration.connect(user1).updateSunsetTime(Math.floor(Date.now() / 1000) + 1000)).to.be.reverted;
            await expect(migration.connect(admin).updateSunsetTime(Math.floor(Date.now() / 1000) + 1000)).to.not.be.reverted;
        });

        it("emergencyWithdraw works for admin", async () => {
            // mint some token to migration and withdraw
            await underlying.mint(migration.target, parseUnits(10, 6));
            const before = await underlying.balanceOf(admin.address);
            await expect(migration.connect(admin).emergencyWithdraw(underlying.target, admin.address, parseUnits(5, 6))).to.emit(migration, "EmergencyWithdraw");
            const after = await underlying.balanceOf(admin.address);
            expect(after - before).to.equal(parseUnits(5, 6));
        });
    });

    describe("Upgradeability", function () {
        it("should reject upgrade from non-admin", async () => {
            const NewLogic = await ethers.getContractFactory("Migration");
            const newLogic = await NewLogic.deploy();

            await expect(
                migration.connect(user1).upgradeTo(newLogic.target)
            )
                .to.be.revertedWith("AccessControl: account " + user1.address.toLowerCase() + " is missing role " + await migration.DEFAULT_ADMIN_ROLE());
        });

        it("should upgrade from admin", async () => {
            const NewLogic = await ethers.getContractFactory("Migration");
            const newLogic = await NewLogic.deploy();

            await expect(
                migration.connect(admin).upgradeTo(newLogic.target)
            ).not.to.be.reverted;
        });
    });
});
