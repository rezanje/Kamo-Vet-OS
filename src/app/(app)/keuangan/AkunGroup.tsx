// Baris akun laporan keuangan: bertingkat (induk–rincian) dan menautkan ke buku besar.
//
// Dipakai Laba Rugi & Neraca supaya pertanyaan "angka ini dari mana?" cukup satu
// klik — tautannya membawa periode & cabang yang sedang dilihat, jadi angka di
// laporan dan di buku besar dijamin sama.
//
// Akun induk tampil sebagai subtotal (tebal, tidak bisa diklik: dia tidak punya
// mutasi sendiri, angkanya penjumlahan rinciannya).

import Link from "next/link";
import { susunPohon, ratakan, saldoDenganRollup, type AkunPohon } from "@/lib/coa-pohon";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export type BarisAkun = AkunPohon & { saldo: number };

export function AkunGroup({ title, rows, hrefAkun }: {
  title?: string;
  rows: BarisAkun[];
  hrefAkun: (code: string) => string;
}) {
  const pohon = susunPohon(rows);
  const perId = new Map(rows.map((r) => [r.id, r.saldo]));
  const rollup = saldoDenganRollup(pohon, perId);

  // Akun bersaldo nol disembunyikan — termasuk induk yang seluruh rinciannya nol,
  // supaya laporan tidak penuh baris kosong.
  const tampil = ratakan(pohon).filter((s) => Math.round(rollup.get(s.akun.id) ?? 0) !== 0);

  return (
    <div>
      {title && (
        <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", margin: "4px 0 6px" }}>{title}</div>
      )}
      {tampil.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--td)", padding: "2px 0" }}>—</div>
      ) : (
        tampil.map(({ akun, level }) => {
          const nilai = rollup.get(akun.id) ?? 0;
          const gaya = {
            display: "flex", justifyContent: "space-between",
            padding: "5px 0", fontSize: 12, borderBottom: ".5px solid var(--bd)",
            paddingLeft: level * 14,
            fontWeight: akun.is_header ? 700 : 400,
          } as const;

          // Induk tidak ditautkan: buku besarnya kosong karena jurnal selalu
          // menempel di akun rinciannya.
          if (akun.is_header) {
            return (
              <div key={akun.id} style={{ ...gaya, background: "var(--sf1, #f8fafc)" }}>
                <span>
                  <span style={{ color: "var(--td)", fontFamily: "monospace", fontSize: 10, marginRight: 6 }}>{akun.code}</span>
                  {akun.name}
                </span>
                <span>{rp(nilai)}</span>
              </div>
            );
          }

          return (
            <Link key={akun.id} href={hrefAkun(akun.code)}
              title={`Lihat mutasi ${akun.code} ${akun.name} di buku besar`}
              style={{ ...gaya, color: "inherit", textDecoration: "none" }}>
              <span>
                <span style={{ color: "var(--td)", fontFamily: "monospace", fontSize: 10, marginRight: 6 }}>{akun.code}</span>
                <span style={{ borderBottom: "1px dotted var(--td)" }}>{akun.name}</span>
                <i className="ti ti-external-link" style={{ fontSize: 11, color: "var(--td)", marginLeft: 5 }} />
              </span>
              <span>{rp(nilai)}</span>
            </Link>
          );
        })
      )}
    </div>
  );
}

/** Petunjuk kecil di atas daftar akun — kalau tidak diberi tahu, orang tidak tahu barisnya bisa diklik. */
export function PetunjukKlikAkun() {
  return (
    <div style={{ fontSize: 10, color: "var(--tm)", marginBottom: 8 }}>
      <i className="ti ti-info-circle" /> Klik nama akun untuk melihat rincian mutasinya di buku besar.
      Baris tebal adalah akun induk (subtotal).
    </div>
  );
}

/** Tautan ke buku besar satu akun, membawa periode & cabang laporan. */
export function bikinHrefAkun(f: { dari?: string; sampai?: string; cabang?: string }) {
  return (code: string) => {
    const q = new URLSearchParams({ akun: code });
    if (f.dari) q.set("dari", f.dari);
    if (f.sampai) q.set("sampai", f.sampai);
    if (f.cabang) q.set("cabang", f.cabang);
    return `/keuangan/buku-besar?${q.toString()}`;
  };
}
