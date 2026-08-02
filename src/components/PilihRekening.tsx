// Pilihan rekening kas/bank untuk layar keuangan. Dikosongkan = ikut Peta Rekening
// Pembayaran (pengaturan sekali di Kas & Bank), jadi orang keuangan cuma perlu
// menyentuhnya kalau transaksinya menyimpang dari kebiasaan.
export type RekeningOpsi = { id: string; nama: string; coa_code: string };

export function PilihRekening({
  rekening, label = "Rekening", width = 160, name = "account_id",
}: {
  rekening: RekeningOpsi[];
  label?: string;
  width?: number;
  name?: string;
}) {
  if (rekening.length === 0) return null;
  return (
    <div>
      <label className="flab">{label}</label>
      <select className="fi" name={name} defaultValue="" style={{ width }}>
        <option value="">— ikut peta —</option>
        {rekening.map((r) => <option key={r.id} value={r.id}>{r.nama}</option>)}
      </select>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRekeningAktif(supabase: any): Promise<RekeningOpsi[]> {
  const { data } = await supabase
    .from("cash_accounts").select("id, nama, coa_code").eq("is_active", true).order("jenis").order("nama");
  return (data ?? []) as RekeningOpsi[];
}
