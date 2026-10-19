/**
 * default Hardhat configuration which uses account mnemonic to derive accounts
 * script expects following environment variables to be set:
 *   - P_KEY1 – mainnet private key, should start with 0x
 *     or
 *   - MNEMONIC1 – mainnet mnemonic, 12 words
*
*   - P_KEY11155111 – sepolia private key, should start with 0x
*     or
*   - MNEMONIC11155111 – sepolia mnemonic, 12 words
*
*   - P_KEY42161 – arbitrum private key, should start with 0x
*     or
*   - MNEMONIC42161 – arbitrum mnemonic, 12 words
*
*   - P_KEY421614 – arbitrum sepolia private key, should start with 0x
*     or
*   - MNEMONIC421614 – arbitrum sepolia mnemonic, 12 words
*
*   - ALCHEMY_KEY – Alchemy API key
*     or
*   - INFURA_KEY – Infura API key (Project ID)
*
*   - ETHERSCAN_KEY – Etherscan API key
*
*   - ARBISCAN_KEY – arbiscan API key
*/

// Loads env variables from .env file
require('dotenv').config()

// Enable Truffle 5 plugin for tests
// https://hardhat.org/guides/truffle-testing.html
require("@nomiclabs/hardhat-truffle5");

// enable Solidity-coverage
// https://hardhat.org/plugins/solidity-coverage.html
require("solidity-coverage");

// enable hardhat-gas-reporter
// https://hardhat.org/plugins/hardhat-gas-reporter.html
require("hardhat-gas-reporter");

// compile Solidity sources directly from NPM dependencies
// https://github.com/ItsNickBarry/hardhat-dependency-compiler
require("hardhat-dependency-compiler");

// adds a mechanism to deploy contracts to any network,
// keeping track of them and replicating the same environment for testing
// https://www.npmjs.com/package/hardhat-deploy
require("hardhat-deploy");

require("@nomicfoundation/hardhat-verify");
require("@nomicfoundation/hardhat-toolbox");

// verify environment setup, display warning if required, replace missing values with fakes
const FAKE_MNEMONIC = "test test test test test test test test test test test junk";
if(!process.env.MNEMONIC1 && !process.env.P_KEY1) {
	console.warn("neither MNEMONIC1 nor P_KEY1 is not set. Mainnet deployments won't be available");
	process.env.MNEMONIC1 = FAKE_MNEMONIC;
}
else if(process.env.P_KEY1 && !process.env.P_KEY1.startsWith("0x")) {
	console.warn("P_KEY1 doesn't start with 0x. Appended 0x");
	process.env.P_KEY1 = "0x" + process.env.P_KEY1;
}
if(!process.env.MNEMONIC11155111 && !process.env.P_KEY11155111) {
	console.warn("neither MNEMONIC11155111 nor P_KEY11155111 is not set. Sepolia deployments won't be available");
	process.env.MNEMONIC11155111 = FAKE_MNEMONIC;
}
else if(process.env.P_KEY11155111 && !process.env.P_KEY11155111.startsWith("0x")) {
	console.warn("P_KEY11155111 doesn't start with 0x. Appended 0x");
	process.env.P_KEY11155111 = "0x" + process.env.P_KEY11155111;
}
if(!process.env.MNEMONIC42161 && !process.env.P_KEY42161) {
	console.warn("neither MNEMONIC42161 nor P_KEY42161 is not set. Arbitrum deployments won't be available");
	process.env.MNEMONIC42161 = FAKE_MNEMONIC;
}
else if(process.env.P_KEY42161 && !process.env.P_KEY42161.startsWith("0x")) {
	console.warn("P_KEY4 doesn't start with 0x. Appended 0x");
	process.env.P_KEY42161 = "0x" + process.env.P_KEY42161;
}
if(!process.env.MNEMONIC421614 && !process.env.P_KEY421614) {
	console.warn("neither MNEMONIC421614 nor P_KEY421614 is not set. Arbitrum sepolia deployments won't be available");
	process.env.MNEMONIC421614 = FAKE_MNEMONIC;
}
else if(process.env.P_KEY421614 && !process.env.P_KEY421614.startsWith("0x")) {
	console.warn("P_KEY421614 doesn't start with 0x. Appended 0x");
	process.env.P_KEY421614 = "0x" + process.env.P_KEY421614;
}
if(!process.env.INFURA_KEY && !process.env.ALCHEMY_KEY) {
	console.warn("neither INFURA_KEY nor ALCHEMY_KEY is not set. Deployments may not be available");
	process.env.INFURA_KEY = "";
	process.env.ALCHEMY_KEY = "";
}
if(!process.env.ETHERSCAN_KEY) {
	console.warn("ETHERSCAN_KEY is not set. Deployed smart contract code verification won't be available");
	process.env.ETHERSCAN_KEY = "";
}
if(!process.env.ARBISCAN_KEY) {
	console.warn("ARBISCAN_KEY is not set. Deployed smart contract code verification won't be available on arbiscan");
	process.env.ARBISCAN_KEY = "";
}

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
	defaultNetwork: "hardhat",
	networks: {
		// https://hardhat.org/hardhat-network/
		hardhat: {
			// set networkId to 0xeeeb04de as for all local networks
			chainId: 0xeeeb04de,
			// set the gas price to one for convenient tx costs calculations in tests
			// gasPrice: 1,
			// London hard fork fix: impossible to set gas price lower than baseFeePerGas (875,000,000)
			initialBaseFeePerGas: 0,
			accounts: {
				count: 35,
			},
/*
			forking: {
				url: "https://mainnet.infura.io/v3/" + process.env.INFURA_KEY, // create a key: https://infura.io/
				enabled: !!(process.env.HARDHAT_FORK),
			},
*/
		},
		mainnet: {
			url: get_endpoint_url("mainnet"),
			accounts: get_accounts(process.env.P_KEY1, process.env.MNEMONIC1),
		},
		sepolia: {
			url: get_endpoint_url("sepolia"),
			accounts: get_accounts(process.env.P_KEY11155111, process.env.MNEMONIC11155111),
		},
		arbitrum: {
			url: get_endpoint_url("arbitrum"),
			accounts: get_accounts(process.env.P_KEY42161, process.env.MNEMONIC42161),
		},
		arbsepolia: {
			url: get_endpoint_url("arbsepolia"),
			accounts: get_accounts(process.env.P_KEY421614, process.env.MNEMONIC421614),
		},
		base: {
			url: get_endpoint_url("base"),
			accounts: get_accounts(process.env.P_KEY8453, process.env.MNEMONIC8453),
		},
		hedera: {			
			url: get_endpoint_url("hedera"),
			accounts: get_accounts(process.env.P_KEY295, process.env.MNEMONIC295),
		},
		hederatestnet: {			
			url: get_endpoint_url("hederatestnet"),
			accounts: get_accounts(process.env.P_KEY296, process.env.MNEMONIC296),
		}
	},

	// Configure Solidity compiler
	solidity: {
		// https://hardhat.org/guides/compile-contracts.html
		compilers: [
			{ // project main compiler version
				version: "0.8.4",
				settings: {
					optimizer: {
						enabled: true,
						runs: 200
					}
				}
			},
			{ // project main compiler version
				version: "0.8.9",
				settings: {
					optimizer: {
						enabled: true,
						runs: 200
					}
				}
			},
			{ // project main compiler version
				version: "0.8.20",
				settings: {
					optimizer: {
						enabled: true,
						runs: 200
					}
				}
			},
			{ // project main compiler version
				version: "0.8.26",
				settings: {
					optimizer: {
						enabled: true,
						runs: 200
					}
				}
			},
		]
	},

	etherscan: {
		apiKey: {
		  mainnet: process.env.ETHERSCAN_KEY
			? process.env.ETHERSCAN_KEY
			: "",
		  sepolia: process.env.ETHERSCAN_KEY
		  	? process.env.ETHERSCAN_KEY
		  	: "",
		  arbitrum: process.env.ARBISCAN_KEY
		  	? process.env.ARBISCAN_KEY
		  	: "",
		  arbitrumSepolia: process.env.ARBISCAN_KEY
		  	? process.env.ARBISCAN_KEY
		  	: "",
		  base: process.env.BASESCAN_KEY
			? process.env.BASESCAN_KEY
			: "",	 		
		},
	},
	sourcify: {
		enabled: true,
		apiUrl: "https://sourcify.dev/server",
		browserUrl: "https://repo.sourcify.dev",
	},

	// Set default mocha options here, use special reporters etc.
	mocha: {
		// timeout: 100000,

		// disable mocha timeouts:
		// https://mochajs.org/api/mocha#enableTimeouts
		enableTimeouts: false,
		// https://github.com/mochajs/mocha/issues/3813
		timeout: false,
	},

	// hardhat-gas-reporter will be disabled by default, use REPORT_GAS environment variable to enable it
	// https://hardhat.org/plugins/hardhat-gas-reporter.html
	gasReporter: {
		enabled: true,
		currency: "USD",
    	token: "ETH",
    	coinmarketcap: process.env.COINMARKETCAP_API_KEY,
	},

	// compile Solidity sources directly from NPM dependencies
	// https://github.com/ItsNickBarry/hardhat-dependency-compiler
	dependencyCompiler: {
		paths: [
			// ERC1967 is used to deploy upgradeable contracts
			"@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol",
		],
	},
}

/**
 * Determines a JSON-RPC endpoint to use to connect to the node
 * based on the requested network name and environment variables set
 *
 * Tries to use custom RPC URL first (MAINNET_RPC_URL/ROPSTEN_RPC_URL/RINKEBY_RPC_URL/KOVAN_RPC_URL)
 * Tries to use alchemy RPC URL next (if ALCHEMY_KEY is set)
 * Fallbacks to infura RPC URL
 *
 * @param network_name one of mainnet/ropsten/rinkeby/kovan
 * @return JSON-RPC endpoint URL
 */
function get_endpoint_url(network_name) {
	// try custom RPC endpoint first (private node, quicknode, etc.)
	// create a quicknode key: https://www.quicknode.com/
	if(process.env.MAINNET_RPC_URL && network_name === "mainnet") {
		return process.env.MAINNET_RPC_URL;
	}
	if(process.env.SEPOLIA_RPC_URL && network_name === "sepolia") {
		return process.env.SEPOLIA_RPC_URL;
	}
	if(process.env.ARBITRUM_RPC_URL && network_name === "arbitrum") {
		return process.env.ARBITRUM_RPC_URL;
	}
	if(process.env.ARB_SEP_RPC_URL && network_name === "arbsepolia") {
		return process.env.ARB_SEP_RPC_URL;
	}
	if(process.env.BASE_RPC_URL && network_name === "base") {
		return process.env.BASE_RPC_URL;
	}
	if(process.env.HEDERA_RPC_URL && network_name === "hedera") {
		return process.env.HEDERA_RPC_URL;
	}
	if(process.env.HEDERATESTNET_RPC_URL && network_name === "hederatestnet") {
		return process.env.HEDERATESTNET_RPC_URL;
	}

	// try the alchemy next
	// create a key: https://www.alchemy.com/
	if(process.env.ALCHEMY_KEY) {
		switch(network_name) {
			case "mainnet": return "https://eth-mainnet.alchemyapi.io/v2/" + process.env.ALCHEMY_KEY;
			case "sepolia": return "https://eth-sepolia.alchemyapi.io/v2/" + process.env.ALCHEMY_KEY;
			case "arbitrum": return "https://arbitrum-mainnet.alchemyapi.io/v2/" + process.env.ALCHEMY_KEY;
			case "arbsepolia": return "https://arbitrum-sepolia.alchemyapi.io/v2/" + process.env.ALCHEMY_KEY;
		}
	}

	// fallback to infura
	// create a key: https://infura.io/
	if(process.env.INFURA_KEY) {
		switch(network_name) {
			case "mainnet": return "https://mainnet.infura.io/v3/" + process.env.INFURA_KEY;
			case "sepolia": return "https://sepolia.infura.io/v3/" + process.env.INFURA_KEY;
			case "arbitrum": return "https://arbitrum-mainnet.infura.io/v3/" + process.env.INFURA_KEY;
			case "arbsepolia": return "https://arbitrum-sepolia.infura.io/v3/" + process.env.INFURA_KEY;
			case "base": return "https://base-mainnet.infura.io/v3/" + process.env.INFURA_KEY;
		}
	}

	// fallback to default JSON_RPC_URL (if set)
	return process.env.JSON_RPC_URL || "";
}

/**
 * Depending on which of the inputs are available (private key or mnemonic),
 * constructs an account object for use in the hardhat config
 *
 * @param p_key account private key, export private key from mnemonic: https://metamask.io/
 * @param mnemonic 12 words mnemonic, create 12 words: https://metamask.io/
 * @return either [p_key] if p_key is defined, or {mnemonic} if mnemonic is defined
 */
function get_accounts(p_key, mnemonic) {
	return p_key? [p_key]: mnemonic? {mnemonic, initialIndex: 0}: undefined;
}
