// deploy: npx hardhat deploy --network sepolia --tags PermissionedFactory_Proxy
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

	// print initial debug information
	console.log("script: %o", require("path").basename(__filename));
	console.log("network %o %o", chainId, network.name);
	console.log("accounts: %o, service account %o, nonce: %o, balance: %o ETH", accounts.length, A0, nonce, print_amt(balance));

	// Permissioned Factory ERC1967Proxy
	{
		// get the deployment details
		const permissioned_deployment = await deployments.get("PermissionedFactory");
		const permissioned_contract = new web3.eth.Contract(permissioned_deployment.abi, permissioned_deployment.address);

		const permissioned_fund_manager_deployment = await deployments.get("PermissionedFundManager");
		const permissioned_pool_deployment = await deployments.get("PermissionedPool");
		const permissioned_withdraw_manager_deployment = await deployments.get("PermissionedWithdrawalManager");
		const configManagerAddr = "";
		const v1Diamond = "";

		// prepare proxy initialization call bytes
		const proxy_init_data = permissioned_contract.methods.initialize(
			A0,
			configManagerAddr,
			permissioned_fund_manager_deployment.address,
			permissioned_pool_deployment.address,
			permissioned_withdraw_manager_deployment.address,
			v1Diamond
		).encodeABI();

		// deploy ERC1967 Proxy
		await deployments.deploy("PermissionedFactory_Proxy", {
			// address (or private key) that will perform the transaction.
			// you can use `getNamedAccounts` to retrieve the address you want by name.
			from: A0,
			contract: "ERC1967Proxy",
			// the list of argument for the constructor (or the upgrade function in case of proxy)
			args: [permissioned_deployment.address, proxy_init_data],
			// if set it to true, will not attempt to deploy even if the contract deployed under the same name is different
			skipIfAlreadyDeployed: true,
			// if true, it will log the result of the deployment (tx hash, address and gas used)
			log: true,
		});
		// get proxy deployment details
		const proxy_deployment = await deployments.get("PermissionedFactory_Proxy");
		const proxy_contract = new web3.eth.Contract(permissioned_deployment.abi, proxy_deployment.address);

		// print proxy deployment details
		await print_contract_details(A0, permissioned_deployment.abi, proxy_deployment.address);
	}
};

// Tags represent what the deployment script acts on. In general, it will be a single string value,
// the name of the contract it deploys or modifies.
// Then if another deploy script has such tag as a dependency, then when the latter deploy script has a specific tag
// and that tag is requested, the dependency will be executed first.
// https://www.npmjs.com/package/hardhat-deploy#deploy-scripts-tags-and-dependencies
module.exports.tags = ["PermissionedFactory_Proxy", "deploy"];
module.exports.dependencies = ["PermissionedFactory", "PermissionedFundManager", "PermissionedPool", "PermissionedWithdrawalManager"];