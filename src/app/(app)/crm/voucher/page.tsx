import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { ringkasSyarat, voucherStatus, type VoucherRow } from "@/lib/voucher";
import { simpanVoucher, toggleVoucher } from "./actions";
import { hariIniWIB } from "@/lib/tanggal";

const STATUS_BADGE: Record<string, string> = { aktif: "g", terjadwal: "b", kadaluarsa: "x", nonaktif: "r" };
const STATUS_LABEL: Record<string, string> = {
  aktif: "Aktif hari ini", terjadwal: "Terjadwal", kadaluarsa: "Kadaluarsa", nonaktif: "Nonaktif",
};

type Row = VoucherRow & {
  id: string; created_at: string;
  customers?: { name: string } | { name: string }[] | null;
  customer_categories?: { nama: string } | { nama: string }[] | null;
};

const satu = <T,>(r: T | T[] | null | undefined): T | null => (Array.isArray(r) ? r[0] ?? null : r ?? null);

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
  const today = hariIniWIB();

  const [{ data }, { data: custData }, { data: golData }] = await Promise.all([
    supabase
    .from("vouchers")
    .select("id, code, tipe, nilai, is_active, valid_from, valid_until, max_potongan, min_belanja, boleh_gabung_promo, customer_id, category_id, created_at, customers(name), customer_categories(nama)")
    .order("created_at", { ascending: false }),
    supabase.from("customers").select("id, name").order("name").limit(500),
    supabase.from("customer_categories").select("id, nama").eq("is_active", true).order("nama"),
  ]);
  const pelanggan = (custData ?? []) as { id: string; name: string }[];
  const golongan = (golData ?? []) as { id: string; nama: string }[];

  const rows = ((data ?? []) as unknown as Row[]).map((v) => ({
    ...v,
    nilai: Number(v.nilai),
    max_potongan: v.max_potongan === null ? null : Number(v.max_potongan),
    min_belanja: Number(v.min_belanja) || 0,
  }));
  const editing = edit ? rows.find((v) => v.id === edit) ?? null : null;
  const aktifCount = rows.filter((v) => voucherStatus(v, today) === "aktif").length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Kode Voucher</span>
      </div>

      {/* Promo & voucher dua-duanya "potongan yang dikelola pusat" — dipasangkan
          di sini supaya tidak perlu balik ke menu CRM buat pindah antar keduanya. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
        <Link href="/crm/promo" className="back-btn" style={tabAktif(false)}>
          <i className="ti ti-speakerphone" /> Promo
        </Link>
        <Link href="/crm/voucher" className="back-btn" style={tabAktif(true)}>
          <i className="ti ti-ticket" /> Kode Voucher
        </Link>
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

            {/* Pagar nilai potongan — terutama untuk voucher persen. */}
            <div>
              <label className="flab">Maks. potongan (Rp)</label>
              <input className="fi" name="max_potongan" type="number" min={1} step="any"
                defaultValue={editing?.max_potongan ?? ""} placeholder="kosong = tanpa batas" />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Diskon 10% dengan batas Rp 10.000 hanya memotong Rp 10.000 sebesar apa pun tagihannya.
              </div>
            </div>
            <div>
              <label className="flab">Min. belanja (Rp)</label>
              <input className="fi" name="min_belanja" type="number" min={0} step="any"
                defaultValue={editing?.min_belanja || ""} placeholder="0 = bebas" />
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Dihitung setelah diskon per barang.
              </div>
            </div>
            {/* Sasaran voucher (permintaan Pak Aldi, meeting 14 Agustus): voucher
                yang menempel di orangnya tidak bisa ditiru seperti voucher kertas. */}
            <div>
              <label className="flab">Khusus pelanggan</label>
              <select className="fi" name="customer_id" defaultValue={editing?.customer_id ?? ""}>
                <option value="">— siapa pun —</option>
                {pelanggan.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="flab">Khusus golongan</label>
              <select className="fi" name="category_id" defaultValue={editing?.category_id ?? ""}>
                <option value="">— semua golongan —</option>
                {golongan.map((g) => <option key={g.id} value={g.id}>{g.nama}</option>)}
              </select>
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Isi salah satu saja. Kode yang bocor ke orang lain otomatis ditolak kasir.
              </div>
            </div>
            <div style={{ gridColumn: "span 3", background: "#f8fafc", border: ".5px solid var(--bd)", borderRadius: 7, padding: "9px 11px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700 }}>
                <input type="checkbox" name="boleh_gabung_promo" value="1"
                  defaultChecked={editing ? editing.boleh_gabung_promo : true} /> Boleh digabung dengan promo
              </label>
              <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 3 }}>
                Kalau tidak dicentang, voucher ditolak saat keranjang sudah kena promo potong otomatis.
                Promo yang menang — potongannya sudah terlihat di layar sebelum kasir mengetik kode.
              </div>
            </div>

            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
              <SubmitButton className="btn-acc" icon="ti-device-floppy" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}>
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
                <th style={{ textAlign: "right" }}>Nilai</th><th>Syarat</th><th>Berlaku</th><th>Status</th>
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
                    <td style={{ fontSize: 10, color: "var(--tm)" }}>{ringkasSyarat(v, satu(v.customers)?.name ?? satu(v.customer_categories)?.nama ?? null)}</td>
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
                  <td colSpan={bolehKelola ? 8 : 7} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
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

// Penanda halaman aktif untuk pasangan tab Promo / Kode Voucher.
function tabAktif(active: boolean): React.CSSProperties {
  return active
    ? { background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe", fontWeight: 700 }
    : {};
}
