import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances, nilaiSeksi } from "@/lib/ledger";
import { PeriodFilter } from "../PeriodFilter";
import { AkunGroup, PetunjukKlikAkun, bikinHrefAkun } from "../AkunGroup";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function NeracaPage({ searchParams }: { searchParams: Promise<{ sampai?: string; cabang?: string }> }) {
  const { sampai, cabang } = await searchParams;
  const supabase = await createClient();
  const { data: branches } = await supabase.from("branches").select("id, name").order("name");
  // Neraca = posisi kumulatif s/d tanggal (bukan rentang) — laba berjalan ikut terpotong otomatis.
  const balances = await getAccountBalances(supabase as never, { to: sampai || undefined, branchId: cabang || undefined });

  // nilaiSeksi: akun kontra (mis. Akumulasi Penyusutan) otomatis jadi PENGURANG
  // kelompoknya, bukan penambah.
  const pakai = (b: (typeof balances)[number]) => ({ ...b, saldo: nilaiSeksi(b) });
  // Akun induk ikut dikirim supaya subtotalnya muncul, tapi tidak ikut dijumlah.
  const isi = (tipe: string) =>
    balances.filter((b) => b.type === tipe && (b.saldo !== 0 || b.is_header)).map(pakai);
  const totalDetail = (rows: { saldo: number; is_header: boolean }[]) =>
    rows.filter((b) => !b.is_header).reduce((a, b) => a + b.saldo, 0);

  const aset = isi("ASET");
  const liabilitas = isi("LIABILITAS");
  const ekuitas = isi("EKUITAS");
  const pendapatan = balances.filter((b) => b.type === "PENDAPATAN").reduce((a, b) => a + nilaiSeksi(b), 0);
  const beban = balances.filter((b) => b.type === "BEBAN").reduce((a, b) => a + nilaiSeksi(b), 0);
  const labaBerjalan = pendapatan - beban; // belum di-closing ke ekuitas

  const totalAset = totalDetail(aset);
  const totalLiabilitas = totalDetail(liabilitas);
  const totalEkuitas = totalDetail(ekuitas) + labaBerjalan;
  const totalPasiva = totalLiabilitas + totalEkuitas;
  const seimbang = Math.round(totalAset) === Math.round(totalPasiva);
  // Neraca posisi s/d tanggal — tautan buku besarnya ikut tanpa tanggal awal.
  const hrefAkun = bikinHrefAkun({ sampai, cabang });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Neraca</span>
      </div>

      <PeriodFilter basePath="/keuangan/neraca" sampai={sampai} cabang={cabang} branches={branches ?? []} tanggalOnly />

      <div className={`p2ban`} style={{ background: seimbang ? "#e8f5ee" : "#fef2f2", border: `.5px solid ${seimbang ? "#86efac" : "#fca5a5"}`, color: seimbang ? "#15803d" : "#b91c1c" }}>
        <i className={`ti ti-${seimbang ? "circle-check" : "alert-triangle"}`} /> {seimbang ? `Neraca seimbang — Aktiva = Pasiva = ${rp(totalAset)}` : "Neraca TIDAK seimbang — ada kesalahan posting!"}
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="01" title="AKTIVA" desc="Aset perusahaan." />
          <PetunjukKlikAkun />
          <AkunGroup rows={aset} hrefAkun={hrefAkun} />
          <TotalRow label="TOTAL AKTIVA" value={totalAset} />
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="PASIVA" desc="Liabilitas + Ekuitas." />
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", margin: "4px 0 6px" }}>LIABILITAS</div>
          <AkunGroup rows={liabilitas} hrefAkun={hrefAkun} />
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tm)", letterSpacing: ".06em", margin: "10px 0 6px" }}>EKUITAS</div>
          <AkunGroup rows={ekuitas} hrefAkun={hrefAkun} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12, borderBottom: ".5px solid var(--bd)", fontStyle: "italic", color: "var(--tm)" }}>
            <span>Laba berjalan (belum ditutup)</span><span>{rp(labaBerjalan)}</span>
          </div>
          <TotalRow label="TOTAL PASIVA" value={totalPasiva} />
        </div>
      </div>
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", marginTop: 6, borderTop: "2px solid #16213e", fontSize: 13, fontWeight: 700 }}>
      <span>{label}</span><span>{rp(value)}</span>
    </div>
  );
}
