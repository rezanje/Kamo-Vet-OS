"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { PelangganDasar } from "@/lib/pelanggan-cari";
import { muatPelanggan, useCariPelanggan } from "@/components/useCariPelanggan";

/**
 * Pemilih pelanggan dengan cari-sambil-mengetik di server. Menggantikan <select> berisi
 * SEMUA pelanggan (10.000+ baris dikirim tiap buka form → layar lambat).
 *
 * Nilai yang dikirim ke server tetap `customer_id` (input tersembunyi), jadi aksi
 * server tidak berubah. Input tersembunyi ikut draf transaksi (`data-draft-state`);
 * saat draf dipulihkan namanya dimuat ulang dari server.
 */
export function PelangganPicker({
  name = "customer_id", id, required = false, initial = null, kecuali, placeholder = "Ketik nama / no. HP pelanggan…",
  kosongLabel, onPilih,
}: {
  name?: string;
  id?: string;
  required?: boolean;
  /** Pelanggan yang sudah terpilih saat form dibuka (mis. saat mengedit). */
  initial?: PelangganDasar | null;
  /** Id pelanggan yang tidak boleh dipilih (mis. pemilik lama saat transfer anabul). */
  kecuali?: string;
  placeholder?: string;
  /** Teks bantuan bila boleh kosong, mis. "Kosongkan untuk siapa pun". */
  kosongLabel?: string;
  onPilih?: (pelanggan: PelangganDasar | null) => void;
}) {
  const [pilihan, setPilihan] = useState<PelangganDasar | null>(initial);
  const [teks, setTeks] = useState(initial ? label(initial) : "");
  const [buka, setBuka] = useState(false);
  const [aktif, setAktif] = useState(0);
  const [pesan, setPesan] = useState("");
  const hidden = useRef<HTMLInputElement>(null);
  const visible = useRef<HTMLInputElement>(null);
  const kotak = useRef<HTMLDivElement>(null);
  const listId = useId();
  const onPilihRef = useRef(onPilih);
  useEffect(() => { onPilihRef.current = onPilih; });

  const cari = useCariPelanggan(teks, !pilihan);
  const hits = cari.hits.filter((p) => p.id !== kecuali);

  const pilih = (p: PelangganDasar | null, teksBaru = p ? label(p) : "") => {
    setPilihan(p); setTeks(teksBaru); setBuka(false); setAktif(0); setPesan("");
    onPilihRef.current?.(p);
  };

  // Beri tahu draf transaksi & listener form bahwa nilai customer_id berubah.
  const idTerpilih = pilihan?.id ?? "";
  const awal = useRef(true);
  useEffect(() => {
    if (awal.current) { awal.current = false; return; }
    hidden.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [idTerpilih]);

  // Wajib diisi: browser menolak kirim form sampai pelanggan dipilih dari daftar.
  useEffect(() => {
    visible.current?.setCustomValidity(required && !pilihan ? "Pilih pelanggan dari daftar hasil cari." : "");
  }, [required, pilihan]);

  useEffect(() => {
    const input = hidden.current;
    const form = input?.closest("form");
    if (!input) return;
    let req = 0;
    const restore = (event: Event) => {
      const idDraf = String((event as CustomEvent<string>).detail ?? "");
      const nomor = ++req;
      if (!idDraf) { pilih(null); return; }
      setPilihan({ id: idDraf, name: "", phone: "" }); setTeks("Memuat pelanggan…");
      muatPelanggan(idDraf).then((p) => {
        if (nomor !== req) return;
        if (p) pilih(p);
        else { pilih(null); setPesan("Pelanggan pada draf tidak ditemukan. Pilih ulang."); }
      }).catch(() => {
        if (nomor !== req) return;
        pilih(null); setPesan("Pelanggan pada draf gagal dimuat. Pilih ulang.");
      });
    };
    const reset = (event: Event) => { queueMicrotask(() => { if (!event.defaultPrevented) pilih(initial); }); };
    input.addEventListener("vetos:draft-restore", restore);
    form?.addEventListener("reset", reset);
    return () => { req++; input.removeEventListener("vetos:draft-restore", restore); form?.removeEventListener("reset", reset); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pasang sekali; `initial` hanya nilai awal.
  }, []);

  useEffect(() => {
    const tutup = (e: MouseEvent) => { if (kotak.current && !kotak.current.contains(e.target as Node)) setBuka(false); };
    document.addEventListener("mousedown", tutup);
    return () => document.removeEventListener("mousedown", tutup);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!buka || hits.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setAktif((i) => (i + 1) % hits.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAktif((i) => (i - 1 + hits.length) % hits.length); }
    else if (e.key === "Enter") { e.preventDefault(); pilih(hits[Math.min(aktif, hits.length - 1)]); }
    else if (e.key === "Escape") setBuka(false);
  };

  const status = pilihan ? null
    : cari.terlaluPendek ? "Ketik minimal 2 huruf/angka."
      : cari.memuat ? "Mencari…"
        : cari.gagal ? cari.gagal
          : teks.trim() && hits.length === 0 ? "Pelanggan tidak ditemukan."
            : null;

  return (
    <div ref={kotak} style={{ position: "relative" }}>
      <input type="hidden" ref={hidden} name={name} value={idTerpilih} data-draft-state="" />
      <input
        ref={visible} id={id} className="fi" role="combobox" aria-controls={listId} aria-expanded={buka && hits.length > 0} aria-autocomplete="list"
        autoComplete="off" data-draft-ignore="" required={required} placeholder={placeholder} value={teks}
        onChange={(e) => { if (pilihan) onPilihRef.current?.(null); setPilihan(null); setTeks(e.target.value); setBuka(true); setAktif(0); setPesan(""); }}
        onFocus={() => setBuka(true)} onKeyDown={onKeyDown}
        style={pilihan ? { paddingRight: 26 } : undefined}
      />
      {pilihan && (
        <button type="button" aria-label="Hapus pilihan pelanggan" onClick={() => { pilih(null); visible.current?.focus(); }}
          style={{ position: "absolute", right: 6, top: 6, border: 0, background: "transparent", cursor: "pointer", color: "var(--td)" }}>
          <i className="ti ti-x" />
        </button>
      )}
      {buka && !pilihan && hits.length > 0 && (
        <div role="listbox" id={listId} style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, background: "#fff", border: ".5px solid var(--bd)", borderRadius: 7, marginTop: 3, boxShadow: "0 4px 12px rgba(0,0,0,.12)", maxHeight: 260, overflowY: "auto" }}>
          {hits.map((p, i) => (
            <div key={p.id} role="option" aria-selected={i === aktif}
              onMouseDown={(e) => { e.preventDefault(); pilih(p); }} onMouseEnter={() => setAktif(i)}
              style={{ padding: "7px 10px", cursor: "pointer", fontSize: 11.5, borderBottom: ".5px solid var(--bd)", background: i === aktif ? "var(--bg2, #f5f5f4)" : undefined }}>
              {p.name} <span style={{ color: "var(--td)" }}>· {p.phone}</span>
            </div>
          ))}
        </div>
      )}
      {(pesan || status) && <div role="status" style={{ fontSize: 10.5, color: "var(--td)", marginTop: 4 }}>{pesan || status}</div>}
      {!pesan && !status && !pilihan && kosongLabel && <div style={{ fontSize: 10.5, color: "var(--td)", marginTop: 4 }}>{kosongLabel}</div>}
    </div>
  );
}

function label(p: PelangganDasar) {
  return p.phone ? `${p.name} · ${p.phone}` : p.name;
}
