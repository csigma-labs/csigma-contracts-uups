const { ethers } = require("hardhat");

// ======= CONFIG =======
const csUSDAddr = "0x1708c20b8008158749e580ffb68bbdb733a3adf9"; // deployed csUSD contract address
const assetOracleAddr = "0x1abee07cc868b50b9fce2d151ea678c3e7ac2b38"; // deployed Asset Oracle contract address
const fundManagerAddr = "0x6a3a7f8d29c8df1653ca8f05cb6d50a3045fbd3b"; // deployed CSUSDFundManager contract address

// Underlying asset tokens (USDC/USDT)
const assets = [
  {
    name: "USDC",
    assetAddr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC token address
    v3VaultAddr: "0xd5d097f278a735d0a3c609deee71234cac14b47e", // USDC V3Vault address
    priceFeed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6"
  },
  {
    name: "USDT",
    assetAddr: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT token address
    v3VaultAddr: "0xbd3f0befa86794b999b29a91d201124d8fbdf777", // USDT V3Vault address
    priceFeed: "0x3E7d1eAB13ad0104d2750B8863b489D65364e32D"
  }
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
