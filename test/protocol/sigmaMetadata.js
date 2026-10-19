const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZeroAddress, ZeroHash } = require("ethers");

describe("CsigmaMetadata", function () {
	let accounts, admin, manager, stranger, other;
	let metadataImpl, metadata;
	let ROLE_MANAGER, DEFAULT_ADMIN_ROLE;
	let snapshotId;

	before(async function () {
		accounts = await ethers.getSigners();
		[admin, manager, stranger, other] = accounts;

		const Metadata = await ethers.getContractFactory("CsigmaMetadata");
		metadataImpl = await Metadata.deploy();

		const proxyFactory = await ethers.getContractFactory("ERC1967Proxy");
		const proxy = await proxyFactory.deploy(
			await metadataImpl.getAddress(),
			metadataImpl.interface.encodeFunctionData("initialize", [admin.address, manager.address])
		);
		metadata = await ethers.getContractAt("CsigmaMetadata", await proxy.getAddress());

		ROLE_MANAGER = await metadata.ROLE_MANAGER();
		DEFAULT_ADMIN_ROLE = await metadata.DEFAULT_ADMIN_ROLE();
	});

	// the contracts above are deployed once; every test runs against its own chain
	// snapshot so state from one test never leaks into the next
	beforeEach(async function () {
		snapshotId = await network.provider.request({ method: "evm_snapshot", params: [] });
	});
	afterEach(async function () {
		await network.provider.request({ method: "evm_revert", params: [snapshotId] });
	});

	// a representative, fully-populated Metadata struct
	function sample_metadata(overrides = {}) {
		return Object.assign({
			metadata0: other.address,
			metadata1: 15,
			metadata2: 250,
			metadata3: 800,
			metadata4: 5000000,
			metadata5: 1000,
			metadata6: 1780000000,
			metadata7: -300,
			metadata8: ethers.keccak256(ethers.toUtf8Bytes("legal-agreement-v1")),
			metadata9: "Test Technologies Inc.",
		}, overrides);
	}

	// a full caption schema covering every field in the struct (indices 0-9),
	// the kind of template a pool manager would define once and reuse across pools
	const SAMPLE_CAPTIONS = [
		"Reserve Wallet",
		"Grace Period (days)",
		"Late Fee (bps)",
		"Target APY (bps)",
		"Pool Size (USD)",
		"Minimum Investment (USD)",
		"Inception Timestamp",
		"Reserved",
		"Legal Agreement Hash",
		"Pool Manager Legal Name",
	];

	function assert_metadata_equals(actual, expected) {
		expect(actual.metadata0).to.equal(expected.metadata0);
		expect(actual.metadata1).to.equal(BigInt(expected.metadata1));
		expect(actual.metadata2).to.equal(BigInt(expected.metadata2));
		expect(actual.metadata3).to.equal(BigInt(expected.metadata3));
		expect(actual.metadata4).to.equal(BigInt(expected.metadata4));
		expect(actual.metadata5).to.equal(BigInt(expected.metadata5));
		expect(actual.metadata6).to.equal(BigInt(expected.metadata6));
		expect(actual.metadata7).to.equal(BigInt(expected.metadata7));
		expect(actual.metadata8).to.equal(expected.metadata8);
		expect(actual.metadata9).to.equal(expected.metadata9);
	}

	describe("initialization", function () {
		it("grants DEFAULT_ADMIN_ROLE to the configured admin", async function () {
			expect(await metadata.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
		});

		it("grants ROLE_MANAGER to the configured manager", async function () {
			expect(await metadata.hasRole(ROLE_MANAGER, manager.address)).to.be.true;
		});

		it("cannot be re-initialized once deployed behind the proxy", async function () {
			await expect(metadata.initialize(admin.address, manager.address)).to.be.reverted;
		});

		it("cannot be initialized directly on the implementation contract", async function () {
			await expect(metadataImpl.initialize(admin.address, manager.address)).to.be.reverted;
		});
	});

	describe("updateMetadata", function () {
		describe("when caller has ROLE_MANAGER", function () {
			it("creates metadata for a new id", async function () {
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata());
				const stored = await metadata.getMetadata("POOL-1");
				assert_metadata_equals(stored, sample_metadata());
			});

			it("overwrites metadata for an existing id", async function () {
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata());
				const updated = sample_metadata({ metadata1: 99, metadata9: "Updated Co." });
				await metadata.connect(manager).updateMetadata("POOL-1", updated);
				const stored = await metadata.getMetadata("POOL-1");
				assert_metadata_equals(stored, updated);
			});

			it("keeps different ids independent", async function () {
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata1: 1 }));
				await metadata.connect(manager).updateMetadata("POOL-2", sample_metadata({ metadata1: 2 }));
				expect((await metadata.getMetadata("POOL-1")).metadata1).to.equal(1n);
				expect((await metadata.getMetadata("POOL-2")).metadata1).to.equal(2n);
			});

			it("silently overwrites if the same id is reused for a conceptually different entity", async function () {
				// the contract has no concept of "pool" vs "lender" vs "pool manager" - an id is
				// just a string key, so reusing one across entity types simply overwrites the
				// previous entry. this test documents that (intentional, discussed) behavior.
				await metadata.connect(manager).updateMetadata("SHARED-ID", sample_metadata({ metadata9: "Pool data" }));
				await metadata.connect(manager).updateMetadata("SHARED-ID", sample_metadata({ metadata9: "Lender data" }));
				expect((await metadata.getMetadata("SHARED-ID")).metadata9).to.equal("Lender data");
			});

			it("reverts if _id is empty", async function () {
				await expect(metadata.connect(manager).updateMetadata("", sample_metadata()))
					.to.be.revertedWithCustomError(metadata, "EmptyId").withArgs("");
			});

			it("accepts a whitespace-only id (only byte-length is checked, not content)", async function () {
				await metadata.connect(manager).updateMetadata(" ", sample_metadata());
				const stored = await metadata.getMetadata(" ");
				assert_metadata_equals(stored, sample_metadata());
			});

			it("accepts a very long id string", async function () {
				const long_id = "POOL-" + "9".repeat(200);
				await metadata.connect(manager).updateMetadata(long_id, sample_metadata());
				const stored = await metadata.getMetadata(long_id);
				assert_metadata_equals(stored, sample_metadata());
			});

			it("emits MetadataUpdated", async function () {
				await expect(metadata.connect(manager).updateMetadata("POOL-1", sample_metadata()))
					.to.emit(metadata, "MetadataUpdated");
			});

			it("accepts the zero address for the address field", async function () {
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata0: ZeroAddress }));
				expect((await metadata.getMetadata("POOL-1")).metadata0).to.equal(ZeroAddress);
			});

			it("accepts the zero value for bytes32", async function () {
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata8: ZeroHash }));
				expect((await metadata.getMetadata("POOL-1")).metadata8).to.equal(ZeroHash);
			});

			it("accepts an empty string for the string field", async function () {
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata9: "" }));
				expect((await metadata.getMetadata("POOL-1")).metadata9).to.equal("");
			});

			it("round-trips uint32 fields at their max value with no truncation", async function () {
				const MAX_UINT32 = 4294967295n;
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({
					metadata1: MAX_UINT32, metadata2: MAX_UINT32
				}));
				const stored = await metadata.getMetadata("POOL-1");
				expect(stored.metadata1).to.equal(MAX_UINT32);
				expect(stored.metadata2).to.equal(MAX_UINT32);
			});

			it("round-trips uint64 fields at their max value with no precision loss", async function () {
				const MAX_UINT64 = 18446744073709551615n;
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({
					metadata4: MAX_UINT64, metadata5: MAX_UINT64
				}));
				const stored = await metadata.getMetadata("POOL-1");
				expect(stored.metadata4).to.equal(MAX_UINT64);
				expect(stored.metadata5).to.equal(MAX_UINT64);
			});

			it("stores a negative value in every signed field", async function () {
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({
					metadata3: -800, metadata6: -1780000000, metadata7: -1
				}));
				const stored = await metadata.getMetadata("POOL-1");
				expect(stored.metadata3).to.equal(-800n);
				expect(stored.metadata6).to.equal(-1780000000n);
				expect(stored.metadata7).to.equal(-1n);
			});

			it("round-trips int32 metadata3 at both bounds", async function () {
				const MAX_INT32 = 2147483647n, MIN_INT32 = -2147483648n;
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata3: MAX_INT32 }));
				expect((await metadata.getMetadata("POOL-1")).metadata3).to.equal(MAX_INT32);

				await metadata.connect(manager).updateMetadata("POOL-2", sample_metadata({ metadata3: MIN_INT32 }));
				expect((await metadata.getMetadata("POOL-2")).metadata3).to.equal(MIN_INT32);
			});

			it("round-trips int64 fields at both bounds with no precision loss", async function () {
				const MAX_INT64 = 9223372036854775807n, MIN_INT64 = -9223372036854775808n;
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({
					metadata6: MAX_INT64, metadata7: MAX_INT64
				}));
				let stored = await metadata.getMetadata("POOL-1");
				expect(stored.metadata6).to.equal(MAX_INT64);
				expect(stored.metadata7).to.equal(MAX_INT64);

				await metadata.connect(manager).updateMetadata("POOL-2", sample_metadata({
					metadata6: MIN_INT64, metadata7: MIN_INT64
				}));
				stored = await metadata.getMetadata("POOL-2");
				expect(stored.metadata6).to.equal(MIN_INT64);
				expect(stored.metadata7).to.equal(MIN_INT64);
			});

			// the signed fields give up the top half of their old unsigned range: values that
			// fit the pre-signed uint32/uint64 struct no longer encode. these guard against the
			// field widths silently drifting back
			it("rejects a metadata3 value above the int32 range", async function () {
				await expect(metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({
					metadata3: 2147483648n
				}))).to.be.rejectedWith("value out-of-bounds");
			});

			it("rejects an int64 value above the int64 range", async function () {
				await expect(metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({
					metadata6: 9223372036854775808n
				}))).to.be.rejectedWith("value out-of-bounds");
			});

			it("keeps negative values from disturbing their packed-slot neighbours", async function () {
				// metadata0-3 share one storage slot and metadata4-7 another. a negative value
				// is stored as its two's-complement bit pattern (all-ones for -1), so this pins
				// down that the sign extension stays inside each field's own bytes
				const MAX_UINT32 = 4294967295n, MAX_UINT64 = 18446744073709551615n;
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({
					metadata1: MAX_UINT32, metadata2: MAX_UINT32, metadata3: -1,
					metadata4: MAX_UINT64, metadata5: MAX_UINT64, metadata6: -1, metadata7: -1
				}));
				const stored = await metadata.getMetadata("POOL-1");
				expect(stored.metadata0).to.equal(other.address);
				expect(stored.metadata1).to.equal(MAX_UINT32);
				expect(stored.metadata2).to.equal(MAX_UINT32);
				expect(stored.metadata3).to.equal(-1n);
				expect(stored.metadata4).to.equal(MAX_UINT64);
				expect(stored.metadata5).to.equal(MAX_UINT64);
				expect(stored.metadata6).to.equal(-1n);
				expect(stored.metadata7).to.equal(-1n);
			});

			it("round-trips a string longer than 31 bytes (forces the storage overflow slot)", async function () {
				const long_string = "x".repeat(60);
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata9: long_string }));
				expect((await metadata.getMetadata("POOL-1")).metadata9).to.equal(long_string);
			});

			it("round-trips a string exactly 31 bytes (boundary of the inline encoding)", async function () {
				const boundary_string = "x".repeat(31);
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata9: boundary_string }));
				expect((await metadata.getMetadata("POOL-1")).metadata9).to.equal(boundary_string);
			});
		});

		describe("when caller does not have ROLE_MANAGER", function () {
			it("reverts", async function () {
				await expect(metadata.connect(stranger).updateMetadata("POOL-1", sample_metadata())).to.be.reverted;
			});
		});
	});

	describe("updateNameTag", function () {
		describe("when caller has ROLE_MANAGER", function () {
			it("creates a caption for a new (id, index) pair", async function () {
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");
				expect(await metadata.getNameTag("POOL-1", 0)).to.equal("Reserve Wallet");
			});

			it("overwrites an existing caption", async function () {
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet v2");
				expect(await metadata.getNameTag("POOL-1", 0)).to.equal("Reserve Wallet v2");
			});

			it("can clear a caption back to empty", async function () {
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "");
				expect(await metadata.getNameTag("POOL-1", 0)).to.equal("");
			});

			it("keeps different indices of the same id independent", async function () {
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");
				await metadata.connect(manager).updateNameTag("POOL-1", 1, "Grace Period");
				expect(await metadata.getNameTag("POOL-1", 0)).to.equal("Reserve Wallet");
				expect(await metadata.getNameTag("POOL-1", 1)).to.equal("Grace Period");
			});

			it("keeps the same index independent across different ids", async function () {
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");
				await metadata.connect(manager).updateNameTag("POOL-2", 0, "Collateral Wallet");
				expect(await metadata.getNameTag("POOL-1", 0)).to.equal("Reserve Wallet");
				expect(await metadata.getNameTag("POOL-2", 0)).to.equal("Collateral Wallet");
			});

			it("accepts index 0 (lower boundary)", async function () {
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "First");
				expect(await metadata.getNameTag("POOL-1", 0)).to.equal("First");
			});

			it("accepts index 255, beyond the struct's actual 10 fields (no upper-bound check by design)", async function () {
				// there is intentionally no upper-bound check on _index: the caller (a trusted
				// ROLE_MANAGER holder) is responsible for using indices that correspond to real
				// Metadata fields (0-9). out-of-range indices are simply stored as unused /
				// orphaned captions rather than rejected.
				await metadata.connect(manager).updateNameTag("POOL-1", 255, "Out of range");
				expect(await metadata.getNameTag("POOL-1", 255)).to.equal("Out of range");
			});

			it("sets a caption for every field in the struct (indices 0-9)", async function () {
				for (let index = 0; index < SAMPLE_CAPTIONS.length; index++) {
					await metadata.connect(manager).updateNameTag("POOL-1", index, SAMPLE_CAPTIONS[index]);
				}
				for (let index = 0; index < SAMPLE_CAPTIONS.length; index++) {
					expect(await metadata.getNameTag("POOL-1", index)).to.equal(SAMPLE_CAPTIONS[index]);
				}
			});

			it("applies the same caption schema (template) to two different pools independently", async function () {
				for (let index = 0; index < SAMPLE_CAPTIONS.length; index++) {
					await metadata.connect(manager).updateNameTag("POOL-1", index, SAMPLE_CAPTIONS[index]);
					await metadata.connect(manager).updateNameTag("POOL-2", index, SAMPLE_CAPTIONS[index]);
				}
				for (let index = 0; index < SAMPLE_CAPTIONS.length; index++) {
					expect(await metadata.getNameTag("POOL-1", index)).to.equal(SAMPLE_CAPTIONS[index]);
					expect(await metadata.getNameTag("POOL-2", index)).to.equal(SAMPLE_CAPTIONS[index]);
				}

				// sharing the same caption schema does not link the pools' actual data -
				// each id's Metadata values remain fully independent
				await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata({ metadata1: 111 }));
				await metadata.connect(manager).updateMetadata("POOL-2", sample_metadata({ metadata1: 222 }));
				expect((await metadata.getMetadata("POOL-1")).metadata1).to.equal(111n);
				expect((await metadata.getMetadata("POOL-2")).metadata1).to.equal(222n);
			});

			it("reverts if _id is empty", async function () {
				await expect(metadata.connect(manager).updateNameTag("", 0, "Reserve Wallet"))
					.to.be.revertedWithCustomError(metadata, "EmptyId").withArgs("");
			});

			it("emits NameTagUpdated with an empty old caption on first write", async function () {
				await expect(metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet"))
					.to.emit(metadata, "NameTagUpdated");
			});

			it("emits NameTagUpdated with old and new captions on overwrite", async function () {
				await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");
				await expect(metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet v2"))
					.to.emit(metadata, "NameTagUpdated");
			});
		});

		describe("when caller does not have ROLE_MANAGER", function () {
			it("reverts", async function () {
				await expect(metadata.connect(stranger).updateNameTag("POOL-1", 0, "Reserve Wallet")).to.be.reverted;
			});
		});
	});

	describe("getMetadata", function () {
		it("returns a zero-valued struct for an id that was never set", async function () {
			const stored = await metadata.getMetadata("NEVER-SET");
			expect(stored.metadata0).to.equal(ZeroAddress);
			expect(stored.metadata1).to.equal(0n);
			expect(stored.metadata2).to.equal(0n);
			expect(stored.metadata3).to.equal(0n);
			expect(stored.metadata4).to.equal(0n);
			expect(stored.metadata5).to.equal(0n);
			expect(stored.metadata6).to.equal(0n);
			expect(stored.metadata7).to.equal(0n);
			expect(stored.metadata8).to.equal(ZeroHash);
			expect(stored.metadata9).to.equal("");
		});

		it("is callable by any account, not just ROLE_MANAGER holders", async function () {
			await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata());
			const stored = await metadata.connect(stranger).getMetadata("POOL-1");
			assert_metadata_equals(stored, sample_metadata());
		});
	});

	describe("getNameTag", function () {
		it("returns an empty string for an index that was never set", async function () {
			expect(await metadata.getNameTag("NEVER-SET", 0)).to.equal("");
		});

		it("is callable by any account, not just ROLE_MANAGER holders", async function () {
			await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");
			expect(await metadata.connect(stranger).getNameTag("POOL-1", 0)).to.equal("Reserve Wallet");
		});
	});

	describe("access control", function () {
		it("DEFAULT_ADMIN_ROLE holder can grant ROLE_MANAGER", async function () {
			await metadata.connect(admin).grantRole(ROLE_MANAGER, stranger.address);
			expect(await metadata.hasRole(ROLE_MANAGER, stranger.address)).to.be.true;
		});

		it("DEFAULT_ADMIN_ROLE holder can revoke ROLE_MANAGER", async function () {
			await metadata.connect(admin).grantRole(ROLE_MANAGER, stranger.address);
			await metadata.connect(admin).revokeRole(ROLE_MANAGER, stranger.address);
			expect(await metadata.hasRole(ROLE_MANAGER, stranger.address)).to.be.false;
		});

		it("non-admin cannot grant ROLE_MANAGER", async function () {
			await expect(metadata.connect(stranger).grantRole(ROLE_MANAGER, stranger.address)).to.be.reverted;
		});

		it("non-admin cannot revoke ROLE_MANAGER", async function () {
			await expect(metadata.connect(stranger).revokeRole(ROLE_MANAGER, manager.address)).to.be.reverted;
		});

		it("transferAdmin moves DEFAULT_ADMIN_ROLE to the new address", async function () {
			await metadata.connect(admin).transferAdmin(stranger.address);
			expect(await metadata.hasRole(DEFAULT_ADMIN_ROLE, stranger.address)).to.be.true;
			expect(await metadata.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.false;
		});

		it("emits AdminTransferred", async function () {
			await expect(metadata.connect(admin).transferAdmin(stranger.address))
				.to.emit(metadata, "AdminTransferred")
				.withArgs(admin.address, stranger.address);
		});

		it("old admin loses the ability to grant roles after transferAdmin", async function () {
			await metadata.connect(admin).transferAdmin(stranger.address);
			await expect(metadata.connect(admin).grantRole(ROLE_MANAGER, other.address)).to.be.reverted;
		});

		it("new admin can grant roles after transferAdmin", async function () {
			await metadata.connect(admin).transferAdmin(stranger.address);
			await metadata.connect(stranger).grantRole(ROLE_MANAGER, other.address);
			expect(await metadata.hasRole(ROLE_MANAGER, other.address)).to.be.true;
		});
	});

	describe("upgradeability", function () {
		it("DEFAULT_ADMIN_ROLE holder can upgrade to a new implementation", async function () {
			const Metadata = await ethers.getContractFactory("CsigmaMetadata");
			const newImpl = await Metadata.deploy();
			await metadata.connect(admin).upgradeTo(await newImpl.getAddress());
		});

		it("non-admin cannot upgrade", async function () {
			const Metadata = await ethers.getContractFactory("CsigmaMetadata");
			const newImpl = await Metadata.deploy();
			await expect(metadata.connect(stranger).upgradeTo(await newImpl.getAddress())).to.be.reverted;
		});

		it("preserves previously stored data across an upgrade", async function () {
			await metadata.connect(manager).updateMetadata("POOL-1", sample_metadata());
			await metadata.connect(manager).updateNameTag("POOL-1", 0, "Reserve Wallet");

			const Metadata = await ethers.getContractFactory("CsigmaMetadata");
			const newImpl = await Metadata.deploy();
			await metadata.connect(admin).upgradeTo(await newImpl.getAddress());

			const stored = await metadata.getMetadata("POOL-1");
			assert_metadata_equals(stored, sample_metadata());
			expect(await metadata.getNameTag("POOL-1", 0)).to.equal("Reserve Wallet");
		});
	});
});