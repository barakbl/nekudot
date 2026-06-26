// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { createFolderSync } from "../src/app/folder-sync";
import type { FileVault, VaultEntry } from "../src/sync/file-vault";
import type { LayerManager } from "../src/layered/manager";

// The controller orchestrates a FileVault + the build/apply helpers. We inject a
// fake vault and fake build/apply seams so the logic (connect-gating, the
// remembered artwork filename, settings round-trip) is testable without the
// File System Access API, IndexedDB, or a real LayerManager.

class FakeVault implements FileVault {
  supported = true;
  connected = false;
  connectResult = true;
  files = new Map<string, string>();

  label() {
    return this.connected ? "Test Folder" : null;
  }
  isConnected() {
    return this.connected;
  }
  async connect() {
    if (this.connectResult) this.connected = true;
    return this.connectResult;
  }
  async disconnect() {
    this.connected = false;
  }
  async restore() {
    return false;
  }
  async write(name: string, blob: Blob) {
    this.files.set(name, await blob.text());
  }
  async read(name: string) {
    const t = this.files.get(name);
    return t === undefined ? null : new Blob([t]);
  }
  async list(): Promise<VaultEntry[]> {
    return [...this.files.keys()].map((name) => ({ name, lastModified: 0 }));
  }
}

const ART_RE = /^art_\d{8}_\d{6}\.nekudot$/;

function make(vault: FakeVault, applied: string[] = []) {
  return createFolderSync({
    manager: {} as LayerManager,
    vault,
    buildArtwork: async () => new Blob(["ART"]),
    buildSettingsText: async () => '{"kind":"nekudot-settings","version":1}',
    applySettingsText: (text) => applied.push(text),
  });
}

// The unit env's global localStorage is unreliable (Node's experimental Web
// Storage), so install a fresh in-memory one per test for the remembered-filename
// state the controller persists.
beforeEach(() => {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    },
  });
});

describe("folder sync controller", () => {
  it("reports support + connects through the vault", async () => {
    const vault = new FakeVault();
    const fs = make(vault);
    expect(fs.supported).toBe(true);
    expect(fs.isConnected()).toBe(false);
    await fs.connect();
    expect(fs.isConnected()).toBe(true);
    expect(fs.folderName()).toBe("Test Folder");
  });

  it("does nothing when the user cancels the folder pick", async () => {
    const vault = new FakeVault();
    vault.connectResult = false;
    const fs = make(vault);
    await fs.syncArtwork();
    expect(vault.files.size).toBe(0); // never connected, nothing written
    expect(fs.currentArtworkFile()).toBeNull();
  });

  it("syncs the artwork under a safe timestamped name and remembers it", async () => {
    const vault = new FakeVault();
    const fs = make(vault);
    await fs.connect();
    await fs.syncArtwork();

    const names = [...vault.files.keys()].filter((n) => n.endsWith(".nekudot"));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(ART_RE); // YYYYMMDD_HHMMSS, no colons
    expect(fs.currentArtworkFile()).toBe(names[0]);

    // A second sync overwrites the SAME file (no duplicate).
    await fs.syncArtwork();
    expect([...vault.files.keys()].filter((n) => n.endsWith(".nekudot"))).toEqual(
      names,
    );
  });

  it("forgets the file so the next sync starts a fresh one", async () => {
    const vault = new FakeVault();
    const fs = make(vault);
    await fs.connect();
    await fs.syncArtwork();
    expect(fs.currentArtworkFile()).not.toBeNull();

    fs.forgetArtworkFile();
    expect(fs.currentArtworkFile()).toBeNull();

    await fs.syncArtwork();
    expect(fs.currentArtworkFile()).toMatch(ART_RE);
  });

  it("saves settings to app.nekudotapp and loads them back", async () => {
    const vault = new FakeVault();
    const applied: string[] = [];
    const fs = make(vault, applied);
    await fs.connect();

    await fs.saveSettings();
    expect(vault.files.has("app.nekudotapp")).toBe(true);

    await fs.loadSettings();
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain("nekudot-settings");
  });

  it("doesn't apply when there's no settings file in the folder", async () => {
    const vault = new FakeVault();
    const applied: string[] = [];
    const fs = make(vault, applied);
    await fs.connect();
    await fs.loadSettings(); // folder empty
    expect(applied).toHaveLength(0);
  });

  it("adopts an uploaded filename so a sync overwrites it (no duplicate)", async () => {
    const vault = new FakeVault();
    const fs = make(vault);
    await fs.connect();
    fs.setArtworkFile("My Painting.nekudot");
    expect(fs.currentArtworkFile()).toBe("My Painting.nekudot");

    await fs.syncArtwork();
    expect(vault.files.has("My Painting.nekudot")).toBe(true);
    expect([...vault.files.keys()].some((n) => /^art_/.test(n))).toBe(false);
  });

  it("normalizes an adopted name to a basename with a .nekudot extension", () => {
    const fs = make(new FakeVault());
    fs.setArtworkFile("/Users/me/art/sketch.zip");
    expect(fs.currentArtworkFile()).toBe("sketch.nekudot");
  });

  it("forgets when the adopted name is unusable", () => {
    const fs = make(new FakeVault());
    fs.setArtworkFile("keep.nekudot");
    fs.setArtworkFile(""); // unusable -> forget
    expect(fs.currentArtworkFile()).toBeNull();
  });
});
