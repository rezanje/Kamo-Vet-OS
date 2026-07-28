"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  HOME_TAB, closeTab, nextActive, openTab, tabLabel, type PageTab,
} from "@/lib/tabs";

const STORE_KEY = "vetos.tabs";
const EMPTY: PageTab[] = [];

// ponytail: store kecil di luar React. Daftar tab hidup di sessionStorage,
// jadi useSyncExternalStore adalah alatnya — bukan useState + useEffect
// (yang kena aturan react-hooks/set-state-in-effect dan bikin render bertingkat).
let store: PageTab[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function read(): PageTab[] {
  if (loaded || typeof window === "undefined") return store;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (raw) store = JSON.parse(raw) as PageTab[];
  } catch {
    // storage penuh / diblokir — jalan tanpa tab tersimpan.
  }
  return store;
}

function write(next: PageTab[]) {
  if (next === store) return;
  store = next;
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // abaikan
  }
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// Server tidak punya sessionStorage → snapshot kosong yang stabil.
const serverSnapshot = () => EMPTY;

// Tab halaman ala Accurate. Halaman yang dibuka nempel jadi tab supaya bisa
// gonta-ganti tanpa balik ke sidebar. Umur tab = satu sesi tab browser.
export function PageTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = useSyncExternalStore(subscribe, read, serverSnapshot);

  // Sinkronisasi ke sistem luar (sessionStorage) — memang tugasnya effect.
  useEffect(() => {
    write(openTab(read(), { href: pathname, label: tabLabel(pathname) }));
  }, [pathname]);

  function handleClose(e: React.MouseEvent, href: string) {
    e.preventDefault();
    e.stopPropagation();
    const target = pathname === href ? nextActive(tabs, href) : null;
    write(closeTab(tabs, href));
    if (target) router.push(target);
  }

  const all = [HOME_TAB, ...tabs.filter((t) => t.href !== HOME_TAB.href)];

  return (
    <div className="ptabs no-print">
      {all.map((t) => {
        const on = pathname === t.href;
        return (
          <div key={t.href} className={`ptab${on ? " on" : ""}`}>
            {/* Link beneran biar bisa keyboard & ctrl+klik buka tab browser baru. */}
            <Link href={t.href} className="ptab-l" title={t.href}>
              {t.label}
            </Link>
            {t.href !== HOME_TAB.href && (
              <button
                type="button"
                className="ptab-x"
                aria-label={`Tutup ${t.label}`}
                onClick={(e) => handleClose(e, t.href)}
              >
                <i className="ti ti-x" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
