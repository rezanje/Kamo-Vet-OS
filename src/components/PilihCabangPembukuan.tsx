import { TEKS_CABANG_PEMBUKUAN, type CabangPembukuan } from "@/lib/cabang-pembukuan";

/**
 * Pilihan "Cabang pembukuan" pada form bayar hutang. Bawaan = cabang faktur. Hanya tampil bila pemakai
 * punya lebih dari satu cabang yang bisa dipilih; kolom kosong berarti cabang faktur.
 */
export function PilihCabangPembukuan({ cabang, awal, id, width = 190 }: {
  cabang: CabangPembukuan[]; awal: string | null | undefined; id: string; width?: number;
}) {
  if (cabang.length < 2) return null;
  const awalId = awal && cabang.some((c) => c.id === awal) ? awal : "";
  return (
    <div style={{ flex: "1 1 210px" }}>
      <label className="flab" htmlFor={id}>Cabang pembukuan</label>
      <select className="fi" id={id} name="journal_branch_id" defaultValue={awalId} style={{ width }}>
        {awalId === "" && <option value="">Cabang faktur</option>}
        {cabang.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "var(--tm)" }}>{TEKS_CABANG_PEMBUKUAN}</p>
    </div>
  );
}
