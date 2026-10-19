const { ethers } = require("hardhat");

// ======= CONFIG =======

// New admin (timelock contract address)
const NEW_ADMIN = "0x6d72617fC05d9689133Ef8c82C4ba118C79345B2";

// Deployed contract addresses
const contracts = [
  {
    name: "CsigmaUSD",
    addr: "0x7eBD03C2Bea9E4053e699Af7779533801305F2dB" // fill in deployed csUSD Token address
  },
  {
    name: "CSUSDFundManager",
    addr: "0x27Bd349fa50bc4cb78d559fcB48F85952FB53120" // fill in deployed FundManager address
  },
  {
    name: "CsigmaAssetOracle",
    addr: "0x149959204EEfaC950b2dDFb38BA641EFFD58c568" // fill in deployed asset oracle address
  },
  {
    name: "CsigmaV3Pool",
    addr: "0x4896a087f78E1DcB44B9231f9a6f35EA2aA0c8AC" // fill in deployed USDC vault address
  }
];

// ======================

async function main() {

  for (let i = 0; i < contracts.length; i++) {
    const { name, addr } = contracts[i];
    console.log(`\n=== Processing ${name} at ${addr} ===`);

    const contract = await ethers.getContractAt(name, addr);

    const tx = await contract.transferAdmin(NEW_ADMIN);
    await tx.wait();

    console.log(`[${name}] transferAdmin → ${NEW_ADMIN} Tx hash: ${tx.hash}`);
  }

  console.log("\n All admin transfers completed successfully");
}

// Run
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error in admin transfer script:", error);
    process.exit(1);
  });
