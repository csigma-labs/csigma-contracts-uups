// we use hardhat deployment to work with fixtures
// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
const {deployments} = require('hardhat');

/**
 * Gets ERC20 token
 *
 * @returns ERC20 instance
 */
async function get_erc20_deployment() {
	// make sure fixtures were deployed, this can be also done via --deploy-fixture test flag
	// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
	await deployments.fixture();

	// get deployed contract address
	const {address} = await deployments.get("Sigma");

	// connect to the contract instance and return it
	const Contract = artifacts.require("./Sigma");
	return await Contract.at(address);
}

/**
 * Gets Upgradeable ERC20 token
 *
 * @returns Upgradeable ERC20 instance (ERC1967 Proxy)
 */
async function get_erc20_upgradeable_deployment() {
	// make sure fixtures were deployed, this can be also done via --deploy-fixture test flag
	// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
	await deployments.fixture();

	// get deployed contract address
	const {address} = await deployments.get("Sigma_Proxy");

	// connect to the contract instance and return it
	const Contract = artifacts.require("./Sigma");
	return await Contract.at(address);
}

/**
 * Gets CsigmaPDN
 *
 * @returns CsigmaPDN instance
 */
async function get_sigmaPDN_deployment() {
	// make sure fixtures were deployed, this can be also done via --deploy-fixture test flag
	// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
	await deployments.fixture();

	// get deployed contract address
	const {address} = await deployments.get("SigmaPDN");

	// connect to the contract instance and return it
	const Contract = artifacts.require("./CsigmaPDN");
	return await Contract.at(address);
}

/**
 * Gets CsigmaPDNv1_1
 *
 * @returns CsigmaPDNv1_1 instance
 */
async function get_sigmaPDNv1_1_deployment() {
	// make sure fixtures were deployed, this can be also done via --deploy-fixture test flag
	// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
	await deployments.fixture();

	// get deployed contract address
	const {address} = await deployments.get("SigmaPDNv1_1");

	// connect to the contract instance and return it
	const Contract = artifacts.require("./CsigmaPDNv1_1");
	return await Contract.at(address);
}

/**
 * Gets Upgradeable CsigmaPDN
 *
 * @returns Upgradeable CsigmaPDN instance (ERC1967 Proxy)
 */
async function get_sigmaPDN_upgradeable_deployment() {
	// make sure fixtures were deployed, this can be also done via --deploy-fixture test flag
	// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
	await deployments.fixture();

	// get deployed contract address
	const {address} = await deployments.get("SigmaPDN_Proxy");

	// connect to the contract instance and return it
	const Contract = artifacts.require("./CsigmaPDN");
	return await Contract.at(address);
}

/**
 * Gets Upgradeable CsigmaPDNv1_1 (proxy deployed directly on the v1_1 implementation)
 *
 * @returns Upgradeable CsigmaPDNv1_1 instance (ERC1967 Proxy)
 */
async function get_sigmaPDNv1_1_upgradeable_deployment() {
	// make sure fixtures were deployed, this can be also done via --deploy-fixture test flag
	// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
	await deployments.fixture();

	// get deployed contract address
	const {address} = await deployments.get("SigmaPDNv1_1_Proxy");

	// connect to the contract instance and return it
	const Contract = artifacts.require("./CsigmaPDNv1_1");
	return await Contract.at(address);
}

/**
 * Gets SigmaTokenLock
 *
 * @returns SigmaTokenLock instance
 */
async function get_sigmaTokenLock_deployment() {
	// make sure fixtures were deployed, this can be also done via --deploy-fixture test flag
	// see https://github.com/wighawag/hardhat-deploy#creating-fixtures
	await deployments.fixture();

	// get deployed contract address
	const {address} = await deployments.get("SigmaTokenLock");

	// connect to the contract instance and return it
	const Contract = artifacts.require("./SigmaTokenLock");
	return await Contract.at(address);
}

// export public deployment API
module.exports = {
	get_erc20_deployment,
	get_erc20_upgradeable_deployment,
	get_sigmaPDN_deployment,
	get_sigmaPDNv1_1_deployment,
	get_sigmaPDN_upgradeable_deployment,
	get_sigmaPDNv1_1_upgradeable_deployment,
	get_sigmaTokenLock_deployment
};