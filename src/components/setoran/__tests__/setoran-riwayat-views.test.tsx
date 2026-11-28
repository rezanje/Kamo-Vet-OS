// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { hitungRiwayat } from "@/lib/setoran-riwayat";
import type { BarisDaftar } from "@/lib/setoran";
import { RingkasanKartu, TabelHarian, TabelPeriode } from "../SetoranRiwayatTabel";

const html = (n: React.ReactElement) => renderToStaticMarkup(n);
const h = hitungRiwayat({
  dari: "2026-11-01", sampai: "2026-11-02",
  shifts: [{ closed_at: "2026-11-01T10:00:00Z", opening_balance: 0, closing_balance: 1000000 }],
  baris: [{ tanggal: "2026-11-01", source: "transfer", debit: 0, credit: 1200000 }, { tanggal: "2026-11-02", source: "purchase-pay", debit: 0, credit: 518000 }],
  saldoAwal: 100000,
});

it("tabel harian memuat kolom yang diminta dan angka per hari", () => {
  const t = html(<TabelHarian hari={h.hari} />);
  for (const k of ["Tanggal", "Kas fisik tutup shift", "Pengeluaran dari kas", "Harus disetor", "Sudah ditransfer", "Selisih setor harian", "Kelebihan / kekurangan setor (kumulatif)", "Saldo Buku Besar kas toko (akhir hari)", "Rp1.000.000", "Rp1.200.000", "Rp200.000"]) expect(t).toContain(k);
});

it("kartu ringkasan: kelebihan setor, saldo vs kas seharusnya, catatan pembelian/jurnal manual, uraian berjumlah sama dengan selisih", () => {
  const t = html(<RingkasanKartu r={h.ringkasan} namaAkun="Kas Toko CMGG" />);
  for (const k of ["Total harus disetor", "Total sudah ditransfer", "Kelebihan setor (kumulatif)", "Kas yang seharusnya ada", "Selisih (Buku Besar − seharusnya)", "Pembayaran pembelian dari kas toko", "Jurnal manual", "bukan bagian setoran", "Rp518.000"]) expect(t).toContain(k);
});

it("periode tercatat: tautan ke detail, diharapkan dari keuangan bila ada, kewajiban−pengeluaran bila Draft", () => {
  const dasar = { id: "i1", no_setoran: "STR-20261127-001", branch_id: "b", cabang: "CMGG", periode_mulai: "2026-11-27", periode_selesai: "2026-11-27", jadwal: "2026-11-30", batas_jam: "12:00", status: "Draft" as const, kewajiban: 1714500, pengeluaran: 0, transfer: 0, sisa: 1714500, transfer_menunggu: 0, umur_hari: null, badge: "Belum lunas", status_periode: "Aktif", terlambat: false, dibuat_oleh: "x" } satisfies BarisDaftar;
  const t = html(<TabelPeriode basis="/kas-bank/setoran" baris={[dasar, { ...dasar, id: "i2", no_setoran: "STR-2", status: "Disetujui", periode_selesai: "2026-11-29", diharapkan: 900000 }]} />);
  expect(t).toContain('href="/kas-bank/setoran/i1"'); expect(t).toContain("STR-20261127-001"); expect(t).toContain("Rp1.714.500"); expect(t).toContain("Rp900.000");
  expect(html(<TabelPeriode basis="/kas-bank/setoran" baris={[]} />)).toContain("Belum ada periode setoran tercatat");
});
