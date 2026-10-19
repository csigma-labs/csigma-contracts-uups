// deploy: npx hardhat deploy --network sepolia --tags V3Pool_Proxy
// verify: npx hardhat etherscan-verify --network sepolia

// script is built for hardhat-deploy plugin:
// A Hardhat Plugin For Replicable Deployments And Easy Testing
// https://www.npmjs.com/package/hardhat-deploy

require('dotenv').config();

// BN utils
const {
	toBN,
	print_amt,
} = require("../scripts/include/bn_utils");

// token name and symbol
const {
	NAME,
	SYMBOL,
} = require("../scripts/include/erc20_constants");

// deployment utils (contract state printers)
const {
	print_contract_details,
} = require("../scripts/deployment_utils");

// to be picked up and executed by hardhat-deploy plugin
module.exports = async function({deployments, getChainId, getNamedAccounts, getUnnamedAccounts}) {
	// print some useful info on the account we're using for the deployment
	const chainId = await getChainId();
	const accounts = await web3.eth.getAccounts();
	// do not use the default account for tests
	const A0 = network.name === "hardhat"? accounts[1]: accounts[0];
	const nonce = await web3.eth.getTransactionCount(A0);
	const balance = await web3.eth.getBalance(A0);

	const share = "0x04d15cea4bd7ced196c24ce87a0190b9a72c5374";
	const poolManager = "0x47128a76e55E0C1689576a80695fae97F661eB46";
	const fundManager = "0x2fb05f52d839301011aad06c7edd156ed554074d";
	const manager = "0x9Bf5A13aCaFaFe2881417fef2f41bF714496ea69";
	// USDC
	const poolToken = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
	// Todo: after usdc deployment 
	// USDT
	// const poolToken = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
	const assetOracle = "0x3936eb150e761ebbacf438fdabeabff67035446f";
	const oracleManager = "0x230493742D0403cac8Be1e18a1cF2e072Ce7CB9F";
	const withdrawalManagerImplementation = "0x9264fe55cd0fc506a04045861cad70a900fe73d4";

	// print initial debug information
	console.log("script: %o", require("path").basename(__filename));
	console.log("network %o %o", chainId, network.name);
	console.log("accounts: %o, service account %o, nonce: %o, balance: %o ETH", accounts.length, A0, nonce, print_amt(balance));

	// V3 Pool ERC1967Proxy
	{
		// get the deployment details
		const v3_deployment = await deployments.get("V3Pool");
		const v3_contract = new web3.eth.Contract(v3_deployment.abi, v3_deployment.address);

		// prepare proxy initialization call bytes
		const proxy_init_data = v3_contract.methods.initialize(
			share, poolManager, fundManager, manager, poolToken, assetOracle, oracleManager, withdrawalManagerImplementation
		).encodeABI();

		// deploy ERC1967 Proxy
		await deployments.deploy("V3Pool_Proxy", {
			// address (or private key) that will perform the transaction.
			// you can use `getNamedAccounts` to retrieve the address you want by name.
			from: A0,
			contract: "ERC1967Proxy",
			// the list of argument for the constructor (or the upgrade function in case of proxy)
			args: [v3_deployment.address, proxy_init_data],
			// if set it to true, will not attempt to deploy even if the contract deployed under the same name is different
			skipIfAlreadyDeployed: true,
			// if true, it will log the result of the deployment (tx hash, address and gas used)
			log: true,
		});
		// get proxy deployment details
		const proxy_deployment = await deployments.get("V3Pool_Proxy");
		const proxy_contract = new web3.eth.Contract(v3_deployment.abi, proxy_deployment.address);

		// print proxy deployment details
		await print_contract_details(A0, v3_deployment.abi, proxy_deployment.address);
	}
};

// Tags represent what the deployment script acts on. In general, it will be a single string value,
// the name of the contract it deploys or modifies.
// Then if another deploy script has such tag as a dependency, then when the latter deploy script has a specific tag
// and that tag is requested, the dependency will be executed first.
// https://www.npmjs.com/package/hardhat-deploy#deploy-scripts-tags-and-dependencies
module.exports.tags = ["V3Pool_Proxy", "deploy"];
module.exports.dependencies = ["V3Pool"];
