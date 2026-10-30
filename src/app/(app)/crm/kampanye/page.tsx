import { NumberInput } from "@/components/NumberInput";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { simpanKodeKampanye, aturStatusKodeKampanye } from "./actions";
import { nonaktifkanPromoKadaluarsa } from "@/lib/promo-kadaluarsa";
import { hariIniWIB } from "@/lib/tanggal";

type Kode = {
  id: string; code: string; voucher_id: string | null; promo_id: string | null;
  max_uses: number | null; is_active: boolean; note: string | null;
};

// Kode kampanye (C05): nama lain untuk voucher atau promo yang sudah ada, dengan
// batas pemakaian opsional. Kasir mengetiknya di kolom kode voucher.
export default async function KodeKampanyePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const { error, success, edit } = await searchParams;
  const supabase = await createClient();
  // Kode kampanye cuma nama lain untuk promo/voucher tujuannya — kalau tujuannya
  // sudah lewat tanggal, kodenya ikut dimatikan sebelum daftar ini dibaca.
  await nonaktifkanPromoKadaluarsa(supabase);
  const bolehKelola = await bolehKelolaMaster();

  const [{ data: kodeData }, { data: vData }, { data: pData }, pemakaian] = await Promise.all([
    supabase.from("campaign_codes").select("id, code, voucher_id, promo_id, max_uses, is_active, note").order("code"),
    supabase.from("vouchers").select("id, code, is_active, valid_until").order("code"),
    supabase.from("promos").select("id, name, is_active, auto_apply, valid_until").order("name"),
    bolehKelola ? supabase.rpc("campaign_code_usage") : Promise.resolve({ data: [] }),
  ]);
  const kode = (kodeData ?? []) as Kode[];
  const vouchers = (vData ?? []) as { id: string; code: string; is_active: boolean; valid_until: string | null }[];
  const promos = (pData ?? []) as { id: string; name: string; is_active: boolean; auto_apply: boolean; valid_until: string | null }[];
  const terpakai = new Map(((pemakaian.data ?? []) as { code: string; used: number }[]).map((u) => [u.code, Number(u.used)]));
  const editing = edit ? kode.find((k) => k.id === edit) ?? null : null;
  const tujuan = (k: Kode) => k.voucher_id
    ? `Voucher ${vouchers.find((v) => v.id === k.voucher_id)?.code ?? "?"}`
    : `Promo ${promos.find((p) => p.id === k.promo_id)?.name ?? "?"}`;
  // Status dihitung ulang dari tanggal tujuannya, tidak cuma dari kolom
  // is_active. Penyapu di atas biasanya sudah mematikannya, tapi kalau
  // panggilannya gagal daftar ini tetap tidak boleh menjanjikan "Aktif" untuk
  // kode yang di kasir sudah tidak memotong apa pun.
  const berakhir = (k: Kode) => (k.voucher_id
    ? vouchers.find((v) => v.id === k.voucher_id)?.valid_until
    : promos.find((p) => p.id === k.promo_id)?.valid_until) ?? null;
  const kadaluarsa = (k: Kode) => { const akhir = berakhir(k); return !!akhir && akhir < hariIniWIB(); };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/crm" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Kode Kampanye</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 11 }}>
        <Link href="/crm/promo" className="back-btn"><i className="ti ti-speakerphone" /> Promo</Link>
        <Link href="/crm/voucher" className="back-btn"><i className="ti ti-ticket" /> Kode Voucher</Link>
        <Link href="/crm/kampanye" className="back-btn" style={{ background: "#eff6ff", color: "#2563eb", borderColor: "#bfdbfe", fontWeight: 700 }}>
          <i className="ti ti-tag" /> Kode Kampanye
        </Link>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" /> Kode kampanye tersimpan.
        </div>
      )}
      {!bolehKelola && (
        <div className="p2ban"><i className="ti ti-info-circle" /> Hanya OWNER/ADMIN yang bisa membuat kode kampanye.</div>
      )}

      {bolehKelola && (
        <div className="crm-sec">
          <SecHeader
            num="01"
            title={editing ? "UBAH KODE KAMPANYE" : "BUAT KODE KAMPANYE"}
            desc="Kode diketik kasir di kolom kode voucher (petshop & klinik). Potongannya mengikuti voucher/promo tujuan."
          />
          <form action={simpanKodeKampanye} style={{ display: "grid", gridTemplateColumns: "1.2fr 2fr 1fr 2fr auto", gap: 8, alignItems: "flex-end" }}>
            <input type="hidden" name="id" value={editing?.id ?? ""} />
            <input type="hidden" name="is_active" value={editing && !editing.is_active ? "0" : "1"} />
            <div>
              <label className="flab">Kode *</label>
              <input className="fi" name="code" defaultValue={editing?.code ?? ""} maxLength={24} required
                placeholder="mis. KAMOGAJIAN" style={{ textTransform: "uppercase" }} />
            </div>
            <div>
              <label className="flab">Ditautkan ke *</label>
              <select className="fi" name="target" required
                defaultValue={editing ? (editing.voucher_id ? `voucher:${editing.voucher_id}` : `promo:${editing.promo_id}`) : ""}>
                <option value="">Pilih voucher atau promo</option>
                <optgroup label="Voucher (potongan total transaksi)">
                  {vouchers.map((v) => <option key={v.id} value={`voucher:${v.id}`}>{v.code}{v.is_active ? "" : " (nonaktif)"}</option>)}
                </optgroup>
                <optgroup label="Promo barang">
                  {promos.map((p) => <option key={p.id} value={`promo:${p.id}`}>{p.name}{p.is_active ? "" : " (nonaktif)"}{p.auto_apply ? " · otomatis" : ""}</option>)}
                </optgroup>
              </select>
            </div>
            <div>
              <label className="flab">Batas pemakaian</label>
              <NumberInput className="fi" name="max_uses" type="number" min={1} step={1}
                defaultValue={editing?.max_uses ?? ""} placeholder="tanpa batas" />
            </div>
            <div>
              <label className="flab">Catatan</label>
              <input className="fi" name="note" maxLength={200} defaultValue={editing?.note ?? ""} placeholder="mis. Brosur gajian Nov" />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <SubmitButton className="btn-acc">{editing ? "Simpan" : "Buat kode"}</SubmitButton>
              {editing && <Link href="/crm/kampanye" className="btn-def" style={{ textDecoration: "none" }}>Batal</Link>}
            </div>
          </form>
          <div style={{ fontSize: 10.5, color: "var(--td)", marginTop: 6 }}>
            Batas pemakaian dihitung per struk yang sudah dibayar dan invoice klinik yang memakai kode ini (yang dibatalkan tidak dihitung).
            Kode voucher tujuannya tetap bisa dipakai langsung — buat voucher khusus kampanye bila kodenya tidak boleh bocor.
            Promo tujuan yang tidak &quot;potong otomatis&quot; hanya terpotong bila kode ini diketik.
          </div>
        </div>
      )}

      <div className="crm-sec">
        <SecHeader num="02" title="DAFTAR KODE KAMPANYE" desc={`${kode.length} kode`} />
        <table className="tbl">
          <thead><tr><th>Kode</th><th>Ditautkan ke</th><th>Terpakai</th><th>Status</th><th>Catatan</th>{bolehKelola && <th />}</tr></thead>
          <tbody>
            {kode.map((k) => (
              <tr key={k.id} style={{ opacity: k.is_active && !kadaluarsa(k) ? 1 : 0.55 }}>
                <td style={{ fontWeight: 600 }}>{k.code}</td>
                <td>{tujuan(k)}</td>
                <td>{bolehKelola ? `${terpakai.get(k.code) ?? 0}${k.max_uses ? ` / ${k.max_uses}` : " (tanpa batas)"}` : k.max_uses ? `maks ${k.max_uses}` : "tanpa batas"}</td>
                <td>{kadaluarsa(k)
                  ? <span className="bge x" title={`Masa berlaku tujuannya berakhir ${berakhir(k)}`}>Kadaluarsa</span>
                  : <span className={`bge ${k.is_active ? "g" : "r"}`}>{k.is_active ? "Aktif" : "Nonaktif"}</span>}</td>
                <td style={{ fontSize: 11 }}>{k.note ?? ""}</td>
                {bolehKelola && (
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link href={`/crm/kampanye?edit=${k.id}`} className="btn-def" style={{ textDecoration: "none" }}>Ubah</Link>{" "}
                    <form action={aturStatusKodeKampanye} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={k.id} />
                      <input type="hidden" name="is_active" value={k.is_active ? "0" : "1"} />
                      <button className="btn-def" type="submit">{k.is_active ? "Nonaktifkan" : "Aktifkan"}</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
            {kode.length === 0 && <tr><td colSpan={6} style={{ color: "var(--tm)" }}>Belum ada kode kampanye.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
