// Pilihan rekening kas/bank untuk layar keuangan. Dikosongkan = ikut Peta Rekening
// Pembayaran (pengaturan sekali di Kas & Bank), jadi orang keuangan cuma perlu
// menyentuhnya kalau transaksinya menyimpang dari kebiasaan.
//
// Tiap pilihan menampilkan kode akun + nama + no. rekening supaya enam rekening BCA
// tidak terbaca sama ("Bank BCA" saja tidak cukup — permintaan Reza 12 Nov 2026).
export type RekeningOpsi = {
  id: string; nama: string; coa_code: string;
  jenis?: string | null; no_rekening?: string | null;
};

/** "120002 · Bank BCA Transaksi (4270086743)"; no. rekening ditambah bila belum ada di nama. */
export function labelRekening(r: RekeningOpsi): string {
  const no = (r.no_rekening ?? "").trim();
  const tambahNo = no && !r.nama.includes(no) ? ` · ${no}` : "";
  return `${r.coa_code} · ${r.nama}${tambahNo}`;
}

const KELOMPOK = ["Kas", "Bank"] as const;

export function PilihRekening({
  rekening, label = "Rekening", width = 160, name = "account_id",
}: {
  rekening: RekeningOpsi[];
  label?: string;
  width?: number;
  name?: string;
}) {
  if (rekening.length === 0) return null;
  const opsi = (rs: RekeningOpsi[]) => rs.map((r) => <option key={r.id} value={r.id}>{labelRekening(r)}</option>);
  // Dikelompokkan Kas / Bank bila jenisnya diketahui; sisanya (jenis tak dikenal) di bawah.
  const berkelompok = rekening.some((r) => r.jenis);
  const lain = rekening.filter((r) => !KELOMPOK.includes(r.jenis as (typeof KELOMPOK)[number]));
  return (
    <div>
      <label className="flab">{label}</label>
      <select className="fi" name={name} defaultValue="" style={{ width }}>
        <option value="">— ikut peta —</option>
        {berkelompok ? <>
          {KELOMPOK.map((k) => {
            const isi = rekening.filter((r) => r.jenis === k);
            return isi.length > 0 && <optgroup key={k} label={k}>{opsi(isi)}</optgroup>;
          })}
          {opsi(lain)}
        </> : opsi(rekening)}
      </select>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadRekeningAktif(supabase: any): Promise<RekeningOpsi[]> {
  const { data } = await supabase
    .from("cash_accounts").select("id, nama, coa_code, jenis, no_rekening")
    .eq("is_active", true).order("jenis").order("coa_code").order("nama");
  return (data ?? []) as RekeningOpsi[];
}
