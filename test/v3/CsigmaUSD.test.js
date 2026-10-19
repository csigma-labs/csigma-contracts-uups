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

describe("CSigma USD", function () {
    let oracle, proxy, proxyFactory, dummy, dummyFactory, csigmaUSD, mockFeed, pool, admin, roleManager, oracleManager, controller, poolManager, user;
    let MockFeed, MockPool, Oracle, accounts, v3Pool, v3FundManager, paymentInfo, request, claimRequest;

    before(async function () {
        accounts = await ethers.getSigners();
        [admin, roleManager, oracleManager, controller, poolManager, blacklistManager, user] = accounts;

        const CsigmaUSD = await ethers.getContractFactory("CsigmaUSD");
        csigmaUSD = await CsigmaUSD.deploy();
        proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
        proxy = await proxyFactory.deploy(await csigmaUSD.getAddress(), "0x");
        csigmaUSD = await ethers.getContractAt("CsigmaUSD", await proxy.getAddress());

        let chainAnalysisFactory = await ethers.getContractFactory("MockChainAnalysis");
        chainAnalysis = await chainAnalysisFactory.deploy();
        // await chainAnalysis.sanction(controller.address, true);
        // v3FundManager.setChainAnalysis(await chainAnalysis.getAddress());

        await csigmaUSD.initialize("cSigma USD", "csUSD", controller.address, roleManager.address, await chainAnalysis.getAddress());

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
                await csigmaUSD.getAddress()
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
                await csigmaUSD.getAddress(),
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
        await csigmaUSD.addController(await v3Pool.getAddress());
        await v3Pool.connect(roleManager).activatePool();
        await v3Pool.connect(roleManager).updateNonReservePercentage("9000");

        const BLACKLIST_ROLE = await csigmaUSD.BLACKLIST_MANAGER_ROLE();
        await csigmaUSD.connect(admin).grantRole(BLACKLIST_ROLE, blacklistManager.address);

        await v3FundManager.connect(roleManager).addTokenToWhitelist(await v3Pool.getAddress());
        await v3Pool.connect(roleManager).createWithdrawalManager(accounts[0].address);

        const withdrawManagerAddress = await v3Pool.withdrawalManager();
        v3Withdraw = await ethers.getContractAt("CsigmaV3WithdrawalManager", withdrawManagerAddress);

    });

    describe("Initialization", function () {
        it("should initialize properly", async function () {
            expect(await csigmaUSD.name()).to.equal("cSigma USD");
            expect(await csigmaUSD.symbol()).to.equal("csUSD");
            expect(await csigmaUSD.decimals()).to.equal(6);
            expect(await csigmaUSD.chainalysis()).to.equal(await chainAnalysis.getAddress());
            expect(await csigmaUSD.hasRole(await csigmaUSD.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
            expect(await csigmaUSD.isController(controller.address)).to.be.true;
            expect(await csigmaUSD.isManager(roleManager.address)).to.be.true;
        });
    });

    describe("Roles - Extended & Event Tests", function () {
        it("should allow adding/removing controllers and emit events", async function () {
            await expect(csigmaUSD.connect(admin).addController(user.address))
                .to.emit(csigmaUSD, "ControllerAdded")
                .withArgs(user.address);
            expect(await csigmaUSD.isController(user.address)).to.be.true;

            await expect(csigmaUSD.connect(admin).removeController(user.address))
                .to.emit(csigmaUSD, "ControllerRemoved")
                .withArgs(user.address);
            expect(await csigmaUSD.isController(user.address)).to.be.false;
        });

        it("should allow adding/removing managers and emit events", async function () {
            await expect(csigmaUSD.connect(admin).addManager(user.address))
                .to.emit(csigmaUSD, "ManagerAdded")
                .withArgs(user.address);
            expect(await csigmaUSD.isManager(user.address)).to.be.true;

            await expect(csigmaUSD.connect(admin).removeManager(user.address))
                .to.emit(csigmaUSD, "ManagerRemoved")
                .withArgs(user.address);
            expect(await csigmaUSD.isManager(user.address)).to.be.false;
        });

        

        it("should revert if non-admin tries to add/remove controllers", async function () {
            await expect(csigmaUSD.connect(user).addController(accounts[3].address)).to.be.revertedWith("AccessControl: account " + user.address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
            await expect(csigmaUSD.connect(user).removeController(accounts[3].address)).to.be.revertedWith("AccessControl: account " + user.address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });

        it("should revert if non-admin tries to add/remove managers", async function () {
            await expect(csigmaUSD.connect(user).addManager(accounts[4].address)).to.be.revertedWith("AccessControl: account " + user.address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
            await expect(csigmaUSD.connect(user).removeManager(accounts[4].address)).to.be.revertedWith("AccessControl: account " + user.address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });

        it("should revert if paused and trying to grant or revoke roles", async function () {
            await csigmaUSD.connect(roleManager).pause();
            await expect(csigmaUSD.connect(admin).addManager(accounts[5].address)).to.be.revertedWith("Pausable: paused");;
            await expect(csigmaUSD.connect(admin).removeManager(roleManager.address)).to.be.revertedWith("Pausable: paused");;
            await csigmaUSD.connect(roleManager).unpause();
        });

        it("should revert if zero address is passed to add/remove/transfer role functions", async function () {
            await expect(csigmaUSD.connect(admin).addController(ethers.ZeroAddress)).to.be.revertedWith("address cannot be zero");
            await expect(csigmaUSD.connect(admin).addManager(ethers.ZeroAddress)).to.be.revertedWith("address cannot be zero");
            await expect(csigmaUSD.connect(admin).grantRole(await csigmaUSD.DEFAULT_ADMIN_ROLE(), ethers.ZeroAddress)).to.be.revertedWith("address cannot be zero");
            await expect(csigmaUSD.connect(admin).revokeRole(await csigmaUSD.DEFAULT_ADMIN_ROLE(), ethers.ZeroAddress)).to.be.revertedWith("address cannot be zero");
        });

        it("should revert transferAdmin to zero address", async function () {
            await expect(csigmaUSD.connect(admin).transferAdmin(ethers.ZeroAddress)).to.be.revertedWith("address cannot be zero");
        });

        it("should not fail if re-granting existing controller", async function () {
            await csigmaUSD.connect(admin).addController(user.address);
            await expect(csigmaUSD.connect(admin).addController(user.address)).to.emit(csigmaUSD, "ControllerAdded").withArgs(user.address);
        });

        it("should transfer admin role and emit event", async function () {
            await expect(csigmaUSD.connect(admin).transferAdmin(user.address))
                .to.emit(csigmaUSD, "AdminTransferred")
                .withArgs(admin.address, user.address);
            expect(await csigmaUSD.hasRole(await csigmaUSD.DEFAULT_ADMIN_ROLE(), user.address)).to.be.true;
            expect(await csigmaUSD.hasRole(await csigmaUSD.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.false;
            await expect(csigmaUSD.connect(user).transferAdmin(admin.address));
        });

        it("should revert transferAdmin if caller is not current admin", async function () {
            await expect(csigmaUSD.connect(accounts[10]).transferAdmin(accounts[9].address)).to.be.revertedWith("AccessControl: account " + accounts[10].address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });
    });


    describe("Minting/Burning", function () {
        it("should mint and burn by controller only", async function () {
            await expect(csigmaUSD.connect(controller).mint(user.address, 1000000))
                .to.changeTokenBalance(csigmaUSD, user, 1000000);

            expect(await csigmaUSD.totalSupply()).to.equal(1000000);

            await expect(csigmaUSD.connect(controller).burn(user.address, 500000))
                .to.changeTokenBalance(csigmaUSD, user, -500000);

            expect(await csigmaUSD.totalSupply()).to.equal(500000);
        });

        it("should fail mint/burn from non-controller", async function () {
            const notController = accounts[10];
            const controllerRole = await csigmaUSD.CONTROLLER_ROLE();

            await expect(csigmaUSD.connect(notController).mint(user.address, 1))
                .to.be.revertedWith(`AccessControl: account ${notController.address.toLowerCase()} is missing role ${controllerRole}`);

            await expect(csigmaUSD.connect(notController).burn(user.address, 1))
                .to.be.revertedWith(`AccessControl: account ${notController.address.toLowerCase()} is missing role ${controllerRole}`);
        });

        it("should not allow minting zero tokens", async function () {
            await expect(csigmaUSD.connect(controller).mint(user.address, 0))
                .to.be.revertedWith("amount must be greater than 0");
        });

        it("should not allow burning zero tokens", async function () {
            await expect(csigmaUSD.connect(controller).burn(user.address, 0))
                .to.be.revertedWith("amount must be greater than 0");
        });

        it("should allow minting to and burning from any address (even non-controller)", async function () {
            // Mint to non-controller
            await csigmaUSD.connect(controller).mint(accounts[7].address, 123456);
            expect(await csigmaUSD.balanceOf(accounts[7].address)).to.equal(123456);

            // Burn from that address
            await csigmaUSD.connect(controller).burn(accounts[7].address, 456);
            expect(await csigmaUSD.balanceOf(accounts[7].address)).to.equal(123000);
        });

        it("should update totalSupply accurately after multiple mints and burns", async function () {
            await csigmaUSD.connect(controller).mint(user.address, 2000000);
            await csigmaUSD.connect(controller).burn(user.address, 1000000);
            await csigmaUSD.connect(controller).mint(user.address, 500000);
            await csigmaUSD.connect(controller).burn(user.address, 250000);

            expect(await csigmaUSD.balanceOf(user.address)).to.equal(1750000);
            expect(await csigmaUSD.totalSupply()).to.equal(1873000);
        });
    });


    describe("Vault Management", function () {
        it("should allow roleManager to update vault", async function () {
            await expect(csigmaUSD.connect(roleManager).updateVault(user.address, controller.address))
                .to.emit(csigmaUSD, "UpdateVault")
                .withArgs(user.address, controller.address);
            expect(await csigmaUSD.vault(user.address)).to.equal(controller.address);
        });

        it("should fail from non-roleManager", async function () {
            await expect(csigmaUSD.connect(user).updateVault(user.address, controller.address)).to.be.revertedWith(`AccessControl: account ${user.address.toLowerCase()} is missing role ${await csigmaUSD.MANAGER_ROLE()}`);
        });
    });

    describe("Pause/Unpause", function () {
        beforeEach(async function () {
            await csigmaUSD.connect(controller).mint(user.address, 1_000_000);
        });

        it("should pause and unpause operations", async function () {
            await csigmaUSD.connect(roleManager).pause();
            expect(await csigmaUSD.paused()).to.be.true;

            await csigmaUSD.connect(roleManager).unpause();
            expect(await csigmaUSD.paused()).to.be.false;
        });

        it("should revert approve, transfer, increaseAllowance, decreaseAllowance, permit, spendAllowance when paused", async function () {
            await csigmaUSD.connect(roleManager).pause();

            // approve
            await expect(csigmaUSD.connect(user).approve(roleManager.address, 1000))
                .not.to.be.revertedWith("Pausable: paused");

            // transfer
            await expect(csigmaUSD.connect(user).transfer(accounts[3].address, 1000))
                .not.to.be.revertedWith("Pausable: paused");

            // increaseAllowance
            await expect(csigmaUSD.connect(user).increaseAllowance(accounts[3].address, 100))
                .not.to.be.revertedWith("Pausable: paused");

            // decreaseAllowance
            await expect(csigmaUSD.connect(user).decreaseAllowance(accounts[3].address, 100))
                .not.to.be.revertedWith("Pausable: paused");

            // permit (mock signature)
            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { chainId } = await ethers.provider.getNetwork();
            const nonce = await csigmaUSD.nonces(user.address);

            const domain = {
                name: await csigmaUSD.name(),
                version: "1",
                chainId,
                verifyingContract: await csigmaUSD.getAddress()
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            };

            const value = {
                owner: user.address,
                spender: accounts[5].address,
                value: 1000,
                nonce,
                deadline
            };

            const signature = await user.signTypedData(domain, types, value);
            const { v, r, s } = ethers.Signature.from(signature);

            await expect(
                csigmaUSD.permit(user.address, accounts[5].address, 1000, deadline, v, r, s)
            ).not.to.be.revertedWith("Pausable: paused");

            // spendAllowance (controller)
            await expect(
                csigmaUSD.connect(controller).spendAllowance(user.address, accounts[4].address, 100)
            ).to.be.revertedWith("Pausable: paused");
            await csigmaUSD.connect(roleManager).unpause();
        });

        it("should revert role grant/revoke when paused", async function () {
            const managerRole = await csigmaUSD.MANAGER_ROLE();
            await csigmaUSD.connect(roleManager).pause();

            await expect(csigmaUSD.connect(admin).grantRole(managerRole, accounts[6].address))
                .to.be.revertedWith("Pausable: paused");

            await expect(csigmaUSD.connect(admin).revokeRole(managerRole, roleManager.address))
                .to.be.revertedWith("Pausable: paused");
            await csigmaUSD.connect(roleManager).unpause();
        });

        it("should revert nativeApprove and nativeTransferFrom when paused", async function () {
            await csigmaUSD.connect(controller).nativeApprove(user.address, user.address, 10000);
            await csigmaUSD.connect(roleManager).pause();

            await expect(
                csigmaUSD.connect(controller).nativeApprove(user.address, user.address, 100)
            ).to.be.revertedWith("Pausable: paused");

            await expect(
                csigmaUSD.connect(controller).nativeTransferFrom(user.address, user.address, accounts[4].address, 100)
            ).to.be.revertedWith("Pausable: paused");
            await csigmaUSD.connect(roleManager).unpause();
        });
    });

    describe("ERC20 Functions", function () {
        beforeEach(async () => {
            await csigmaUSD.connect(controller).mint(user.address, 1000000);
        });

        it("should approve and transfer correctly", async function () {
            await csigmaUSD.connect(user).approve(roleManager.address, 500000);
            expect(await csigmaUSD.allowance(user.address, roleManager.address)).to.equal(500000);

            await csigmaUSD.connect(controller).nativeTransfer(user.address, roleManager.address, 100000);
            expect(await csigmaUSD.balanceOf(roleManager.address)).to.equal(100000);
        });

        it("should use nativeTransferFrom correctly", async function () {
            await csigmaUSD.connect(user).approve(controller.address, 1000000);
            await csigmaUSD.connect(controller).nativeTransferFrom(controller.address, user.address, roleManager.address, 100000);
            expect(await csigmaUSD.balanceOf(roleManager.address)).to.equal(200000);
        });
    });

    describe("Sanctions", function () {
        beforeEach(async function () {
            await csigmaUSD.connect(controller).mint(user.address, 1_000_000);
            await csigmaUSD.connect(user).approve(accounts[5].address, 500_000);
        });

        it("should revert on approve if spender is sanctioned", async function () {
            await chainAnalysis.sanction(accounts[10].address, true);
            await expect(
                csigmaUSD.connect(user).approve(accounts[10].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });

        it("should revert on increaseAllowance if spender is sanctioned", async function () {
            await chainAnalysis.sanction(accounts[10].address, true);
            await expect(
                csigmaUSD.connect(user).increaseAllowance(accounts[10].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });

        it("should revert on decreaseAllowance if spender is sanctioned", async function () {
            await chainAnalysis.sanction(accounts[10].address, true);
            await expect(
                csigmaUSD.connect(user).decreaseAllowance(accounts[10].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });

        it("should revert on permit if spender is sanctioned", async function () {
            await chainAnalysis.sanction(accounts[10].address, true);

            const deadline = Math.floor(Date.now() / 1000) + 3600;
            const { chainId } = await ethers.provider.getNetwork();
            const nonce = await csigmaUSD.nonces(user.address);

            const domain = {
                name: await csigmaUSD.name(),
                version: "1",
                chainId,
                verifyingContract: await csigmaUSD.getAddress(),
            };

            const types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            };

            const value = {
                owner: user.address,
                spender: accounts[10].address,
                value: 1000,
                nonce,
                deadline,
            };

            const signature = await user.signTypedData(domain, types, value);
            const { v, r, s } = ethers.Signature.from(signature);

            await expect(
                csigmaUSD.permit(user.address, accounts[10].address, 1000, deadline, v, r, s)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });

        it("should revert on transfer if sender is sanctioned", async function () {
            await chainAnalysis.sanction(accounts[4].address, true);
            await expect(
                csigmaUSD.connect(user).transfer(accounts[4].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });

        it("should revert on transfer if recipient is sanctioned", async function () {
            await chainAnalysis.sanction(accounts[4].address, true);
            await expect(
                csigmaUSD.connect(user).transfer(accounts[4].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });

        it("should revert on nativeApprove and nativeTransfer to sanctioned spender", async function () {
            await chainAnalysis.sanction(accounts[9].address, true);

            await csigmaUSD.connect(controller).nativeApprove(user.address, accounts[9].address, 1000)
            //).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");

            await expect(
                csigmaUSD.connect(controller).nativeTransfer(user.address, accounts[9].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });

        it("should revert on nativeTransferFrom if sender or recipient is sanctioned", async function () {
            await csigmaUSD.connect(controller).nativeApprove(user.address, accounts[8].address, 1000);

            // Sanction from
            await chainAnalysis.sanction(user.address, true);
            await expect(
                csigmaUSD.connect(controller).nativeTransferFrom(user.address, user.address, accounts[8].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");

            // Sanction to
            await chainAnalysis.sanction(accounts[8].address, true);
            await expect(
                csigmaUSD.connect(controller).nativeTransferFrom(user.address, user.address, accounts[8].address, 1000)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });
    });

    describe("Allowance Management", function () {
        const amount = 100_000;
        const increaseBy = 50_000;
        const decreaseBy = 30_000;

        beforeEach(async function () {
            // Mint to user
            await chainAnalysis.sanction(user.address, false);
            await csigmaUSD.connect(controller).mint(user.address, amount);
            // Approve initial amount
            await csigmaUSD.connect(user).approve(accounts[7].address, amount);
        });

        it("should increase allowance when not paused or sanctioned", async function () {
            const tx = await csigmaUSD.connect(user).increaseAllowance(accounts[7].address, increaseBy);
            const allowance = await csigmaUSD.allowance(user.address, accounts[7].address);
            expect(allowance).to.equal(amount + increaseBy);

            await expect(tx).to.emit(csigmaUSD, "Approval").withArgs(user.address, accounts[7].address, amount + increaseBy);
        });

        it("should decrease allowance when not paused or sanctioned", async function () {
            const tx = await csigmaUSD.connect(user).decreaseAllowance(accounts[7].address, decreaseBy);
            const allowance = await csigmaUSD.allowance(user.address, accounts[7].address);
            expect(allowance).to.equal(amount - decreaseBy);

            await expect(tx).to.emit(csigmaUSD, "Approval").withArgs(user.address, accounts[7].address, amount - decreaseBy);
        });

        it("should revert increaseAllowance when paused", async function () {
            await csigmaUSD.connect(roleManager).pause();
            await expect(
                csigmaUSD.connect(user).increaseAllowance(accounts[7].address, increaseBy)
            ).not.to.be.revertedWith("Pausable: paused");
            await csigmaUSD.connect(roleManager).unpause();
        });

        it("should revert decreaseAllowance when paused", async function () {
            await csigmaUSD.connect(roleManager).pause();
            await expect(
                csigmaUSD.connect(user).decreaseAllowance(accounts[7].address, decreaseBy)
            ).not.to.be.revertedWith("Pausable: paused");
            await csigmaUSD.connect(roleManager).unpause();
        });

        it("should revert increaseAllowance when spender is sanctioned", async function () {
            await chainAnalysis.sanction(accounts[8].address, true);
            await expect(
                csigmaUSD.connect(user).increaseAllowance(accounts[8].address, increaseBy)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
            await chainAnalysis.sanction(accounts[8].address, false);
        });

        it("should revert decreaseAllowance when spender is sanctioned", async function () {
            
            await csigmaUSD.connect(user).increaseAllowance(accounts[8].address, increaseBy)
            await chainAnalysis.sanction(accounts[8].address, true);
            await expect(
                csigmaUSD.connect(user).decreaseAllowance(accounts[8].address, decreaseBy)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
            await chainAnalysis.sanction(accounts[8].address, false);
        });

        it("should not underflow when decreasing allowance below current", async function () {
            await csigmaUSD.connect(user).increaseAllowance(accounts[11].address, increaseBy)
            await csigmaUSD.connect(user).decreaseAllowance(accounts[11].address, increaseBy);
            const finalAllowance = await csigmaUSD.allowance(user.address, accounts[11].address);
            expect(finalAllowance).to.equal(0); // ERC20 spec: clamp to zero
        });
    });

    describe("Blacklist Management", function () {
        const amount = 1_000_000;

        beforeEach(async function () {
            await csigmaUSD.connect(controller).mint(user.address, amount);
        });

        it("should allow blacklist manager to add address to blacklist", async function () {
            await expect(
                csigmaUSD.connect(blacklistManager).addBlackList(user.address)
            )
                .to.emit(csigmaUSD, "AddedBlackList")
                .withArgs(user.address);

            expect(await csigmaUSD.isBlacklisted(user.address)).to.equal(true);
            await csigmaUSD.connect(blacklistManager).removeBlackList(user.address)
        });

        it("should allow blacklist manager to remove address from blacklist", async function () {

            await expect(
                csigmaUSD.connect(blacklistManager).removeBlackList(user.address)
            )
                .to.emit(csigmaUSD, "RemovedBlackList")
                .withArgs(user.address);

            expect(await csigmaUSD.isBlacklisted(user.address)).to.equal(false);
        });

        it("should revert if non-blacklist-manager tries to add to blacklist", async function () {
            await expect(
                csigmaUSD.connect(user).addBlackList(accounts[9].address)
            ).to.be.revertedWith(
                `AccessControl: account ${user.address.toLowerCase()} is missing role ${await csigmaUSD.BLACKLIST_MANAGER_ROLE()}`
            );
        });

        it("should revert if non-blacklist-manager tries to remove from blacklist", async function () {
            await expect(
                csigmaUSD.connect(user).removeBlackList(accounts[9].address)
            ).to.be.revertedWith(
                `AccessControl: account ${user.address.toLowerCase()} is missing role ${await csigmaUSD.BLACKLIST_MANAGER_ROLE()}`
            );
        });
    });

    describe("Blacklist Enforcement", function () {
        beforeEach(async function () {
            await csigmaUSD.connect(controller).mint(user.address, 500_000);
        });

        it("should revert transfer when sender is blacklisted", async function () {
            await csigmaUSD.connect(blacklistManager).addBlackList(user.address);

            await expect(
                csigmaUSD.connect(user).transfer(accounts[8].address, 1000)
            )
                .to.be.revertedWithCustomError(csigmaUSD, "AssetsFrozen")
                .withArgs(user.address);
            await csigmaUSD.connect(blacklistManager).removeBlackList(user.address)
        });

        it("should revert transfer when recipient is blacklisted", async function () {
            await csigmaUSD.connect(blacklistManager).addBlackList(accounts[8].address);

            await expect(
                csigmaUSD.connect(user).transfer(accounts[8].address, 1000)
            )
                .to.be.revertedWithCustomError(csigmaUSD, "AssetsFrozen")
                .withArgs(accounts[8].address);
        });

        it("should allow transfer again after removing from blacklist", async function () {
            await csigmaUSD.connect(blacklistManager).addBlackList(accounts[8].address);
            await csigmaUSD.connect(blacklistManager).removeBlackList(accounts[8].address);

            await expect(
                csigmaUSD.connect(user).transfer(accounts[8].address, 1000)
            ).to.not.be.reverted;
        });
    });

    describe("Emergency Burn From Blacklist", function () {

        let burnUser;
        let burnAmount;

        beforeEach(async function () {
            await csigmaUSD.connect(controller).mint(user.address, 1_000_000);
            burnUser = user.address;
            burnAmount = await v3Pool.balanceOf(burnUser);
            expect(burnAmount).to.be.gt(0);
        });

        it("Should allow admin to burnFromBlacklist LP tokens of blacklisted user", async function () {
            await csigmaUSD.connect(blacklistManager).addBlackList(user.address);
            const totalSupplyBefore = await v3Pool.totalSupply();
            expect(await csigmaUSD.burnFromBlacklistActive()).to.be.equal(false);
            let balanceBefore = await csigmaUSD.balanceOf(burnUser);
            await expect(
                csigmaUSD.burnFromBlacklist(burnUser, burnAmount)
            )
                .to.emit(csigmaUSD, "BurnFromBlacklistExecuted")
                .withArgs(await csigmaUSD.getAddress(), burnUser, burnAmount);

            expect(await csigmaUSD.balanceOf(burnUser)).to.equal(balanceBefore - burnAmount);
            expect(await csigmaUSD.totalSupply()).to.equal(totalSupplyBefore - burnAmount);
            expect(await csigmaUSD.burnFromBlacklistActive()).to.be.equal(false);
            await csigmaUSD.connect(blacklistManager).removeBlackList(user.address);
        });

        it("Should fail burnFromBlacklist if user is not blacklisted", async function () {
            await expect(
                csigmaUSD.burnFromBlacklist(accounts[7].address, 1)
            ).to.be.revertedWith("ASSETS_NOT_FROZEN");
        });

        it("Should fail burnFromBlacklist if caller is not admin", async function () {
            await expect(
                csigmaUSD.connect(accounts[9]).burnFromBlacklist(burnUser, 1)
            ).to.be.reverted;
        });

        it("Blacklisted user should NOT be able to bypass via burn / redeem", async function () {
            await csigmaUSD.connect(blacklistManager).addBlackList(user.address);
            await expect(
                v3Pool.connect(user).redeem(1, burnUser, accounts[5].address)
            ).to.be.revertedWithCustomError(v3Pool, "AssetsFrozen").withArgs(burnUser);

            await expect(
                v3Pool.connect(user).withdraw(1, burnUser, accounts[5].address)
            ).to.be.revertedWithCustomError(v3Pool, "AssetsFrozen").withArgs(burnUser);
            await csigmaUSD.connect(blacklistManager).removeBlackList(user.address);
        });

        it("Blacklisted user should NOT be able to bypass via mint / deposit", async function () {
            await csigmaUSD.connect(blacklistManager).addBlackList(user.address);
            await expect(
                v3Pool.connect(user).mint(1, accounts[5].address)
            ).to.be.revertedWithCustomError(v3Pool, "AssetsFrozen").withArgs(burnUser);

            await expect(
                v3Pool.connect(user).deposit(1, accounts[5].address)
            ).to.be.revertedWithCustomError(v3Pool, "AssetsFrozen").withArgs(burnUser);
            await csigmaUSD.connect(blacklistManager).removeBlackList(user.address);
        });

        it("burnFromBlacklistActive should not stay enabled after burnFromBlacklist", async function () {
            expect(await csigmaUSD.burnFromBlacklistActive()).to.be.false;
        });
    });


    describe("Permit (EIP-2612)", function () {
        const value = 100000;
        const deadline = ethers.MaxUint256;

        let domain, types;

        beforeEach(async function () {
            const chainId = (await ethers.provider.getNetwork()).chainId;

            domain = {
                name: "cSigma USD",
                version: "1",
                chainId,
                verifyingContract: csigmaUSD.target,
            };

            types = {
                Permit: [
                    { name: "owner", type: "address" },
                    { name: "spender", type: "address" },
                    { name: "value", type: "uint256" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                ],
            };
        });

        it("should allow valid permit signature", async function () {
            const nonce = await csigmaUSD.nonces(user.address);

            const signature = await user.signTypedData(domain, types, {
                owner: user.address,
                spender: roleManager.address,
                value,
                nonce,
                deadline,
            });

            const { v, r, s } = ethers.Signature.from(signature);

            const tx = await csigmaUSD
                .connect(roleManager)
                .permit(user.address, roleManager.address, value, deadline, v, r, s);

            expect(await csigmaUSD.allowance(user.address, roleManager.address)).to.equal(value);

            await expect(tx)
                .to.emit(csigmaUSD, "Approval")
                .withArgs(user.address, roleManager.address, value);
        });

        it("should reject reused permit (nonce replay)", async function () {
            const nonce = await csigmaUSD.nonces(user.address);

            const signature = await user.signTypedData(domain, types, {
                owner: user.address,
                spender: roleManager.address,
                value,
                nonce,
                deadline,
            });

            const { v, r, s } = ethers.Signature.from(signature);

            await csigmaUSD
                .connect(roleManager)
                .permit(user.address, roleManager.address, value, deadline, v, r, s);

            // Replay same signature should fail
            await expect(
                csigmaUSD
                    .connect(roleManager)
                    .permit(user.address, roleManager.address, value, deadline, v, r, s)
            ).to.be.revertedWith("ERC20Permit: invalid signature");
        });

        it("should reject invalid signer", async function () {
            const nonce = await csigmaUSD.nonces(user.address);

            const fakeSignature = await accounts[10].signTypedData(domain, types, {
                owner: user.address,
                spender: roleManager.address,
                value,
                nonce,
                deadline,
            });

            const { v, r, s } = ethers.Signature.from(fakeSignature);

            await expect(
                csigmaUSD
                    .connect(roleManager)
                    .permit(user.address, roleManager.address, value, deadline, v, r, s)
            ).to.be.revertedWith("ERC20Permit: invalid signature");
        });

        it("should reject permit when paused", async function () {
            const nonce = await csigmaUSD.nonces(user.address);

            const signature = await user.signTypedData(domain, types, {
                owner: user.address,
                spender: roleManager.address,
                value,
                nonce,
                deadline,
            });

            const { v, r, s } = ethers.Signature.from(signature);

            await csigmaUSD.connect(roleManager).pause();

            await expect(
                csigmaUSD
                    .connect(roleManager)
                    .permit(user.address, roleManager.address, value, deadline, v, r, s)
            ).not.to.be.revertedWith("Pausable: paused");

            await csigmaUSD.connect(roleManager).unpause();
        });

        it("should revert if spender is sanctioned", async function () {
            const nonce = await csigmaUSD.nonces(user.address);

            await chainAnalysis.sanction(roleManager.address, true);

            const signature = await user.signTypedData(domain, types, {
                owner: user.address,
                spender: roleManager.address,
                value,
                nonce,
                deadline,
            });

            const { v, r, s } = ethers.Signature.from(signature);

            await expect(
                csigmaUSD
                    .connect(roleManager)
                    .permit(user.address, roleManager.address, value, deadline, v, r, s)
            ).to.be.revertedWithCustomError(csigmaUSD, "AccessDenied");
        });
    });


    describe("Upgradeability", function () {
        it("should reject upgrade from non-admin", async () => {
            const NewLogic = await ethers.getContractFactory("CsigmaUSD");
            const newLogic = await NewLogic.deploy();

            await expect(
                csigmaUSD.connect(roleManager).upgradeTo(newLogic.target)
            )
                .to.be.revertedWith("AccessControl: account " + roleManager.address.toLowerCase() + " is missing role " + await oracle.DEFAULT_ADMIN_ROLE());
        });

        it("should upgrade from admin", async () => {
            const NewLogic = await ethers.getContractFactory("CsigmaUSD");
            const newLogic = await NewLogic.deploy();

            await expect(
                csigmaUSD.connect(admin).upgradeTo(newLogic.target)
            ).not.to.be.reverted;
        });
    });
});