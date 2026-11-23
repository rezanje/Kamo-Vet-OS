"use client";

// Cabang penerima uang + rekening "Masuk ke" pada Penerimaan faktur grosir (permintaan Anisa via Reza, 23 Nov 2026:
// "penerimaan penjualan, harus ada cabang. karena kas nya per cabang").
//
// Bawaan = cabang faktur (perilaku lama). Rekening yang ditawarkan hanya yang tanpa cabang (mis. bank) atau milik
// cabang terpilih (mis. Kas Toko cabang itu), jadi tidak bisa salah pasang. Bila cabang ≠ cabang faktur, uang dicatat
// di kas cabang terpilih dan piutang tetap lunas di cabang faktur (server menjurnal lewat Rekening Antar Cabang).
import { useEffect, useRef, useState } from "react";
import { labelRekening, type RekeningOpsi } from "@/components/PilihRekening";

const KELOMPOK = ["Kas", "Bank"] as const;

/** Rekening yang boleh dipakai di cabang ini: tanpa cabang, atau milik cabang ini. */
export function rekeningUntukCabang(rekening: RekeningOpsi[], cabang: string) {
  return rekening.filter((r) => !r.branch_id || r.branch_id === cabang);
}

/** Select terkendali yang ikut dipulihkan dari draf transaksi (TransactionDraft memicu vetos:draft-restore). */
function useDraftRestore(onRestore: (value: string) => void) {
  const ref = useRef<HTMLSelectElement>(null);
  const latest = useRef(onRestore);
  useEffect(() => { latest.current = onRestore; });
  useEffect(() => {
    const el = ref.current;
    const restore = (event: Event) => latest.current(String((event as CustomEvent).detail ?? ""));
    el?.addEventListener("vetos:draft-restore", restore);
    return () => el?.removeEventListener("vetos:draft-restore", restore);
  }, []);
  return ref;
}

export function CabangPenerimaan({
  rekening, cabang, cabangFaktur, namaCabangFaktur,
}: {
  rekening: RekeningOpsi[];
  cabang: { id: string; name: string }[];
  cabangFaktur: string | null;
  namaCabangFaktur: string;
}) {
  const asal = cabangFaktur ?? "";
  const [terpilih, setTerpilih] = useState(asal);
  const [akun, setAkun] = useState("");
  const cocok = rekeningUntukCabang(rekening, terpilih);
  const gantiCabang = (value: string) => {
    setTerpilih(value);
    // Rekening milik cabang lain tidak berlaku lagi → kembali ke peta rekening cabang baru.
    if (akun && !rekeningUntukCabang(rekening, value).some((r) => r.id === akun)) setAkun("");
  };
  const refCabang = useDraftRestore(gantiCabang);
  const refAkun = useDraftRestore(setAkun);
  const opsi = (rs: RekeningOpsi[]) => rs.map((r) => <option key={r.id} value={r.id}>{labelRekening(r)}</option>);
  const berkelompok = cocok.some((r) => r.jenis);
  const lain = cocok.filter((r) => !KELOMPOK.includes(r.jenis as (typeof KELOMPOK)[number]));
  const namaTerpilih = cabang.find((b) => b.id === terpilih)?.name ?? (terpilih === asal ? namaCabangFaktur : "cabang terpilih");
  return (
    <>
      <input type="hidden" name="invoice_branch_id" value={asal} />
      <div>
        <label className="flab">Cabang (kas penerima)</label>
        <select ref={refCabang} className="fi" name="branch_id" value={terpilih} data-draft-state="" style={{ width: 170 }}
          onChange={(e) => gantiCabang(e.target.value)}>
          {!asal && <option value="">— Pusat / tanpa cabang —</option>}
          {asal && !cabang.some((b) => b.id === asal) && <option value={asal}>{namaCabangFaktur} (cabang faktur)</option>}
          {cabang.map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === asal ? " (cabang faktur)" : ""}</option>)}
        </select>
      </div>
      {rekening.length > 0 && (
        <div>
          <label className="flab">Masuk ke</label>
          <select ref={refAkun} className="fi" name="account_id" value={akun} data-draft-state="" style={{ width: 260 }}
            onChange={(e) => setAkun(e.target.value)}>
            <option value="">— ikut peta cabang —</option>
            {berkelompok ? <>
              {KELOMPOK.map((k) => {
                const isi = cocok.filter((r) => r.jenis === k);
                return isi.length > 0 && <optgroup key={k} label={k}>{opsi(isi)}</optgroup>;
              })}
              {opsi(lain)}
            </> : opsi(cocok)}
          </select>
        </div>
      )}
      {terpilih !== asal && (
        <small style={{ flexBasis: "100%", color: "var(--tm)", fontSize: 10.5 }}>
          Uang dicatat masuk ke kas {namaTerpilih}; tagihan tetap lunas di {namaCabangFaktur}.
        </small>
      )}
    </>
  );
}
