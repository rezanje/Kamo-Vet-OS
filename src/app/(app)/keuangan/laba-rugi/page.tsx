import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { getAccountBalances } from "@/lib/ledger";
import { resolveUnitTypes } from "@/lib/laporan";
import { PeriodFilter } from "../PeriodFilter";
import { AkunGroup, PetunjukKlikAkun, bikinHrefAkun } from "../AkunGroup";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function LabaRugiPage({ searchParams }: { searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string }> }) {
  const { dari, sampai, cabang } = await searchParams;
  const supabase = await createClient();
  const { data: branches } = await supabase.from("branches").select("id, name, type").order("name");

  // preset unit:KLINIK / unit:PETSHOP → filter daftar cabang berdasarkan tipe (laporan Memorize Accurate)
  const unitTypes = resolveUnitTypes(cabang);
  const branchIds = unitTypes
    ? (branches ?? []).filter((b) => unitTypes.includes(b.type as string)).map((b) => b.id as string)
    : undefined;

  const balances = await getAccountBalances(supabase as never, {
    from: dari || undefined,
    to: sampai || undefined,
    branchId: unitTypes ? undefined : cabang || undefined,
    branchIds,
  });

  // Akun induk ikut dikirim ke tampilan supaya subtotalnya muncul, tapi TIDAK ikut
  // dijumlah — saldonya penjumlahan rinciannya, kalau ikut ditambah jadi dobel.
  const isi = (tipe: string) => balances.filter((b) => b.type === tipe && (b.saldo !== 0 || b.is_header));
  const totalDetail = (rows: typeof balances) =>
    rows.filter((b) => !b.is_header).reduce((a, b) => a + b.saldo, 0);

  const pendapatan = isi("PENDAPATAN");
  const beban = isi("BEBAN");

  const totalPendapatan = totalDetail(pendapatan);
  // HPP dikenali dari akun 5101 beserta rinciannya kalau nanti dipecah jadi sub-akun.
  const idHpp = new Set(balances.filter((b) => b.code === "5101").map((b) => b.id));
  const keturunanHpp = (b: (typeof balances)[number]) =>
    idHpp.has(b.id) || (!!b.parent_id && idHpp.has(b.parent_id));
  const barisHpp = beban.filter(keturunanHpp);
  const hpp = totalDetail(barisHpp);
  const bebanOperasional = beban.filter((b) => !keturunanHpp(b));
  const totalBebanOps = totalDetail(bebanOperasional);
  const labaKotor = totalPendapatan - hpp;
  const hrefAkun = bikinHrefAkun({ dari, sampai, cabang });
  const labaBersih = labaKotor - totalBebanOps;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Laporan Laba Rugi</span>
      </div>

      <div className="crm-sec">
        <SecHeader num="01" title="LABA RUGI" desc={dari || sampai ? `Periode ${dari || "awal"} s/d ${sampai || "sekarang"}.` : "Pendapatan dikurangi beban (seluruh periode)."} />
        <PeriodFilter basePath="/keuangan/laba-rugi" dari={dari} sampai={sampai} cabang={cabang} branches={branches ?? []} unitPresets />

        <PetunjukKlikAkun />

        <AkunGroup title="PENDAPATAN" rows={pendapatan} hrefAkun={hrefAkun} />
        <TotalRow label="Total Pendapatan" value={totalPendapatan} />

        <div style={{ height: 14 }} />
        <AkunGroup title="HARGA POKOK PENJUALAN" rows={barisHpp} hrefAkun={hrefAkun} />
        <SubRow label="Laba Kotor" value={labaKotor} strong />

        <div style={{ height: 14 }} />
        <AkunGroup title="BEBAN OPERASIONAL" rows={bebanOperasional} hrefAkun={hrefAkun} />
        <TotalRow label="Total Beban Operasional" value={totalBebanOps} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 12, borderTop: "2px solid #16213e" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>LABA BERSIH</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: labaBersih >= 0 ? "#15803d" : "#b91c1c" }}>{rp(labaBersih)}</span>
        </div>
      </div>
    </>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 12, fontWeight: 600 }}>
      <span>{label}</span><span>{rp(value)}</span>
    </div>
  );
}
function SubRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", marginTop: 4, borderTop: "1px solid var(--bd)", fontSize: 13, fontWeight: strong ? 700 : 500 }}>
      <span>{label}</span><span style={{ color: "var(--acc)" }}>{rp(value)}</span>
    </div>
  );
}
