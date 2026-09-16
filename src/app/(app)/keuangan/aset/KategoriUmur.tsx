import Link from "next/link";

export function KategoriUmur({ kategori }: { kategori: { id: string; nama: string }[] }) {
  return (
    <>
      <div>
        <label className="flab">Kategori *</label>
        <select className="fi" name="category_id" defaultValue="" required>
          <option value="">— pilih —</option>
          {kategori.map((k) => <option key={k.id} value={k.id}>{k.nama}</option>)}
        </select>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
          Daftarnya diatur di <Link href="/keuangan/kategori-aset" style={{ color: "#2563eb" }}>Kategori Aset</Link>.
        </div>
      </div>
      <div>
        <label className="flab">Umur ekonomis (bulan) *</label>
        <input className="fi" name="umur_bulan" type="number" min={1} required />
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
          Wajib ditentukan untuk aset individual ini.
        </div>
      </div>
    </>
  );
}
