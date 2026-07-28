"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  HOME_TAB, closeTab, nextActive, openTab, tabLabel, type PageTab,
} from "@/lib/tabs";

const STORE_KEY = "vetos.tabs";

// Tab halaman ala Accurate. Halaman yang dibuka nempel jadi tab supaya bisa
// gonta-ganti tanpa balik ke sidebar. Umur tab = satu sesi tab browser.
export function PageTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const [tabs, setTabs] = useState<PageTab[]>([]);

  // sessionStorage cuma ada di browser → baca setelah hydrate.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) setTabs(JSON.parse(raw) as PageTab[]);
    } catch {
      // storage penuh / diblokir — jalan tanpa tab tersimpan.
    }
  }, []);

  useEffect(() => {
    setTabs((prev) => {
      const next = openTab(prev, { href: pathname, label: tabLabel(pathname) });
      if (next !== prev) {
        try {
          sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch {
          // abaikan
        }
      }
      return next;
    });
  }, [pathname]);

  function handleClose(e: React.MouseEvent, href: string) {
    e.preventDefault();
    e.stopPropagation();
    const target = pathname === href ? nextActive(tabs, href) : null;
    setTabs((prev) => {
      const next = closeTab(prev, href);
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        // abaikan
      }
      return next;
    });
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
