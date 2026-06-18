// "Reset to default": wipe all local data and reload to a fresh (onboarding)
// app. Dependencies are injected so the orchestration is unit-testable without
// the app shell, IndexedDB or a real page reload.
export type ResetDeps = {
  // Store-content clears (undo + paint snapshot, pixel log, custom presets…).
  // We clear contents rather than deleteDatabase() because the app holds open
  // IndexedDB connections that would block a delete; an empty store boots
  // identically to a fresh one.
  clearers: (() => Promise<unknown>)[];
  storage: { clear: () => void }; // localStorage (all settings)
  reload: () => void; // location.reload
};

// Run every clear (best-effort, in parallel) before wiping settings storage and
// reloading. Promise.allSettled means one failing store can't strand the reset:
// storage is still cleared and the reload still fires, so the wipe takes effect.
export async function resetToDefault(deps: ResetDeps): Promise<void> {
  await Promise.allSettled(deps.clearers.map((clear) => clear()));
  deps.storage.clear();
  deps.reload();
}
