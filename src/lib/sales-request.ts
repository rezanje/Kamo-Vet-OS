type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Snapshot = { key: string; previous: boolean; unavailable: boolean };
const empty: Snapshot = { key: "", previous: false, unavailable: false };
export const salesStorageName = (scope: string) => `vetos:sales-request:${scope}`;

/** Keep only an identity, never document contents or a queued transaction. */
export function createSalesRequestStore(scope: string, storage: () => KeyStorage, random: () => string, recoveryOnly = false) {
  let snapshot = empty;
  const listeners = new Set<() => void>();
  let initialized = false;
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    subscribe(listener: () => void) {
      if (!initialized) {
        initialized = true;
        try {
          const saved = storage().getItem(salesStorageName(scope));
          const key = saved || (recoveryOnly ? "" : random());
          if (key) storage().setItem(salesStorageName(scope), key);
          snapshot = { key, previous: !!saved, unavailable: false };
        } catch {
          // Without persistent identity a remounted form could post twice.
          snapshot = { key: "", previous: false, unavailable: true };
        }
      }
      listeners.add(listener); listener();
      return () => { listeners.delete(listener); };
    },
    confirm(completedKey: string) {
      if (!completedKey || snapshot.key !== completedKey) return;
      try {
        const name = salesStorageName(scope);
        if (storage().getItem(name) === completedKey) storage().removeItem(name);
        const key = recoveryOnly ? "" : random();
        if (key) storage().setItem(name, key);
        snapshot = { key, previous: false, unavailable: false };
      } catch {
        snapshot = { key: "", previous: false, unavailable: true };
      }
      listeners.forEach(listener => listener());
    },
  };
}
