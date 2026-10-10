// Open/closed state for vault doors, kept in localStorage so a reload keeps
// the doors as they were. Pure apart from the storage object passed in.
export const STORAGE_KEY = "cloudspider.vaults.open";
export const DOOR_MS = 650;

// The same open/closed set backs the VPC camps on the map (a different key):
// there a member of the set is a COLLAPSED VPC.
export const VPC_FOLD_KEY = "cloudspider.vpcs.closed";

export function readOpen(storage, storageKey = STORAGE_KEY) {
  try {
    const raw = storage?.getItem?.(storageKey);
    if (!raw) return new Set();
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeOpen(storage, open, storageKey = STORAGE_KEY) {
  try {
    storage?.setItem?.(storageKey, JSON.stringify([...open].sort()));
  } catch {
    // private mode or full: the doors still work for this visit
  }
}

export function createVaultState({ storage, clock = () => Date.now(), storageKey = STORAGE_KEY } = {}) {
  const open = readOpen(storage, storageKey);
  // key -> { open, at }: when the door last started moving.
  const moves = new Map();

  function move(key, isOpen) {
    moves.set(key, { open: isOpen, at: clock() });
  }

  return {
    isOpen(key) {
      return open.has(key);
    },
    toggle(key) {
      const next = !open.has(key);
      if (next) open.add(key);
      else open.delete(key);
      move(key, next);
      writeOpen(storage, open, storageKey);
      return next;
    },
    // Open or close every vault in keys. Returns how many doors moved.
    setAll(keys, isOpen) {
      let moved = 0;
      for (const key of keys) {
        if (open.has(key) === isOpen) continue;
        if (isOpen) open.add(key);
        else open.delete(key);
        move(key, isOpen);
        moved++;
      }
      writeOpen(storage, open, storageKey);
      return moved;
    },
    allOpen(keys) {
      return keys.length > 0 && keys.every((key) => open.has(key));
    },
    // Door position: 0 = shut in the frame, 1 = rolled fully aside.
    door(key, reducedMotion) {
      const target = open.has(key) ? 1 : 0;
      const motion = moves.get(key);
      if (!motion || reducedMotion) return target;
      const t = Math.min(1, Math.max(0, (clock() - motion.at) / DOOR_MS));
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      if (t >= 1) moves.delete(key);
      return target ? eased : 1 - eased;
    },
    moving(reducedMotion) {
      if (reducedMotion) return false;
      const now = clock();
      return [...moves.values()].some((motion) => now - motion.at < DOOR_MS);
    },
    // Part of the layout key: which doors are open.
    key(keys) {
      return keys.filter((key) => open.has(key)).join("|");
    },
  };
}
