type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Snapshot = { key: string; previous: boolean };
const empty: Snapshot = { key: "", previous: false };
export const purchaseStorageName = (scope: string) => `vetos:purchase-request:${scope}`;

/** Only identities are stored; document fields remain in the form. */
export function createPurchaseRequestStore(
  scope: string,
  storage: () => KeyStorage,
  random: () => string,
) {
  let snapshot = empty;
  const listeners = new Set<() => void>();
  const initialize = () => {
    if (snapshot.key) return;
    let key = random();
    let previous = false;
    try {
      const saved = storage().getItem(purchaseStorageName(scope));
      previous = !!saved;
      key = saved || key;
      storage().setItem(purchaseStorageName(scope), key);
    } catch { /* A mounted form remains retryable without browser storage. */ }
    snapshot = { key, previous };
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    subscribe(listener: () => void) {
      initialize();
      listeners.add(listener);
      listener();
      return () => { listeners.delete(listener); };
    },
    confirm(completedKey: string) {
      if (!snapshot.key || snapshot.key !== completedKey) return;
      try {
        const name = purchaseStorageName(scope);
        if (storage().getItem(name) === completedKey) storage().removeItem(name);
      } catch { /* Confirmation remains visible without browser storage. */ }
      snapshot = { key: random(), previous: false };
      try { storage().setItem(purchaseStorageName(scope), snapshot.key); } catch { /* Keep in memory. */ }
      listeners.forEach((listener) => listener());
    },
  };
}
