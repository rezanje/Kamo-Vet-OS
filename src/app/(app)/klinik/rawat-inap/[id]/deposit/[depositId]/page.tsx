import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "@/app/(app)/klinik/pembayaran/[visitId]/PrintButton";
import { jurnalDepositMasuk, sisaDeposit } from "@/lib/deposit-ranap";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

/**
 * Bukti terima deposit rawat inap — struk 80mm, gaya sama dengan struk klinik.
 *
 * Ini BUKAN kuitansi pembayaran tagihan: yang tercetak adalah uang titipan yang
 * akan memotong tagihan saat pasien pulang. Kalimat itu sengaja dicetak supaya
 * pemilik tidak mengira tagihannya sudah lunas.
 */
export default async function BuktiDepositPage({
  params,
}: { params: Promise<{ id: string; depositId: string }> }) {
  const { id, depositId } = await params;
  const supabase = await createClient();

  const { data: deposit, error } = await supabase
    .from("inpatient_deposits")
    .select("id, no_deposit, tanggal, jumlah, terpakai, dikembalikan, metode, kas_code, catatan, status, created_at, inpatient_record_id, visit_id")
    .eq("id", depositId).maybeSingle();
  if (error) throw new Error("Bukti deposit belum dapat dibaca. Muat ulang sebelum mencetak.");
  if (!deposit || deposit.inpatient_record_id !== id) notFound();

  const { data: rec } = await supabase
    .from("inpatient_records")
    .select("id, admitted_at, doctor_name, branches(name, code), visits(pets(name, species), customers(name, phone))")
    .eq("id", id).maybeSingle();
  if (!rec) notFound();
  const branch = one(rec.branches as Rel<{ name: string; code: string }>);
  const visit = one(rec.visits as Rel<{ pets: Rel<{ name: string; species: string | null }>; customers: Rel<{ name: string; phone: string | null }> }>);
  const pet = one(visit?.pets ?? null);
  const cust = one(visit?.customers ?? null);

  const jumlah = Number(deposit.jumlah) || 0;
  const sisa = sisaDeposit(deposit as { jumlah: number; terpakai: number; dikembalikan: number; status: string });
  const jurnal = jurnalDepositMasuk(String(deposit.kas_code), jumlah);
  const waktu = new Date(deposit.created_at as string).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <>
      <style>{`@media print { @page { size: 80mm auto; margin: 3mm; } }`}</style>

      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <Link href={`/klinik/rawat-inap/${id}`} className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <PrintButton label="Cetak Bukti" />
      </div>

      <div style={{ maxWidth: 320, margin: "0 auto", background: "#fff", border: ".5px solid var(--bd)", borderRadius: 8, padding: 16, fontSize: 11.5, lineHeight: 1.5 }}>
        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>{branch?.name ?? "KAMO Vet"}</div>
          <div style={{ fontSize: 10.5, color: "var(--tm)" }}>BUKTI TERIMA DEPOSIT RAWAT INAP</div>
        </div>
        <div style={{ borderTop: "1px dashed var(--bd)", borderBottom: "1px dashed var(--bd)", padding: "8px 0" }}>
          <Baris label="No. Deposit" value={String(deposit.no_deposit)} />
          <Baris label="Tanggal" value={waktu} />
          <Baris label="Pemilik" value={cust?.name ?? "—"} />
          <Baris label="Pasien" value={`${pet?.name ?? "—"}${pet?.species ? ` (${pet.species})` : ""}`} />
          <Baris label="Metode" value={String(deposit.metode)} />
          {deposit.catatan && <Baris label="Catatan" value={String(deposit.catatan)} />}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14, fontWeight: 800 }}>
          <span>DITERIMA</span><span>{rp(jumlah)}</span>
        </div>
        {deposit.status === "batal" ? (
          <div style={{ textAlign: "center", fontWeight: 700, color: "#b91c1c" }}>DEPOSIT INI SUDAH DIBATALKAN</div>
        ) : (
          <div style={{ borderTop: "1px dashed var(--bd)", paddingTop: 8 }}>
            <Baris label="Sudah terpakai" value={rp(Number(deposit.terpakai) || 0)} />
            {Number(deposit.dikembalikan) > 0 && <Baris label="Dikembalikan" value={rp(Number(deposit.dikembalikan))} />}
            <Baris label="Sisa titipan" value={rp(sisa)} />
          </div>
        )}
        <p style={{ fontSize: 10, color: "var(--tm)", marginTop: 10, textAlign: "center" }}>
          Ini bukti titipan uang, bukan bukti pelunasan tagihan. Sisa titipan otomatis
          memotong tagihan saat pasien pulang; kelebihannya dikembalikan.
        </p>
        <p className="no-print" style={{ fontSize: 10, color: "var(--td)", marginTop: 8 }}>
          Pembukuan: {jurnal.map((l) => `${l.debit > 0 ? "Debit" : "Kredit"} ${l.code} ${rp(l.debit || l.credit)}`).join(" · ")}
        </p>
      </div>
    </>
  );
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "var(--tm)" }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}
