const { ethers } = require("hardhat");

// ======= CONFIG =======

// Account whose manager rights we want to revoke
const TARGET_ACCOUNT = "0x96aF4cf29721BF8FE9aAf6e8d50Df17c77359fb2";

// Role to revoke for contracts that use AccessControl
const ROLE_MANAGER = "0xf206625bad3d9112d5609b8d356e6fbd514cd1f69980d4ce2b3e6e68e1789ace";

// Deployed contracts
const contracts = [
  {
    name: "CsigmaUSD",                                             // uses removeManager()
    addr: "0x1708c20b8008158749e580ffb68bbdb733a3adf9"             // fill in deployed csUSD address
  },
  {
    name: "CSUSDFundManager",                                      // uses revokeRole()
    addr: "0x6a3a7f8d29c8df1653ca8f05cb6d50a3045fbd3b"             // fill in deployed FundManager address
  },
  {
    name: "CsigmaV3Pool",                                          // uses revokeRole()
    addr: "0xd5d097f278a735d0a3c609deee71234cac14b47e"             // fill in deployed USDC vault address
  },
  {
    name: "CsigmaV3Pool",                                          // uses revokeRole()
    addr: "0xbd3f0befa86794b999b29a91d201124d8fbdf777"             // fill in deployed USDT vault address
  }
];

// ======================

async function main() {
  console.log(`Target account: ${TARGET_ACCOUNT}`);

  for (const { name, addr } of contracts) {
    console.log(`\n=== Processing ${name} at ${addr} ===`);
    const contract = await ethers.getContractAt(name, addr);

    if (name === "CsigmaUSD") {
      // csUSD uses removeManager()
      const tx = await contract.removeManager(TARGET_ACCOUNT);
      await tx.wait();
      console.log(`[${name}] removeManager(${TARGET_ACCOUNT}) Tx hash: ${tx.hash}`);
    } else {
      // AccessControl-based contracts use revokeRole()
      const hasRole = await contract.hasRole(ROLE_MANAGER, TARGET_ACCOUNT);
      if (!hasRole) {
        console.log(`[${name}] Target does not have ROLE_MANAGER, skipping`);
        continue;
      }
      const tx = await contract.revokeRole(ROLE_MANAGER, TARGET_ACCOUNT);
      await tx.wait();
      console.log(`[${name}] ROLE_MANAGER revoked from ${TARGET_ACCOUNT} Tx hash: ${tx.hash}`);
    }
  }

  console.log("\n Manager rights revoked across all contracts");
}

// Run
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error in revoke manager script:", error);
    process.exit(1);
  });
