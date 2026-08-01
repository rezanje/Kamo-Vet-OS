import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { voucherStatus, type VoucherRow } from "@/lib/voucher";
import { simpanVoucher, toggleVoucher } from "./actions";

const STATUS_BADGE: Record<string, string> = { aktif: "g", terjadwal: "b", kadaluarsa: "x", nonaktif: "r" };
const STATUS_LABEL: Record<string, string> = {
  aktif: "Aktif hari ini", terjadwal: "Terjadwal", kadaluarsa: "Kadaluarsa", nonaktif: "Nonaktif",
};

type Row = VoucherRow & { id: string; created_at: string };

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

export default async function VoucherPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  // WIB: tanggal server bisa masih "kemarin" dalam UTC — voucher yang mulai
  // berlaku hari ini harus sudah terbaca aktif oleh kasir di Indonesia.
  const today = new Date(new Date().getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("vouchers")
    .select("id, code, tipe, nilai, is_active, valid_from, valid_until, created_at")
    .order("created_at", { ascending: false });

  const rows = ((data ?? []) as unknown as Row[]).map((v) => ({ ...v, nilai: Number(v.nilai) }));
  const editing = edit ? rows.find((v) => v.id === edit) ?? null : null;
  const aktifCount = rows.filter((v) => voucherStatus(v, today) === "aktif").length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Kode Voucher</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Voucher tersimpan.
        </div>
      )}
      {!bolehKelola && (
        <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang bisa mengatur voucher.</div>
      )}

      {bolehKelola && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title={editing ? "UBAH VOUCHER" : "BUAT VOUCHER"}
            desc="Kode yang diketik kasir saat bayar. Kosongkan tanggal kalau berlaku tanpa batas waktu."
          />
          <form action={simpanVoucher} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr", gap: 8, alignItems: "flex-end" }}>
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <div>
              <label className="flab">Kode *</label>
              <input className="fi" name="code" defaultValue={editing?.code ?? ""} maxLength={24}
                placeholder="mis. HEMAT10" required style={{ textTransform: "uppercase" }} />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Disimpan huruf besar tanpa spasi — kasir bebas mengetiknya.
              </div>
            </div>
            <div>
              <label className="flab">Jenis *</label>
              <select className="fi" name="tipe" defaultValue={editing?.tipe ?? "nominal"}>
                <option value="nominal">Potongan Rupiah</option>
                <option value="persen">Diskon Persen</option>
              </select>
            </div>
            <div>
              <label className="flab">Nilai *</label>
              <input className="fi" name="nilai" type="number" min={1} step="any"
                defaultValue={editing?.nilai ?? ""} placeholder="10000" required />
            </div>
            <div>
              <label className="flab">Berlaku dari</label>
              <input className="fi" name="valid_from" type="date" defaultValue={editing?.valid_from ?? ""} />
            </div>
            <div>
              <label className="flab">Berlaku s/d</label>
              <input className="fi" name="valid_until" type="date" defaultValue={editing?.valid_until ?? ""} />
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
              <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "#2563eb" }}>
                {editing ? "Simpan perubahan" : "Buat voucher"}
              </SubmitButton>
              {editing && <Link href="/crm/voucher" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
            </div>
          </form>
        </div>
      )}

      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <SecHeader num="02" title="DAFTAR VOUCHER" desc={`${rows.length} kode terdaftar · ${aktifCount} aktif hari ini.`} />
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 30 }}>No.</th><th>Kode</th><th>Jenis</th>
                <th style={{ textAlign: "right" }}>Nilai</th><th>Berlaku</th><th>Status</th>
                {bolehKelola && <th style={{ width: 160 }}>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((v, i) => {
                const st = voucherStatus(v, today);
                const masa = !v.valid_from && !v.valid_until
                  ? "Tanpa batas"
                  : `${v.valid_from ?? "…"} s/d ${v.valid_until ?? "…"}`;
                return (
                  <tr key={v.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 700, fontFamily: "var(--mono, monospace)" }}>{v.code}</td>
                    <td style={{ fontSize: 11 }}>{v.tipe === "persen" ? "Diskon persen" : "Potongan rupiah"}</td>
                    <td style={{ textAlign: "right", fontSize: 11, fontWeight: 600 }}>
                      {v.tipe === "persen" ? `${v.nilai}%` : rp(v.nilai)}
                    </td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{masa}</td>
                    <td><span className={`bge ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span></td>
                    {bolehKelola && (
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Link href={`/crm/voucher?edit=${v.id}`} className="btn-def"
                            style={{ padding: "3px 9px", fontSize: 10.5, textDecoration: "none" }}>Ubah</Link>
                          <form action={toggleVoucher}>
                            <input type="hidden" name="id" value={v.id} />
                            <input type="hidden" name="aktif" value={v.is_active ? "1" : "0"} />
                            <SubmitButton className="btn-def" style={{ padding: "3px 9px", fontSize: 10.5 }} pendingText="…">
                              {v.is_active ? "Nonaktifkan" : "Aktifkan"}
                            </SubmitButton>
                          </form>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={bolehKelola ? 7 : 6} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Belum ada kode voucher.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
