const { ethers } = require("hardhat");

// ======= CONFIG =======
const csUSDAddr = "0x7eBD03C2Bea9E4053e699Af7779533801305F2dB"; // deployed csUSD contract address
const assetOracleAddr = "0x149959204EEfaC950b2dDFb38BA641EFFD58c568"; // deployed Asset Oracle contract address
const fundManagerAddr = "0x27Bd349fa50bc4cb78d559fcB48F85952FB53120"; // deployed CSUSDFundManager contract address

// Underlying asset tokens (USDC/USDT)
const assets = [
  {
    name: "USDC",
    assetAddr: "0x000000000000000000000000000000000006f89a", // USDC token address
    v3VaultAddr: "0x4896a087f78E1DcB44B9231f9a6f35EA2aA0c8AC", // USDC V3Vault address
    priceFeed: "0x2b358642c7C37b6e400911e4FE41770424a7349F"
  },
];

const VALIDITY_PERIOD = 0;
const LOWER_BOUND = "990000000000000000";   // 0.99e18
const UPPER_BOUND = "1010000000000000000";  // 1.01e18

// ======================

async function main() {

  // Attach contracts
  const csUSD = await ethers.getContractAt("CsigmaUSD", csUSDAddr);
  const assetOracle = await ethers.getContractAt("CsigmaAssetOracle", assetOracleAddr);
  const fundManager = await ethers.getContractAt("CSUSDFundManager", fundManagerAddr);

  // Process all assets
  for (let i = 0; i < assets.length; i++) {
    const { name, assetAddr, v3VaultAddr, priceFeed } = assets[i];
    console.log(`\n=== Processing ${name} ===`);

    // 1. Update vault in csUSD
    let tx = await csUSD.updateVault(assetAddr, v3VaultAddr);
    await tx.wait();
    console.log(`[${name}] updateVault done Tx Hash: ${tx.hash}`);

    // 2. Add v3 vault as controller in csUSD
    tx = await csUSD.addController(v3VaultAddr);
    await tx.wait();
    console.log(`[${name}] addController done Tx Hash: ${tx.hash}`);

    // 3. Add supported asset in Asset Oracle
    tx = await assetOracle.addSupportedAsset(
      v3VaultAddr,
      assetAddr,
      priceFeed,
      VALIDITY_PERIOD,
      LOWER_BOUND,
      UPPER_BOUND
    );
    await tx.wait();
    console.log(`[${name}] addSupportedAsset done Tx Hash: ${tx.hash}`);

    // 4. Add token to whitelist in Fund Manager
    tx = await fundManager.addTokenToWhitelist(v3VaultAddr);
    await tx.wait();
    console.log(`[${name}] addTokenToWhitelist done Tx Hash: ${tx.hash}`);

    // 5. Activate v3 vault
    const vault = await ethers.getContractAt("CsigmaV3Pool", v3VaultAddr);
    tx = await vault.activatePool();
    await tx.wait();
    console.log(`[${name}] activatePool done Tx Hash: ${tx.hash}`);
  }

  console.log("\n All post-deployment steps completed successfully");
}

// Run
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error in post-deployment script:", error);
    process.exit(1);
  });
