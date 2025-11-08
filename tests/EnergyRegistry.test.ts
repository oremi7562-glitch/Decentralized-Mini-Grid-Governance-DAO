// EnergyRegistry.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_UNAUTHORIZED = 300n;
const ERR_ASSET_EXISTS = 301n;
const ERR_ASSET_NOT_FOUND = 302n;
const ERR_INVALID_CAPACITY = 303n;
const ERR_INVALID_LOCATION = 304n;
const ERR_NOT_OWNER = 305n;
const ERR_ASSET_LOCKED = 306n;
const ERR_INVALID_METADATA = 307n;

interface EnergyAsset {
  id: bigint;
  owner: string;
  assetType: string;
  capacityKw: bigint;
  location: string;
  metadataHash: string;
  registeredAt: bigint;
  active: boolean;
  locked: boolean;
}

class EnergyRegistryMock {
  state: {
    nonce: bigint;
    executor: string;
    assets: Map<bigint, EnergyAsset>;
    assetsByOwner: Map<string, Set<bigint>>;
    assetsByLocation: Map<string, bigint[]>;
  } = {
    nonce: 0n,
    executor: "ST1EXEC",
    assets: new Map(),
    assetsByOwner: new Map(),
    assetsByLocation: new Map(),
  };

  caller = "ST1OWNER";
  blockHeight = 2000n;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nonce: 0n,
      executor: "ST1EXEC",
      assets: new Map(),
      assetsByOwner: new Map(),
      assetsByLocation: new Map(),
    };
    this.caller = "ST1OWNER";
    this.blockHeight = 2000n;
  }

  registerAsset(
    assetType: string,
    capacityKw: bigint,
    location: string,
    metadataHash: string
  ): { ok: boolean; value: bigint } {
    if (!["solar", "wind", "hydro", "battery", "generator"].includes(assetType))
      return { ok: false, value: ERR_INVALID_METADATA };
    if (capacityKw <= 0n) return { ok: false, value: ERR_INVALID_CAPACITY };
    if (location.length > 120)
      return { ok: false, value: ERR_INVALID_LOCATION };
    if (metadataHash.length !== 64)
      return { ok: false, value: ERR_INVALID_METADATA };

    const id = this.state.nonce;
    const asset: EnergyAsset = {
      id,
      owner: this.caller,
      assetType,
      capacityKw,
      location,
      metadataHash,
      registeredAt: this.blockHeight,
      active: true,
      locked: false,
    };

    this.state.assets.set(id, asset);
    if (!this.state.assetsByOwner.has(this.caller)) {
      this.state.assetsByOwner.set(this.caller, new Set());
    }
    this.state.assetsByOwner.get(this.caller)!.add(id);

    if (!this.state.assetsByLocation.has(location)) {
      this.state.assetsByLocation.set(location, []);
    }
    this.state.assetsByLocation.set(
      location,
      [...this.state.assetsByLocation.get(location)!, id].slice(-100)
    );

    this.state.nonce += 1n;
    return { ok: true, value: id };
  }

  updateAssetMetadata(
    assetId: bigint,
    newHash: string
  ): { ok: boolean; value: boolean } {
    const asset = this.state.assets.get(assetId);
    if (!asset) return { ok: false, value: ERR_ASSET_NOT_FOUND };
    if (asset.owner !== this.caller) return { ok: false, value: ERR_NOT_OWNER };
    if (asset.locked) return { ok: false, value: ERR_ASSET_LOCKED };
    if (newHash.length !== 64)
      return { ok: false, value: ERR_INVALID_METADATA };

    this.state.assets.set(assetId, { ...asset, metadataHash: newHash });
    return { ok: true, value: true };
  }

  transferAssetOwnership(
    assetId: bigint,
    newOwner: string
  ): { ok: boolean; value: boolean } {
    const asset = this.state.assets.get(assetId);
    if (!asset) return { ok: false, value: ERR_ASSET_NOT_FOUND };
    if (asset.owner !== this.caller) return { ok: false, value: ERR_NOT_OWNER };
    if (asset.locked) return { ok: false, value: ERR_ASSET_LOCKED };

    this.state.assetsByOwner.get(this.caller)!.delete(assetId);
    if (!this.state.assetsByOwner.has(newOwner)) {
      this.state.assetsByOwner.set(newOwner, new Set());
    }
    this.state.assetsByOwner.get(newOwner)!.add(assetId);

    this.state.assets.set(assetId, { ...asset, owner: newOwner });
    return { ok: true, value: true };
  }

  deactivateAsset(assetId: bigint): { ok: boolean; value: boolean } {
    const asset = this.state.assets.get(assetId);
    if (!asset) return { ok: false, value: ERR_ASSET_NOT_FOUND };
    if (asset.owner !== this.caller) return { ok: false, value: ERR_NOT_OWNER };
    this.state.assets.set(assetId, { ...asset, active: false });
    return { ok: true, value: true };
  }

  executeAssetLock(assetId: bigint): { ok: boolean; value: boolean } {
    if (this.caller !== this.state.executor)
      return { ok: false, value: ERR_UNAUTHORIZED };
    const asset = this.state.assets.get(assetId);
    if (!asset) return { ok: false, value: ERR_ASSET_NOT_FOUND };
    this.state.assets.set(assetId, { ...asset, locked: true });
    return { ok: true, value: true };
  }

  getAsset(id: bigint): EnergyAsset | null {
    return this.state.assets.get(id) || null;
  }

  getTotalAssets(): bigint {
    return this.state.nonce;
  }
}

describe("EnergyRegistry.clar", () => {
  let mock: EnergyRegistryMock;

  beforeEach(() => {
    mock = new EnergyRegistryMock();
    mock.reset();
  });

  it("registers valid solar asset", () => {
    const result = mock.registerAsset(
      "solar",
      50n,
      "Village A - Grid Point 1",
      "a".repeat(64)
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);
    const asset = mock.getAsset(0n);
    expect(asset?.assetType).toBe("solar");
    expect(asset?.capacityKw).toBe(50n);
    expect(asset?.owner).toBe("ST1OWNER");
    expect(asset?.active).toBe(true);
  });

  it("rejects invalid asset types", () => {
    const result = mock.registerAsset(
      "nuclear",
      100n,
      "Zone X",
      "b".repeat(64)
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_METADATA);
  });

  it("rejects zero capacity", () => {
    const result = mock.registerAsset("wind", 0n, "Hilltop", "c".repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CAPACITY);
  });

  it("allows metadata updates by owner", () => {
    mock.registerAsset("battery", 200n, "Substation B", "d".repeat(64));
    const result = mock.updateAssetMetadata(0n, "e".repeat(64));
    expect(result.ok).toBe(true);
    const asset = mock.getAsset(0n);
    expect(asset?.metadataHash).toBe("e".repeat(64));
  });

  it("prevents metadata update on locked asset", () => {
    mock.registerAsset("hydro", 500n, "River Dam", "f".repeat(64));
    mock.caller = "ST1EXEC";
    mock.executeAssetLock(0n);
    mock.caller = "ST1OWNER";
    const result = mock.updateAssetMetadata(0n, "g".repeat(64));
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ASSET_LOCKED);
  });

  it("transfers ownership correctly", () => {
    mock.registerAsset("solar", 30n, "Rooftop C", "h".repeat(64));
    const result = mock.transferAssetOwnership(0n, "ST2NEWOWNER");
    expect(result.ok).toBe(true);
    const asset = mock.getAsset(0n);
    expect(asset?.owner).toBe("ST2NEWOWNER");
  });

  it("only executor can lock assets", () => {
    mock.registerAsset("wind", 80n, "Coastline", "i".repeat(64));
    mock.caller = "ST1HACKER";
    const result = mock.executeAssetLock(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });

  it("tracks multiple assets per location", () => {
    mock.registerAsset("solar", 20n, "Community Center", "j".repeat(64));
    mock.registerAsset("battery", 100n, "Community Center", "k".repeat(64));
    mock.registerAsset("solar", 35n, "Community Center", "l".repeat(64));
    expect(mock.state.assetsByLocation.get("Community Center")?.length).toBe(3);
  });

  it("deactivates asset properly", () => {
    mock.registerAsset("generator", 150n, "Backup Site", "m".repeat(64));
    const result = mock.deactivateAsset(0n);
    expect(result.ok).toBe(true);
    const asset = mock.getAsset(0n);
    expect(asset?.active).toBe(false);
  });

  it("increments total assets correctly", () => {
    mock.registerAsset("solar", 10n, "A", "n".repeat(64));
    mock.registerAsset("wind", 20n, "B", "o".repeat(64));
    expect(mock.getTotalAssets()).toBe(2n);
  });
});
