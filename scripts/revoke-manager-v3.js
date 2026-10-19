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
    addr: "0x7eBD03C2Bea9E4053e699Af7779533801305F2dB"             // fill in deployed csUSD address
  },
  {
    name: "CSUSDFundManager",                                      // uses revokeRole()
    addr: "0x27Bd349fa50bc4cb78d559fcB48F85952FB53120"             // fill in deployed FundManager address
  },
  {
    name: "CsigmaAssetOracle",                                      // uses revokeRole()
    addr: "0x149959204EEfaC950b2dDFb38BA641EFFD58c568"             // fill in deployed FundManager address
  },
  {
    name: "CsigmaV3Pool",                                          // uses revokeRole()
    addr: "0x4896a087f78E1DcB44B9231f9a6f35EA2aA0c8AC"             // fill in deployed USDC vault address
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
