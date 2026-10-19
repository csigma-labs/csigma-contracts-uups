const { ethers } = require("hardhat");

// ======= CONFIG =======

// New admin (timelock contract address)
const NEW_ADMIN = "0x79CdA4F5F712F15261B0944Fb2BC8Ee637700AEA";

// Deployed contract addresses
const contracts = [
  {
    name: "CsigmaUSD",
    addr: "" // fill in deployed csUSD Token address
  },
  {
    name: "CSUSDFundManager",
    addr: "" // fill in deployed FundManager address
  },
  {
    name: "CsigmaV3Pool",
    addr: "" // fill in deployed USDC vault address
  },
  {
    name: "CsigmaV3Pool",
    addr: "" // fill in deployed USDT vault address
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
