import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { simpanAnabul } from "./actions";

export default async function TambahAnabulPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; error?: string }>;
}) {
  const { customer: customerId, error } = await searchParams;
  const supabase = await createClient();

  // ponytail: if customer id provided, load that customer for context header.
  // Otherwise load all customers for the dropdown select.
  let customerName: string | null = null;
  let customers: { id: string; name: string; phone: string }[] = [];

  if (customerId) {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone")
      .eq("id", customerId)
      .maybeSingle();
    customerName = data?.name ?? null;
  } else {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone")
      .order("name");
    customers = data ?? [];
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm/pelanggan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Tambah Anabul Baru</span>
      </div>

      {error && (
        <div
          className="p2ban"
          style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c", marginBottom: 12 }}
        >
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      {customerId && customerName && (
        <div
          className="p2ban"
          style={{ background: "#eff6ff", border: ".5px solid #bfdbfe", color: "#1e40af", marginBottom: 12 }}
        >
          <i className="ti ti-user" /> Mendaftarkan anabul untuk pelanggan:{" "}
          <strong>{customerName}</strong>
        </div>
      )}

      <form action={simpanAnabul}>
        {/* ponytail: pass customer_id via hidden input if pre-selected, else via select. */}
        {customerId ? (
          <input type="hidden" name="customer_id" value={customerId} />
        ) : null}

        <div className="grid2">
          {/* Section 01: Data Anabul */}
          <div className="crm-sec" style={{ marginBottom: 0 }}>
            <SecHeader num="01" title="DATA ANABUL" desc="Informasi dasar hewan peliharaan." />

            {!customerId && (
              <div className="fg">
                <label className="flab">
                  Pelanggan / Pemilik <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <select className="fi" name="customer_id" required>
                  <option value="">— Pilih pelanggan —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="fg">
              <label className="flab">
                Nama Anabul <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input className="fi" name="nama" placeholder="Mochi" required />
            </div>

            <div className="frow">
              <div>
                <label className="flab">Spesies</label>
                <select className="fi" name="species">
                  <option value="Kucing">Kucing</option>
                  <option value="Anjing">Anjing</option>
                  <option value="Kelinci">Kelinci</option>
                  <option value="Burung">Burung</option>
                  <option value="Lainnya">Lainnya</option>
                </select>
              </div>
              <div>
                <label className="flab">Ras</label>
                <input className="fi" name="breed" placeholder="Persia, Shiba, dll." />
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Jenis Kelamin</label>
                <select className="fi" name="gender">
                  <option value="Jantan">Jantan</option>
                  <option value="Betina">Betina</option>
                </select>
              </div>
              <div>
                <label className="flab">Tgl Lahir</label>
                <input className="fi" name="dob" type="date" />
              </div>
            </div>

            <div className="frow">
              <div>
                <label className="flab">Berat (kg)</label>
                <input className="fi" name="weight" type="number" step="0.1" placeholder="3.5" />
              </div>
              <div>
                <label className="flab">Warna</label>
                <input className="fi" name="warna" placeholder="Oranye, Hitam putih, dll." />
              </div>
            </div>
          </div>

          {/* Section 02: Info Medis */}
          <div className="crm-sec" style={{ marginBottom: 0 }}>
            <SecHeader num="02" title="INFO MEDIS" desc="Data medis dan kondisi khusus anabul." />

            <div className="frow">
              <div>
                <label className="flab">Sterilisasi</label>
                <select className="fi" name="sterilisasi">
                  <option value="">— Belum diketahui —</option>
                  <option value="Utuh">Utuh</option>
                  <option value="Steril">Steril</option>
                </select>
              </div>
              <div>
                <label className="flab">Golongan Darah</label>
                <input className="fi" name="golongan_darah" placeholder="A, B, AB, dll." />
              </div>
            </div>

            <div className="fg">
              <label className="flab">No. Microchip</label>
              <input className="fi" name="microchip" placeholder="Nomor microchip jika ada" />
            </div>

            <div className="fg">
              <label className="flab">Alergi</label>
              <input className="fi" name="alergi" placeholder="Makanan laut, debu, dll." />
            </div>

            <div className="fg">
              <label className="flab">Kondisi Khusus</label>
              <textarea
                className="fi"
                name="kondisi_khusus"
                placeholder="Riwayat penyakit, kondisi kronis, atau informasi medis penting lainnya..."
                rows={5}
                style={{ resize: "vertical" }}
              />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Link href="/crm/pelanggan" className="btn-def">Batal</Link>
          <button type="submit" className="btn-acc">Simpan Anabul</button>
        </div>
      </form>
    </>
  );
}
