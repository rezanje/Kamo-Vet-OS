"use client";

// ponytail: dismissal disimpan per-browser (localStorage), bukan per-user di server —
// cukup buat kasir single-device. Upgrade ke tabel read-tracking kalau perlu sinkron lintas device.
import { useEffect, useState } from "react";

const KEY = "vetos_notif_seen";
const EVT = "vetos-notif-seen-change";

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function writeSeen(ids: Set<string>) {
  localStorage.setItem(KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new Event(EVT));
}

export function markNotifSeen(id: string) {
  const s = readSeen();
  s.add(id);
  writeSeen(s);
}

export function markAllNotifSeen(ids: string[]) {
  const s = readSeen();
  ids.forEach((id) => s.add(id));
  writeSeen(s);
}

export function useNotifSeen(): Set<string> {
  // Mulai kosong biar render client pertama == server (hindari hydration mismatch);
  // localStorage baru dibaca setelah mount.
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setSeen(readSeen());
    const onChange = () => setSeen(readSeen());
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return seen;
}
