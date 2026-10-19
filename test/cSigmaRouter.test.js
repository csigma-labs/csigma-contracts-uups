const {expect} = require("chai");
const {
    ethers: {
        parseEther,
        getContractFactory
    },
    ethers
} = require("hardhat");


describe("Csigma Router", async function() {
    let accounts, router, stargate;
    before(async function() {
        accounts = await ethers.getSigners();
        const Stargate = await getContractFactory("MockStargate");
        stargate = await Stargate.deploy();
        const CsigmaRouter = await getContractFactory("CsigmaRouter");
        router = await CsigmaRouter.deploy();
        proxyFactory = await getContractFactory("ERC1967Proxy");
        proxy = await proxyFactory.deploy(
            await router.getAddress(),
            router.interface.encodeFunctionData("initialize", [accounts[0].address, await stargate.getAddress(), [await stargate.getAddress()], [await stargate.getAddress()]])
        );
        router = await ethers.getContractAt("CsigmaRouter", await proxy.getAddress());
    });

    it("Should have initialized correctly", async function() {
        expect(await router.hasRole(await router.DEFAULT_ADMIN_ROLE(), accounts[0].address)).to.equal(true);
        expect(await router.whitelistedBridges(await stargate.getAddress())).to.equal(true);
        expect(await router.stargatePool(await stargate.getAddress())).to.equal(await stargate.getAddress());
    });

    it("Should allow the admin to add a new Stargate pool", async function() {
        await router.updateTokenSupport(accounts[18].address, accounts[19].address)
        expect(await router.stargatePool(accounts[18].address)).to.equal(accounts[19].address);
    });

    it("Should allow the admin to remove a Stargate pool", async function() {
        await router.updateTokenSupport(accounts[18].address, ethers.ZeroAddress)
        expect(await router.stargatePool(accounts[18].address)).to.equal(ethers.ZeroAddress);
    });

    it("Should fail to add a new Stargate pool if not admin", async function() {
        await expect(router.connect(accounts[1]).updateTokenSupport(accounts[20].address, accounts[21].address)).to.be.revertedWith("AccessControl: account " + accounts[1].address.toLowerCase() + " is missing role " + await router.DEFAULT_ADMIN_ROLE());
    });

    it("Should receive instructions correctly", async function() {
        let tx = await stargate.lzCompose(
            await stargate.getAddress(), 
            await router.getAddress(), 
            parseEther("1"), 
            await stargate.getAddress(), 
            accounts[0].address
        );
        await expect(tx).to.emit(stargate, "Deposit").withArgs(parseEther("1"), accounts[0].address);

    });

    it("Should fail to receive instructions if caller not endpoint", async function () {
        abiCoder = new ethers.AbiCoder();
        await expect(router.lzCompose(
            await stargate.getAddress(), 
            ethers.ZeroHash,
            abiCoder.encode(["address", "address"], [accounts[0].address, accounts[0].address]),
            accounts[0].address,
            abiCoder.encode(["address"], [accounts[0].address])
        )).to.be.revertedWith("!endpoint");
    });
    
    it("Should fail to receive instructions if OApp address is invalid", async function (){
        await expect(stargate.lzCompose(
            await router.getAddress(), 
            await router.getAddress(), 
            parseEther("1"), 
            await stargate.getAddress(), 
            accounts[0].address
        )).to.be.revertedWith("Invalid caller");
    });

    it("Should relay bridge information correctly", async function() {
        let tx = await router.requestWithdrawAndBridge(
            await stargate.getAddress(),
            parseEther("1"),
            10101,
            10000,
            accounts[0].address,
            accounts[0].address,
            {
                value: parseEther("1")
            }
        );

        await expect(tx).to.emit(stargate, "SendParamReceived").withArgs(
            10101,
            ethers.zeroPadValue(accounts[0].address, 32),
            parseEther("1"),
            0
        );

        await expect(tx).to.emit(stargate, "FeeReceived").withArgs(
            accounts[0].address,
            parseEther("1"),
            0,
            parseEther("1")
        );

        await stargate.setOwner(accounts[0].address);
        await stargate.setAmount(parseEther("1"));
        tx = await router.claimAndBridge(
            await stargate.getAddress(),
            1,
            2,
            10101,
            10000,
            accounts[0].address,
            accounts[0].address,
            {
                value: parseEther("1")
            }
        );

        await expect(tx).to.emit(stargate, "SendParamReceived").withArgs(
            10101,
            ethers.zeroPadValue(accounts[0].address, 32),
            parseEther("1"),
            0
        );

        await expect(tx).to.emit(stargate, "FeeReceived").withArgs(
            accounts[0].address,
            parseEther("1"),
            0,
            parseEther("1")
        );
    });

    it("Should fail to relay if to address is zero address", async function() {
        await expect(router.requestWithdrawAndBridge(
            await stargate.getAddress(),
            parseEther("1"),
            10101,
            10000,
            accounts[0].address,
            ethers.ZeroAddress,
            {
                value: parseEther("1")
            }
        )).to.be.revertedWith("Invalid receiver address");

        await expect(router.claimAndBridge(
            await stargate.getAddress(),
            1,
            2,
            10101,
            10000,
            accounts[0].address,
            ethers.ZeroAddress,
            {
                value: parseEther("1")
            }
        )).to.be.revertedWith("Invalid receiver address");
    });

    it("Should fail to relay if fee refund address is zero address", async function() {
        await expect(router.requestWithdrawAndBridge(
            await stargate.getAddress(),
            parseEther("1"),
            10101,
            10000,
            ethers.ZeroAddress,
            accounts[0].address,
            {
                value: parseEther("1")
            }
        )).to.be.revertedWith("Invalid fee refund address");

        await expect(router.claimAndBridge(
            await stargate.getAddress(),
            1,
            2,
            10101,
            10000,
            ethers.ZeroAddress,
            accounts[0].address,
            {
                value: parseEther("1")
            }
        )).to.be.revertedWith("Invalid fee refund address");
    });

    it("Should fail to claim if not owner of queuePosition", async function() {
        await expect(router.connect(accounts[1]).claimAndBridge(
            await stargate.getAddress(),
            1,
            2,
            10101,
            10000,
            accounts[0].address,
            accounts[0].address,
            {
                value: parseEther("1")
            }
        )).to.be.revertedWith("Not the owner of the queue position");
    });

    it("Should fail to claim if claim amount is 0", async function() {
        await stargate.setAmount(0);
        await expect(router.claimAndBridge(
            await stargate.getAddress(),
            1,
            2,
            10101,
            10000,
            accounts[0].address,
            accounts[0].address,
            {
                value: parseEther("1")
            }
        )).to.be.revertedWith("No amount to claim");
    });
});