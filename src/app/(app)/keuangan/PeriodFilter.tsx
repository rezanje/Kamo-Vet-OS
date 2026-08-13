// Filter periode + cabang untuk laporan keuangan — form GET biasa (tanpa JS).
import Link from "next/link";

type Branch = { id: string; name: string };

export function PeriodFilter({
  basePath, dari, sampai, cabang, branches, tanggalOnly, unitPresets, hidden,
}: {
  basePath: string;
  dari?: string;
  sampai?: string;
  cabang?: string;
  branches?: Branch[];
  tanggalOnly?: boolean; // neraca: hanya "per tanggal"
  unitPresets?: boolean; // laba-rugi: preset "Semua Klinik/Petshop" (nilai unit:*)
  /** Parameter lain yang harus ikut terbawa saat filter diterapkan (mis. akun
      yang sedang dibuka di buku besar — tanpa ini rinciannya tertutup sendiri). */
  hidden?: Record<string, string>;
}) {
  const aktif = dari || sampai || cabang;
  return (
    <form method="get" action={basePath} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {!tanggalOnly && (
        <div>
          <label className="flab">Dari tanggal</label>
          <input className="fi" type="date" name="dari" defaultValue={dari ?? ""} style={{ width: 140 }} />
        </div>
      )}
      <div>
        <label className="flab">{tanggalOnly ? "Per tanggal" : "Sampai tanggal"}</label>
        <input className="fi" type="date" name="sampai" defaultValue={sampai ?? ""} style={{ width: 140 }} />
      </div>
      {branches && (
        <div>
          <label className="flab">Cabang</label>
          <select className="fi" name="cabang" defaultValue={cabang ?? ""} style={{ width: 160 }}>
            <option value="">Semua cabang</option>
            {unitPresets && (
              <>
                <option value="unit:KLINIK">— Semua Klinik —</option>
                <option value="unit:PETSHOP">— Semua Petshop —</option>
                <option value="unit:ONLINE">— Cabang Online —</option>
              </>
            )}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      )}
      <button type="submit" className="btn-def" style={{ padding: "7px 14px", fontSize: 11 }}>
        <i className="ti ti-filter" /> Terapkan
      </button>
      {aktif && (
        <Link href={basePath} className="back-btn" style={{ fontSize: 11 }}>Reset</Link>
      )}
    </form>
  );
}
