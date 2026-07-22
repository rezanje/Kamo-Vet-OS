import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { buatPerintah } from "../actions";

export default async function OpnameBaruPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: whs } = await supabase
    .from("warehouses").select("id, name").eq("is_active", true).neq("type", "TRANSIT").order("name");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/opname" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Perintah Stok Opname</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <form action={buatPerintah}>
        <div className="crm-sec" style={{ maxWidth: 560 }}>
          <SecHeader num="01" title="PERINTAH STOK OPNAME" desc="Surat tugas hitung fisik untuk satu gudang." />
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Gudang *</label>
            <select className="fi" name="warehouse_id" required>
              <option value="">Pilih gudang</option>
              {(whs ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Tanggal mulai *</label>
            <input className="fi" type="date" name="tanggal_mulai" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Penanggung jawab *</label>
            <input className="fi" name="penanggung_jawab" placeholder="Nama penanggung jawab" required />
          </div>
          <div className="fg" style={{ marginBottom: 10 }}>
            <label className="flab">Dikerjakan oleh</label>
            <input className="fi" name="dikerjakan_oleh" placeholder="Nama / email petugas hitung (opsional)" />
          </div>
          <div className="fg">
            <label className="flab">Keterangan</label>
            <textarea className="fi" name="keterangan" rows={3}
              placeholder='Mis. "SO GRND JULI 2026"' style={{ resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="submit" className="btn-acc">
              <i className="ti ti-clipboard-check" /> Simpan perintah
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
