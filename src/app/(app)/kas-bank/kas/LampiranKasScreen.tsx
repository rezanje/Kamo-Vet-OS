import Link from "next/link";
import { notFound } from "next/navigation";
import { assertRole } from "@/lib/master-guard";
import { DokumenPanel } from "@/components/dokumen/DokumenPanel";

// Lampiran Kas Masuk / Kas Keluar / Transfer yang SUDAH tersimpan: lihat, tambah, hapus.
// Permintaan klinik 12 Nov 2026 ("edit lampiran"). Hak: OWNER/ADMIN/FINANCE, sama dengan hak edit.
// Lampiran tidak mengubah jurnal, jadi boleh juga untuk catatan yang sudah dibatalkan (bukti tetap tersimpan).

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const fmtTgl = (d: string) =>
  new Date(d).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });

export type JenisLampiran = "Masuk" | "Keluar" | "Transfer";

const DAFTAR: Record<JenisLampiran, { href: string; judul: string }> = {
  Masuk: { href: "/kas-bank/kas-masuk", judul: "Kas Masuk" },
  Keluar: { href: "/kas-bank/kas-keluar", judul: "Kas Keluar" },
  Transfer: { href: "/kas-bank/transfer", judul: "Transfer Kas" },
};

export async function LampiranKasScreen({ jenis, params }: { jenis: JenisLampiran; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const daftar = DAFTAR[jenis];
  const supabase = await assertRole(daftar.href, "lampiran", ["OWNER", "ADMIN", "FINANCE"]);
  if (!UUID.test(id)) notFound();
  const kembali = `${daftar.href}/lampiran/${id}`;

  let info: { no: string; tanggal: string; rincian: string; jumlah: number; dibatalkan: boolean } | null = null;
  if (jenis === "Transfer") {
    const { data } = await supabase.from("cash_transfers")
      .select("no_transfer, tanggal, jumlah, voided_at, from:from_account_id(nama), to:to_account_id(nama)")
      .eq("id", id).maybeSingle();
    const t = data as unknown as { no_transfer: string; tanggal: string; jumlah: number; voided_at: string | null; from: Rel<{ nama: string }>; to: Rel<{ nama: string }> } | null;
    if (t) info = { no: t.no_transfer, tanggal: t.tanggal, rincian: `${one(t.from)?.nama ?? "—"} → ${one(t.to)?.nama ?? "—"}`, jumlah: Number(t.jumlah), dibatalkan: !!t.voided_at };
  } else {
    const { data } = await supabase.from("cash_entries")
      .select("no_bukti, tanggal, jumlah, keterangan, voided_at, rekening:account_id(nama)")
      .eq("id", id).eq("jenis", jenis).maybeSingle();
    const k = data as unknown as { no_bukti: string; tanggal: string; jumlah: number; keterangan: string | null; voided_at: string | null; rekening: Rel<{ nama: string }> } | null;
    if (k) info = { no: k.no_bukti, tanggal: k.tanggal, rincian: [one(k.rekening)?.nama, k.keterangan].filter(Boolean).join(" · ") || "—", jumlah: Number(k.jumlah), dibatalkan: !!k.voided_at };
  }
  if (!info) notFound();

  return (
    <>
      <div style={{ marginBottom: 4 }}>
        <Link href={daftar.href} className="back-btn"><i className="ti ti-arrow-left" /> Kembali ke {daftar.judul}</Link>
      </div>
      <div className="pg-hd">Lampiran {daftar.judul} {info.no}</div>
      <div className="pg-sub">
        {fmtTgl(info.tanggal)} · {info.rincian} · {rp(info.jumlah)}{info.dibatalkan ? " · Dibatalkan" : ""}
      </div>
      <DokumenPanel modul={jenis === "Transfer" ? "transfer" : "pengeluaran"} refId={id} kembali={kembali} judul="LAMPIRAN / BUKTI" />
    </>
  );
}
