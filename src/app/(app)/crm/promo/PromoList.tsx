import Link from "next/link";
import type { MultiSelectItem } from "@/components/SearchableMultiSelect";
import { promoCategorySummary } from "@/lib/promo-categories";
import { promoScheduleStatus, type PromoRow } from "@/lib/promo";
import { formatRentangTanggal, PROMO_STATUS_FILTERS, type PromoStatusFilter } from "@/lib/promo-list";
import { togglePromo } from "./actions";
import { salinPromoPaketDariDaftar, ubahStatusPaketDariDaftar } from "./paket/actions";
import { ringkasAturanPaket } from "@/lib/promo-paket";
import s from "./PromoList.module.css";

const STATUS_BADGE: Record<string, string> = { aktif: "g", terjadwal: "b", kadaluarsa: "x", nonaktif: "r" };
const STATUS_LABEL: Record<string, string> = { aktif: "Aktif hari ini", terjadwal: "Terjadwal", kadaluarsa: "Kadaluarsa", nonaktif: "Nonaktif" };

// Dua kelas promo yang paling sering disalahpahami pemilik toko. Warnanya
// sengaja beda jauh: hijau = uang benar-benar berkurang sendiri di kasir,
// oranye = tidak ada potongan sampai kodenya diketik.
const POTONG_BADGE: Record<string, string> = { ya: "g", tidak: "o" };
const POTONG_LABEL: Record<string, string> = { ya: "Potong otomatis", tidak: "Pengingat saja — tidak memotong" };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Daftar barang dipotong supaya satu baris tabel tidak melebar tak terkendali.
function ringkasBarang(nama: string[] | undefined): string {
  if (!nama || nama.length === 0) return "Semua barang";
  if (nama.length <= 2) return nama.join(", ");
  return `${nama.slice(0, 2).join(", ")} +${nama.length - 2} lagi`;
}

// Aturan promo dalam satu kalimat pendek — supaya pemilik toko bisa baca sekilas
// tanpa membuka formulirnya.
function ringkasAturan(p: PromoRow, nameOf: (id: string) => string): string {
  // Promo Paket (Syarat → Hasil) tidak memakai kolom diskon lama; ringkasannya dibaca dari aturan tersimpan.
  if (p.rule?.discount_mode === "syarat_hasil") return ringkasAturanPaket(p.rule, nameOf);
  const bagian: string[] = [];
  if (p.discount_type && p.discount_value) {
    bagian.push(p.discount_type === "percent" ? `${p.discount_value}%` : p.rule?.discount_mode === "package_total" ? `${rp(p.discount_value)}/paket min ${p.min_qty}` : `${rp(p.discount_value)}/${p.rule?.unit ?? "satuan"}`);
  }
  if (p.rule?.unit) bagian.push(`satuan ${p.rule.unit}`);
  if (p.min_qty) bagian.push(`min ${p.min_qty}`);
  if (p.max_qty) bagian.push(`maks ${p.max_qty}`);
  if (p.kelipatan) bagian.push("kelipatan");
  if (p.rule?.min_subtotal) bagian.push(`belanja ${rp(p.rule.min_subtotal)}`);
  return bagian.length ? bagian.join(" · ") : "—";
}

export function promoListHref(status: PromoStatusFilter, q: string, kategori: string, cabang = ""): string {
  const p = new URLSearchParams({ status });
  if (q) p.set("q", q);
  if (kategori) p.set("kategori", kategori);
  if (cabang) p.set("cabang", cabang);
  return `/crm/promo?${p.toString()}`;
}

export function PromoList({ rows, total, counts, status, q, kategori, cabang, today, canEdit, targetsByPromo, itemById, branchName, emptyMessage }: {
  rows: PromoRow[]; total: number; counts: Record<PromoStatusFilter, number>; status: PromoStatusFilter; q: string; kategori: string; cabang: string; today: string;
  canEdit: boolean; targetsByPromo: Map<string, string[]>; itemById: Map<string, MultiSelectItem>; branchName: Map<string, string>; emptyMessage: string;
}) {
  return (
    <>
      <div className={s.bar}>
        <nav aria-label="Filter status promo" className={s.chips}>
          {PROMO_STATUS_FILTERS.map(f => (
            <Link key={f.key} href={promoListHref(f.key, q, kategori, cabang)} className={s.chip} aria-current={status === f.key ? "page" : undefined}>{f.label} ({counts[f.key]})</Link>
          ))}
        </nav>
        <form method="get" role="search" className={s.search}>
          <input type="hidden" name="status" value={status} />
          {kategori && <input type="hidden" name="kategori" value={kategori} />}
          {cabang && <input type="hidden" name="cabang" value={cabang} />}
          <input className="fi" type="search" name="q" defaultValue={q} aria-label="Cari promo" placeholder="Cari nama promo / barang" maxLength={100} />
          <button type="submit" className="btn-def">Cari</button>
          {q && <Link className="back-btn" href={promoListHref(status, "", kategori, cabang)}>Hapus pencarian</Link>}
        </form>
      </div>
      <p className={s.count} aria-live="polite">Menampilkan {rows.length} dari {total} promo</p>
      <div className={s.wrap}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Nama</th><th>Cara potong</th><th>Berlaku untuk</th><th>Aturan</th><th>Cabang</th>
              <th>Tanggal</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const st = promoScheduleStatus(p, today);
              const targets = targetsByPromo.get(p.id) ?? [];
              const namaBarang = targets.map(id => itemById.get(id)?.name ?? "Barang tidak tersedia");
              const barang = ringkasBarang(targets.length ? namaBarang : undefined);
              const barangPenuh = targets.length ? namaBarang.join(", ") : "Semua barang";
              const kategoriTeks = promoCategorySummary(targets, itemById).join(", ");
              const cabang = !p.branch_ids || p.branch_ids.length === 0 ? "Semua cabang" : p.branch_ids.map((id) => branchName.get(id) ?? "—").join(", ");
              const paket = p.rule?.discount_mode === "syarat_hasil";
              const aturan = ringkasAturan(p, (id) => itemById.get(id)?.name ?? "Barang tidak tersedia");
              const potong = p.auto_apply ? "ya" : "tidak";
              return (
                <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 500 }}>
                    <span className={`${s.cell} ${s.nowrap}`} style={{ display: "block" }} title={p.name}>{p.name}</span>
                    <span className={s.sub} style={{ textTransform: "capitalize" }}>{paket ? "Promo Paket" : p.promo_type.replace("_", " ")}</span>
                  </td>
                  <td className={s.nowrap}><span className={`bge ${POTONG_BADGE[potong]}`}>{POTONG_LABEL[potong]}</span></td>
                  <td style={{ fontSize: 11 }}>
                    <span className={s.cell} style={{ display: "block" }} title={barangPenuh}>{barang}</span>
                    <span className={`${s.cell} ${s.sub}`} title={kategoriTeks}>{kategoriTeks}</span>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}><span className={s.cell} style={{ display: "block", maxWidth: 200 }} title={aturan}>{aturan}</span></td>
                  <td style={{ fontSize: 11 }}><span className={s.cell} style={{ display: "block", maxWidth: 140 }} title={cabang}>{cabang}</span></td>
                  <td className={s.nowrap} style={{ fontSize: 11 }}>{formatRentangTanggal(p.valid_from, p.valid_until)}</td>
                  <td className={s.nowrap}><span className={`bge ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span></td>
                  <td>
                    <div className={s.actions}>
                      {canEdit && <Link className="back-btn" href={paket ? `/crm/promo/paket/${p.id}` : `/crm/promo/${p.id}/edit`}>Edit promo</Link>}
                      <form action={paket ? ubahStatusPaketDariDaftar : togglePromo}>
                        <input type="hidden" name="id" value={p.id} />
                        {paket && <input type="hidden" name="was" value={p.is_active ? "1" : "0"} />}
                        <input type="hidden" name="active" value={p.is_active ? "0" : "1"} />
                        <button type="submit" className="btn-def" style={{ padding: "3px 10px", fontSize: 10 }}>
                          {p.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>
                      {paket && canEdit && (
                        <form action={salinPromoPaketDariDaftar}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className="btn-def" style={{ padding: "3px 10px", fontSize: 10 }} title="Buat salinan promo ini sebagai draf baru (nonaktif)">Salin promo</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
