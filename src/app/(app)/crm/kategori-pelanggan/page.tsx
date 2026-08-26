import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MasterPage } from "@/components/MasterPage";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { SubmitButton } from "@/components/SubmitButton";
import { simpanKategoriPelanggan, toggleKategoriPelanggan } from "./actions";

type Kat = { id: string; nama: string; diskon_persen: number; rupiah_per_poin: number; is_active: boolean };

export default async function KategoriPelangganPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data }, { data: custRows }] = await Promise.all([
    supabase.from("customer_categories").select("id, nama, diskon_persen, rupiah_per_poin, is_active").order("nama"),
    supabase.from("customers").select("category_id").not("category_id", "is", null),
  ]);

  const kategori = (data ?? []).map((k) => ({
    ...k, diskon_persen: Number(k.diskon_persen), rupiah_per_poin: Number(k.rupiah_per_poin),
  })) as Kat[];
  const editing = edit ? kategori.find((k) => k.id === edit) ?? null : null;

  const pakai = new Map<string, number>();
  for (const r of custRows ?? []) {
    const k = (r as { category_id: string }).category_id;
    pakai.set(k, (pakai.get(k) ?? 0) + 1);
  }

  return (
    <MasterPage
      back="/crm" icon="ti-crown" iconBg="#fef3c7" iconFg="#b45309"
      title="KATEGORI PELANGGAN"
      desc="Golongan pelanggan + diskon otomatis di kasir petshop"
      error={error} success={success} successMsg="Golongan tersimpan."
      bolehKelola={bolehKelola}
      readOnlyNote="Hanya OWNER/ADMIN yang bisa mengubah golongan pelanggan."
    >
      <div className="p2ban" style={{ marginBottom: 14 }}>
        <i className="ti ti-info-circle" /> Diskon di sini langsung dipakai kasir petshop begitu
        pelanggannya dipilih. Strata belanja otomatis (Bronze/Gold/VIP) diatur terpisah di{" "}
        <Link href="/pengaturan/tier" style={{ color: "#2563eb" }}>Konfigurasi loyalty</Link>.
      </div>

      {bolehKelola && (
        <form action={simpanKategoriPelanggan} className="crm-sec" style={{ marginBottom: 14 }}>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label className="flab">{editing ? "Ubah nama golongan" : "Golongan baru"}</label>
              <input className="fi" name="nama" defaultValue={editing?.nama ?? ""} maxLength={60} placeholder="mis. Reseller" required />
            </div>
            <div style={{ width: 150 }}>
              <label className="flab">Diskon (%)</label>
              <input className="fi" name="diskon_persen" type="number" min={0} max={100} step="0.01"
                defaultValue={editing?.diskon_persen ?? 0} required />
            </div>
            <div style={{ width: 170 }}>
              <label className="flab">Rp per 1 poin</label>
              <input className="fi" name="rupiah_per_poin" type="number" min={1} step="any"
                defaultValue={editing?.rupiah_per_poin ?? 1000} required />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Makin kecil, makin royal. 1000 = tiap Rp1.000 dapat 1 poin.
              </div>
            </div>
            <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
              Simpan
            </SubmitButton>
            {editing && <Link href="/crm/kategori-pelanggan" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
          </div>
        </form>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Golongan</th>
                <th style={{ width: 90 }}>Diskon</th>
                <th style={{ width: 120 }}>Poin</th>
                <th style={{ width: 120 }}>Dipakai</th><th style={{ width: 80 }}>Status</th>
                {bolehKelola && <th style={{ width: 150 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {kategori.map((k, i) => (
                <tr key={k.id}>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                  <td style={{ fontSize: 11.5, fontWeight: 600 }}>{k.nama}</td>
                  <td style={{ fontSize: 11.5 }}>{k.diskon_persen > 0 ? `${k.diskon_persen}%` : <span style={{ color: "var(--td)" }}>—</span>}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
                    Rp {k.rupiah_per_poin.toLocaleString("id-ID")} = 1 poin
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{pakai.get(k.id) ?? 0} pelanggan</td>
                  <td><span className={`bge ${k.is_active ? "g" : "x"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Link href={`/crm/kategori-pelanggan?edit=${k.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                        <Link href={`/crm/kategori-pelanggan/${k.id}`} className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Diskon per barang</Link>
                        <form action={toggleKategoriPelanggan}>
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="aktif" value={k.is_active ? "1" : "0"} />
                          <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                            {k.is_active ? "Nonaktifkan" : "Aktifkan"}
                          </SubmitButton>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {kategori.length === 0 && (
                <tr><td colSpan={bolehKelola ? 6 : 5} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                  Belum ada golongan.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </MasterPage>
  );
}
