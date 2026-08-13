"use client";

// Pencarian global di topbar: satu kotak untuk menu maupun data.
//
// Menu dicocokkan di layar (daftarnya statis & kecil, jadi hasilnya muncul saat
// mengetik tanpa menunggu server). Data ditanya ke /api/cari dengan jeda —
// mengetik 8 huruf tidak boleh jadi 8 permintaan ke database.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cariMenu, LABEL_JENIS, type HasilData, type HasilMenu } from "@/lib/cari-global";
import type { AturanTersimpan } from "@/lib/akses";

type Baris =
  | { tipe: "menu"; menu: HasilMenu }
  | { tipe: "data"; data: HasilData };

export function CariGlobal({ role, aturan }: { role: string; aturan: AturanTersimpan }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [buka, setBuka] = useState(false);
  const [data, setData] = useState<HasilData[]>([]);
  const [memuat, setMemuat] = useState(false);
  const [aktif, setAktif] = useState(0);
  const kotak = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const panjangCukup = q.trim().length >= 2;
  const menu = useMemo(() => cariMenu(q, role, aturan), [q, role, aturan]);
  const baris: Baris[] = useMemo(() => [
    ...menu.map((m) => ({ tipe: "menu" as const, menu: m })),
    ...(panjangCukup ? data : []).map((d) => ({ tipe: "data" as const, data: d })),
  ], [menu, data, panjangCukup]);

  // Ctrl/Cmd+K di mana pun — pintasan yang sudah jadi kebiasaan orang.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
      if (e.key === "Escape") setBuka(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Klik di luar kotak menutup hasil.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (kotak.current && !kotak.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Data dicari setelah ketikan berhenti sejenak; permintaan lama dibatalkan
  // supaya hasil yang datang terlambat tidak menimpa hasil terbaru.
  useEffect(() => {
    const kueri = q.trim();
    if (kueri.length < 2) return;

    const batal = new AbortController();
    const jeda = setTimeout(async () => {
      setMemuat(true);
      try {
        const r = await fetch(`/api/cari?q=${encodeURIComponent(kueri)}`, { signal: batal.signal });
        const j = await r.json();
        setData((j.data ?? []) as HasilData[]);
      } catch {
        // dibatalkan atau jaringan putus — layar cukup menampilkan hasil menu.
      } finally {
        setMemuat(false);
      }
    }, 250);

    return () => { clearTimeout(jeda); batal.abort(); };
  }, [q]);

  const pergi = (b: Baris) => {
    setBuka(false);
    setQ("");
    router.push(b.tipe === "menu" ? b.menu.href : b.data.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!buka || baris.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAktif((i) => (i + 1) % baris.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setAktif((i) => (i - 1 + baris.length) % baris.length); }
    if (e.key === "Enter") { e.preventDefault(); pergi(baris[aktif]); }
  };

  return (
    <div ref={kotak} style={{ position: "relative", flex: 1, maxWidth: 420, margin: "0 12px" }}>
      <div style={{ position: "relative" }}>
        <i className="ti ti-search" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--td)" }} />
        <input
          ref={input}
          className="fi"
          value={q}
          placeholder="Cari menu, barang, pelanggan, nota…"
          onChange={(e) => {
            // Hasil lama dibuang saat ketikan berubah — kalau tidak, sekejap
            // terlihat hasil kata kunci sebelumnya di bawah kata kunci baru.
            setQ(e.target.value); setData([]); setAktif(0); setBuka(true);
          }}
          onFocus={() => setBuka(true)}
          onKeyDown={onKeyDown}
          style={{ paddingLeft: 28, paddingRight: 44, height: 28, fontSize: 11.5 }}
        />
        <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: "var(--td)", border: ".5px solid var(--bd)", borderRadius: 4, padding: "1px 4px" }}>
          ⌘K
        </span>
      </div>

      {buka && panjangCukup && (
        <div style={{
          position: "absolute", top: 34, left: 0, right: 0, zIndex: 60,
          background: "#fff", border: ".5px solid var(--bd)", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(15,23,42,.12)", maxHeight: 380, overflowY: "auto",
        }}>
          {baris.length === 0 ? (
            <div style={{ padding: "14px 12px", fontSize: 11, color: "var(--td)", textAlign: "center" }}>
              {memuat ? "Mencari…" : `Tidak ada yang cocok dengan "${q.trim()}".`}
            </div>
          ) : (
            <>
              {menu.length > 0 && <Judul teks="MENU" />}
              {baris.map((b, i) => {
                const sebelumnya = baris[i - 1];
                const mulaiData = b.tipe === "data" && (!sebelumnya || sebelumnya.tipe === "menu");
                const ikon = b.tipe === "menu" ? b.menu.icon : LABEL_JENIS[b.data.jenis].icon;
                const judul = b.tipe === "menu" ? b.menu.label : b.data.judul;
                const ket = b.tipe === "menu" ? b.menu.modulLabel : b.data.keterangan;
                const tag = b.tipe === "data" ? LABEL_JENIS[b.data.jenis].label : null;

                return (
                  <div key={`${b.tipe}-${i}`}>
                    {mulaiData && <Judul teks="DATA" />}
                    <button type="button"
                      onClick={() => pergi(b)}
                      onMouseEnter={() => setAktif(i)}
                      style={{
                        display: "flex", alignItems: "center", gap: 9, width: "100%",
                        padding: "7px 11px", border: "none", cursor: "pointer", textAlign: "left",
                        background: i === aktif ? "#eff4ff" : "#fff",
                      }}>
                      <i className={`ti ${ikon}`} style={{ fontSize: 15, color: "var(--tm)", flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{judul}</span>
                        <span style={{ display: "block", fontSize: 9.5, color: "var(--tm)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ket}</span>
                      </span>
                      {tag && <span className="bge b" style={{ fontSize: 8.5, flexShrink: 0 }}>{tag}</span>}
                    </button>
                  </div>
                );
              })}
              {memuat && (
                <div style={{ padding: "6px 11px", fontSize: 9.5, color: "var(--td)" }}>Mencari data…</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Judul({ teks }: { teks: string }) {
  return (
    <div style={{ padding: "6px 11px 3px", fontSize: 8.5, fontWeight: 700, letterSpacing: ".06em", color: "var(--td)", background: "#fafbfc" }}>
      {teks}
    </div>
  );
}
