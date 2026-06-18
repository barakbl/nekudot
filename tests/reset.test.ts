import { describe, it, expect } from "vitest";
import { resetToDefault } from "../src/app/reset";
import { matchesRequiredText } from "../src/confirm";

describe("matchesRequiredText (the type-\"yes\" gate)", () => {
  it("matches case-insensitively and trims surrounding space", () => {
    expect(matchesRequiredText("yes", "yes")).toBe(true);
    expect(matchesRequiredText("YES", "yes")).toBe(true);
    expect(matchesRequiredText("  Yes  ", "yes")).toBe(true);
  });

  it("rejects empty, partial or wrong input", () => {
    expect(matchesRequiredText("", "yes")).toBe(false);
    expect(matchesRequiredText("y", "yes")).toBe(false);
    expect(matchesRequiredText("yess", "yes")).toBe(false);
    expect(matchesRequiredText("no", "yes")).toBe(false);
  });
});

describe("resetToDefault", () => {
  it("clears every store, then settings storage, then reloads - in order", async () => {
    const calls: string[] = [];
    await resetToDefault({
      clearers: [
        async () => void calls.push("clear-a"),
        async () => void calls.push("clear-b"),
      ],
      storage: { clear: () => calls.push("storage") },
      reload: () => calls.push("reload"),
    });
    // Store clears happen first (awaited), then storage is wiped, then reload.
    expect(calls).toEqual(["clear-a", "clear-b", "storage", "reload"]);
  });

  it("still wipes storage and reloads even if a store clear rejects", async () => {
    const calls: string[] = [];
    await resetToDefault({
      clearers: [
        async () => {
          throw new Error("IDB unavailable");
        },
        async () => void calls.push("clear-b"),
      ],
      storage: { clear: () => calls.push("storage") },
      reload: () => calls.push("reload"),
    });
    expect(calls).toContain("clear-b"); // the other clear still ran
    expect(calls).toContain("storage"); // settings still wiped
    expect(calls.at(-1)).toBe("reload"); // and the reload still fired, last
  });

  it("awaits the clears before wiping storage (no early reload)", async () => {
    const calls: string[] = [];
    let resolveSlow = () => {};
    const slow = new Promise<void>((r) => (resolveSlow = r));
    const done = resetToDefault({
      clearers: [() => slow.then(() => void calls.push("slow-clear"))],
      storage: { clear: () => calls.push("storage") },
      reload: () => calls.push("reload"),
    });
    // Until the slow clear resolves, nothing destructive has happened yet.
    await Promise.resolve();
    expect(calls).toEqual([]);
    resolveSlow();
    await done;
    expect(calls).toEqual(["slow-clear", "storage", "reload"]);
  });
});
