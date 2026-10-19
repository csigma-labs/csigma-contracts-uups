# cSigma Smart Contracts

Smart contracts powering the cSigma protocol: on-chain credit pools, yield-bearing stablecoin vaults,
and permissioned asset tokenization. All core contracts are upgradeable (UUPS proxies) and are deployed
across Ethereum, Arbitrum, Base and Hedera.

This repository contains three product lines that share a common set of protocol contracts:

| Product | Folder | Summary |
|---------|--------|---------|
| **cSigma v2** | [`contracts/v2`](contracts/v2) | Credit pools with a factory, fund manager, queued withdrawals and staking |
| **cSigma v3** | [`contracts/v3`](contracts/v3) | csUSD: a yield-bearing USD token backed by ERC-7575 vaults with oracle pricing |
| **cSigma Atlas** | [`contracts/AssetTokenization`](contracts/AssetTokenization) | Permissioned (KYB-gated) pools for real-world asset tokenization |

## Table of Contents
* [Architecture](#architecture)
  * [cSigma v2](#csigma-v2)
  * [cSigma v3 (csUSD)](#csigma-v3-csusd)
  * [cSigma Atlas](#csigma-atlas)
  * [Shared Protocol Contracts](#shared-protocol-contracts)
* [Branches](#branches)
* [Repository Layout](#repository-layout)
* [Getting Started](#getting-started)
* [Configuration](#configuration)
* [Compilation](#compilation)
* [Testing](#testing)
* [Deployment](#deployment)
* [Supported Networks](#supported-networks)
* [Security](#security)
* [License](#license)

## Architecture

Every production contract follows the same conventions:

* **Upgradeable**: deployed behind an `ERC1967Proxy` using the UUPS pattern
  (OpenZeppelin `contracts-upgradeable` 4.9.3).
* **Role-based access control**: privileged actions are gated by `AccessControl` roles, with pool-operation
  roles kept separate from upgrade and emergency roles.
* **Pausable**: user-facing flows can be paused in an emergency.
* **Compliance**: pool entry points check sanctions screening and/or whitelisting before accepting funds.

### cSigma v2

Credit pools where lenders deposit stablecoins, pool managers deploy the capital, and repayments flow back
to lenders through a withdrawal queue.

| Contract | Role |
|----------|------|
| [`CsigmaV2Factory`](contracts/v2/CsigmaV2Factory.sol) | Creates and manages v2 pools, fund managers and withdrawal managers |
| [`CsigmaV2Pool`](contracts/v2/CsigmaV2Pool.sol) | Lender-facing pool: deposits, LP tokens, sanctions checks |
| [`CsigmaV2FundManager`](contracts/v2/CsigmaV2FundManager.sol) | Manages fund deployment and claims for pool managers |
| [`CsigmaV2WithdrawalManager`](contracts/v2/CsigmaV2WithdrawalManager.sol) | Queue-based withdrawals of repaid funds |
| [`CsigmaV2StakingPool`](contracts/v2/CsigmaV2StakingPool.sol) | Stake pool assets and earn rewards |
| [`CsigmaV2StakingPoolExtension`](contracts/v2/CsigmaV2StakingPoolExtension.sol) | Additional staking pool, deployed behind its own proxy |

### cSigma v3 (csUSD)

A yield-bearing USD token (csUSD) whose deposits are held in ERC-7575 multi-asset vaults and allocated across
underlying pools.

| Contract | Role |
|----------|------|
| [`CsigmaUSD`](contracts/v3/CsigmaUSD.sol) | csUSD share token with roles, sanctions compliance and pausability |
| [`CsigmaV3Pool`](contracts/v3/CsigmaERC7575Vault.sol) | ERC-7575 vault: deposits a supported asset and mints csUSD |
| [`CsigmaERC4626`](contracts/v3/CsigmaERC4626.sol) | Base ERC-4626 vault logic used by the v3 vault |
| [`CSUSDFundManager`](contracts/v3/CSUSDFundManager.sol) | Allocates and rebalances capital between pools |
| [`CsigmaV3WithdrawalManager`](contracts/v3/CsigmaV3WithdrawalManager.sol) | Queue-based csUSD redemptions |
| [`CsigmaAssetOracle`](contracts/v3/CsigmaAssetOracle.sol) | Chainlink-backed pricing and conversion for supported assets |
| [`Migration`](contracts/v3/Migration.sol) | Moves capital from legacy ERC-4626 pools into csUSD vaults (voluntary, then admin-run after sunset) |

### cSigma Atlas

Permissioned pools for tokenized real-world assets. Only KYB-verified, whitelisted participants can take part,
and capital is deployed directly to whitelisted borrower wallets.

| Contract | Role |
|----------|------|
| [`CsigmaPermissionedFactory`](contracts/AssetTokenization/CsigmaPermissionedFactory.sol) | Deploys permissioned pools, fund managers and withdrawal managers |
| [`CsigmaPermissionedPool`](contracts/AssetTokenization/CsigmaPermissionedPool.sol) | Whitelisted lender pool with a dedicated pool manager role |
| [`CsigmaPermissionedFundManager`](contracts/AssetTokenization/CsigmaPermissionedFundManager.sol) | Deploys capital to whitelisted child pool wallets |
| [`CsigmaPermissionedWithdrawalManager`](contracts/AssetTokenization/CsigmaPermissionedWithdrawalManager.sol) | Queue-based withdrawals for permissioned pools |

### Shared Protocol Contracts

| Contract | Role |
|----------|------|
| [`Sigma`](contracts/token/Sigma.sol) | SIGMA ERC-20 token with permit, pausability and blacklist controls |
| [`SigmaTokenLock`](contracts/protocol/SigmaTokenLock.sol) | Time-based locking of SIGMA tokens |
| [`CsigmaPDN`](contracts/protocol/CsigmaPDN.sol) / [`CsigmaPDNv1_1`](contracts/protocol/CsigmaPDNv1_1.sol) | Pool and lender registry used to record investments |
| [`CsigmaPDNInvestmentNFT`](contracts/protocol/CsigmaPDNInvestmentNFT.sol) | ERC-721 representing a lender's investment in a pool |
| [`CsigmaMetadata`](contracts/protocol/CsigmaMetadata.sol) | Configurable metadata and name tags for pools, lenders and pool managers |
| [`CsigmaRouter`](contracts/CsigmaRouter.sol) | Cross-chain asset bridging via LayerZero / Stargate |
| [`CsigmaTimelock`](contracts/Timelock.sol) | Upgradeable timelock controller for governance actions |

Interfaces live in [`contracts/interfaces`](contracts/interfaces); test-only mocks live in
[`contracts/mocks`](contracts/mocks).

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | EVM deployments: Ethereum, Arbitrum, Base and their testnets |
| `hedera-main` | Hedera-specific build of the same contract suite (excludes the v3 `Migration` contract) |

## Repository Layout

```
contracts/
├── v2/                  # cSigma v2 credit pools
├── v3/                  # cSigma v3 (csUSD) vaults, oracle, migration
├── AssetTokenization/   # cSigma Atlas permissioned pools
├── protocol/            # PDN registry, investment NFT, metadata, token lock
├── token/               # SIGMA token
├── interfaces/
├── mocks/               # test-only contracts
├── CsigmaRouter.sol
└── Timelock.sol
deploy/                  # hardhat-deploy scripts (one per implementation / proxy)
deployments/             # deployed addresses and ABIs per network
scripts/                 # post-deployment and admin scripts
test/                    # Hardhat test suites, grouped like contracts/
docs/                    # generated Solidity API reference
```

## Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) 18 or later (an active LTS release is recommended)
* npm

### Install
```bash
git clone <repository-url>
cd <repository-folder>
npm install
```

## Configuration

Configuration is read from environment variables. The easiest way to set them is to copy the template and fill in
the values you need:

```bash
cp .env.example .env
```

> Never commit `.env`. It is already listed in `.gitignore`. Use a dedicated deployer key for mainnet
> networks and keep it out of any shared environment.

### Deployer accounts
Each network takes **either** a private key **or** a 12-word mnemonic, suffixed with the chain ID.
If both are set, the private key is used.

| Variable | Network |
|----------|---------|
| `P_KEY1` / `MNEMONIC1` | Ethereum mainnet |
| `P_KEY11155111` / `MNEMONIC11155111` | Sepolia |
| `P_KEY42161` / `MNEMONIC42161` | Arbitrum One |
| `P_KEY421614` / `MNEMONIC421614` | Arbitrum Sepolia |
| `P_KEY8453` / `MNEMONIC8453` | Base |
| `P_KEY295` / `MNEMONIC295` | Hedera mainnet |

Private keys should start with `0x`. See [`hardhat.config.js`](hardhat.config.js) for the full network setup.

### RPC endpoints
Set an Alchemy **or** Infura key, or provide a custom RPC URL per network. A custom URL takes priority, then
Alchemy, then Infura.

| Variable | Purpose |
|----------|---------|
| `ALCHEMY_KEY` | Alchemy API key |
| `INFURA_KEY` | Infura API key |
| `MAINNET_RPC_URL`, `SEPOLIA_RPC_URL` | Custom Ethereum endpoints |
| `ARBITRUM_RPC_URL`, `ARB_SEP_RPC_URL` | Custom Arbitrum endpoints |
| `BASE_RPC_URL` | Custom Base endpoint |
| `HEDERA_RPC_URL`, `HEDERATESTNET_RPC_URL` | Custom Hedera endpoints |
| `JSON_RPC_URL` | Fallback endpoint for any network |

### Other settings
| Variable | Purpose |
|----------|---------|
| `ETHERSCAN_KEY` | Etherscan API key for contract verification |
| `ARBISCAN_KEY` | Arbiscan API key for contract verification |
| `REPORT_GAS` | Set to `true` to enable the gas reporter |
| `COINMARKETCAP_API_KEY` | Optional, for USD figures in the gas report |
| `LOG_LEVEL` | Script log level (default `info`) |

## Compilation

```bash
npm run compile
```

The project compiles with multiple Solidity versions (`0.8.4`, `0.8.9`, `0.8.20`, `0.8.26`), all with the optimizer
enabled. Each contract pins an exact compiler version in its `pragma`, so a compiler upgrade means updating those
headers too. Compiler settings live in the `solidity` section of [`hardhat.config.js`](hardhat.config.js).

## Testing

Tests run on the built-in Hardhat Network and are grouped to mirror the contracts:
`test/v2`, `test/v3`, `test/assetTokenization`, `test/protocol` and `test/erc20`.

```bash
# run the full suite
npm test

# run a single file
npx hardhat test test/v3/CsigmaUSD.test.js

# coverage report
npm run coverage
```

## Deployment

Deployments use [hardhat-deploy](https://github.com/wighawag/hardhat-deploy). Each contract has an implementation
script and, where applicable, a `_Proxy` script that deploys the `ERC1967Proxy` and initializes it. Scripts are
**rerunnable**: deployment state is saved under [`deployments/<network>`](deployments), so a partly completed run
continues where it stopped.

```bash
# deploy a single component by tag
npx hardhat deploy --network <network> --tags <Tag>

# example: csUSD implementation and proxy on Arbitrum Sepolia
npx hardhat deploy --network arbsepolia --tags CsigmaUSD,CsigmaUSD_Proxy
```

Commonly used tags:

| Area | Tags |
|------|------|
| v2 | `V2Factory`, `V2Factory_Proxy`, `V2Pool`, `V2FundManager`, `V2WithdrawalManager`, `V2StakingPool`, `V2StakingPoolExtension` |
| v3 | `CsigmaUSD`, `CsigmaUSD_Proxy`, `V3Pool`, `V3Pool_Proxy`, `V3WithdrawalManager`, `CSUSDFundManager`, `CsigmaAssetOracle`, `CsigmaAssetOracle_Proxy`, `Migration`, `Migration_Proxy` |
| Atlas | `PermissionedFactory`, `PermissionedFactory_Proxy`, `PermissionedPool`, `PermissionedFundManager`, `PermissionedWithdrawalManager` |
| Protocol | `Sigma`, `Sigma_Proxy`, `SigmaTokenLock`, `SigmaTokenLock_Proxy`, `SigmaPDN`, `SigmaPDNv1_1`, `SigmaPDNv1_1_Proxy`, `CsigmaPDNInvestmentNFT`, `CsigmaPDNInvestmentNFT_Proxy`, `SigmaMetadata`, `SigmaMetadata_Proxy`, `CsigmaRouter`, `CsigmaRouter_Proxy`, `Timelock`, `Timelock_Proxy` |

To start a deployment from scratch on a network, remove that network's folder under `deployments/` first.

Post-deployment role setup and admin hand-over scripts for v3 live in [`scripts/`](scripts):
```bash
npx hardhat run scripts/post-deploy-v3.js --network <network>
```

### Verifying contracts
```bash
npx hardhat etherscan-verify --network <network> --api-key <your-api-key>
```

## Supported Networks

| Network | Hardhat name | Chain ID |
|---------|--------------|----------|
| Ethereum | `mainnet` | 1 |
| Sepolia | `sepolia` | 11155111 |
| Arbitrum One | `arbitrum` | 42161 |
| Arbitrum Sepolia | `arbsepolia` | 421614 |
| Base | `base` | 8453 |
| Base Sepolia | `baseSepolia` | 84532 |
| Hedera | `hedera` | 295 |
| Hedera Testnet | `hederatestnet` | 296 |

Deployed contract addresses and ABIs for each network are in [`deployments/`](deployments).

## Security

If you believe you have found a security vulnerability, please **do not open a public issue**. Report it privately
to the cSigma team so it can be fixed before disclosure.

## License

The cSigma contracts are licensed under the [Business Source License 1.1](LICENSE.txt) (`BUSL-1.1`).
Code adapted from third-party projects keeps its original license. See [CRIBBED_CODE.txt](CRIBBED_CODE.txt).
