import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { bolehKelolaMaster } from "@/lib/master-guard";
import { TIPE_AKUN, akunSistem, KODE_SISTEM } from "@/lib/coa-sistem";
import { simpanAkun, toggleAkun } from "./actions";
import { susunPohon, ratakan, type AkunPohon } from "@/lib/coa-pohon";

// Bagan Akun: dikelompokkan per tipe, urut ASET→LIABILITAS→EKUITAS→PENDAPATAN→BEBAN.
// OWNER/ADMIN bisa menambah & mengubah; peran lain tetap boleh melihat daftarnya.

type CoaAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  normal_balance: string;
  is_active: boolean;
  parent_id: string | null;
  is_header: boolean;
};

const TYPE_ORDER = ["ASET", "LIABILITAS", "EKUITAS", "PENDAPATAN", "BEBAN"] as const;

const TYPE_LABELS: Record<string, string> = {
  ASET: "Aset", LIABILITAS: "Liabilitas", EKUITAS: "Ekuitas",
  PENDAPATAN: "Pendapatan", BEBAN: "Beban",
};

const TYPE_DESC: Record<string, string> = {
  ASET: "Harta & sumber daya yang dimiliki perusahaan.",
  LIABILITAS: "Kewajiban & hutang kepada pihak ketiga.",
  EKUITAS: "Modal pemilik & laba ditahan.",
  PENDAPATAN: "Penghasilan dari kegiatan operasional.",
  BEBAN: "Pengeluaran untuk menjalankan operasional.",
};

export default async function CoaPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; success?: string; error?: string }>;
}) {
  const { edit, success, error: errMsg } = await searchParams;
  const supabase = await createClient();
  const bolehKelola = await bolehKelolaMaster();

  const [{ data, error }, { data: lineData }] = await Promise.all([
    supabase.from("coa_accounts").select("id, code, name, type, normal_balance, is_active, parent_id, is_header").order("code"),
    // Jumlah baris jurnal per akun — dipakai kolom "Dipakai" supaya orang tahu
    // sebelum menekan tombol nonaktif, dan untuk mengunci kelompok/saldo normal.
    supabase.from("journal_lines").select("account_id"),
  ]);

  const accounts = (data ?? []) as unknown as CoaAccount[];
  const pakaiJurnal = new Map<string, number>();
  for (const l of (lineData ?? []) as { account_id: string }[]) {
    pakaiJurnal.set(l.account_id, (pakaiJurnal.get(l.account_id) ?? 0) + 1);
  }

  const sedangEdit = edit ? accounts.find((a) => a.id === edit) ?? null : null;

  // Hanya akun induk yang boleh jadi pilihan induk, dan akun tidak boleh memilih
  // dirinya sendiri. Pengecekan lengkapnya (sekelompok, tidak melingkar) di server.
  const calonInduk = accounts.filter((a) => a.is_header && a.id !== sedangEdit?.id);
  const punyaAnak = new Set(accounts.map((a) => a.parent_id).filter(Boolean) as string[]);

  // Akun ber-tipe di luar 5 kelompok yang dikenal akan hilang dari semua laporan.
  // Ditampilkan terpisah supaya bisa diperbaiki dari layar ini juga.
  const groups: Record<string, CoaAccount[]> = {};
  const asing: CoaAccount[] = [];
  for (const acc of accounts) {
    if ((TYPE_ORDER as readonly string[]).includes(acc.type)) {
      (groups[acc.type] ??= []).push(acc);
    } else asing.push(acc);
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/keuangan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Bagan Akun</span>
        <Link href="/pengaturan/impor/akun" className="btn-def"
          style={{ marginLeft: "auto", fontSize: 11, textDecoration: "none" }}>
          <i className="ti ti-file-spreadsheet" /> Impor dari Excel
        </Link>
      </div>

      {errMsg && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {errMsg}
        </div>
      )}
      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          {/* Impor mengirim ringkasannya lewat URL; simpan biasa cuma mengirim "1". */}
          <i className="ti ti-circle-check" /> {success === "1" ? "Bagan akun tersimpan." : success}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> Gagal memuat data akun: {error.message}
        </div>
      )}

      {bolehKelola ? (
        <form action={simpanAkun}>
          {sedangEdit && <input type="hidden" name="id" value={sedangEdit.id} />}
          <div className="crm-sec">
            <SecHeader
              num="00"
              title={sedangEdit ? `UBAH AKUN ${sedangEdit.code}` : "TAMBAH AKUN"}
              desc={sedangEdit
                ? "Kode akun tidak bisa diubah — seluruh pencatatan mencarinya lewat kode itu."
                : "Kode 4 angka. Angka pertama menentukan kelompoknya: 1 aset, 2 liabilitas, 3 ekuitas, 4 pendapatan, 5 beban."}
              action={sedangEdit
                ? <Link href="/keuangan/coa" className="btn-def" style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>Batal</Link>
                : undefined}
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div className="fg">
                <label className="flab">Kode akun *</label>
                <input className="fi" name="code" required maxLength={4} inputMode="numeric"
                  placeholder="5403" defaultValue={sedangEdit?.code ?? ""}
                  readOnly={!!sedangEdit}
                  style={sedangEdit ? { background: "var(--bg2, #f3f4f6)", color: "var(--tm)" } : undefined} />
              </div>
              <div className="fg" style={{ gridColumn: "span 2" }}>
                <label className="flab">Nama akun *</label>
                <input className="fi" name="name" required maxLength={80}
                  placeholder="Beban Pemasaran" defaultValue={sedangEdit?.name ?? ""} />
              </div>
              <div className="fg">
                <label className="flab">Kelompok *</label>
                <select className="fi" name="type" defaultValue={sedangEdit?.type ?? "BEBAN"}>
                  {TIPE_AKUN.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="fg">
                <label className="flab">Saldo normal *</label>
                <select className="fi" name="normal_balance" defaultValue={sedangEdit?.normal_balance ?? "D"}>
                  <option value="D">Debit</option>
                  <option value="K">Kredit</option>
                </select>
              </div>
              <div className="fg">
                <label className="flab">Jenis akun *</label>
                <select className="fi" name="is_header" defaultValue={sedangEdit?.is_header ? "1" : "0"}>
                  <option value="0">Detail — dipakai memposting</option>
                  <option value="1">Induk — hanya menjumlahkan</option>
                </select>
              </div>
              <div className="fg" style={{ gridColumn: "span 2" }}>
                <label className="flab">Induk akun</label>
                <select className="fi" name="parent_id" defaultValue={sedangEdit?.parent_id ?? ""}>
                  <option value="">— Tanpa induk (tingkat atas) —</option>
                  {calonInduk.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
              Akun <b>induk</b> tidak bisa dipakai memposting jurnal — dia hanya menjumlahkan
              akun rincian di bawahnya, dan angkanya muncul sebagai subtotal di Laba Rugi &amp; Neraca.
              Induk harus sekelompok dengan rinciannya.
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
              Kode 1103–1199 dipesan untuk rekening kas/bank yang dibuat otomatis dari
              Kas &amp; Bank → Rekening. Menambah akun aset di sini <b>tidak</b> membuatnya
              dihitung sebagai kas di Arus Kas — untuk itu buat rekeningnya di menu tersebut.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <SubmitButton className="btn-acc">
                <i className="ti ti-device-floppy" /> {sedangEdit ? "Simpan perubahan" : "Tambah akun"}
              </SubmitButton>
            </div>
          </div>
        </form>
      ) : (
        <div className="p2ban" style={{ background: "#f8fafc", border: ".5px solid var(--bd)", color: "var(--tm)" }}>
          <i className="ti ti-eye" /> Kamu bisa melihat bagan akun, tapi hanya Owner/Admin yang boleh mengubahnya.
        </div>
      )}

      {asing.length > 0 && (
        <Grup
          num="!!" judul="KELOMPOK TIDAK DIKENAL"
          desc="Akun ini tidak masuk kelompok mana pun, jadi tidak muncul di laporan. Perbaiki kelompoknya."
          rows={asing} pakaiJurnal={pakaiJurnal} bolehKelola={bolehKelola} punyaAnak={punyaAnak}
        />
      )}

      {TYPE_ORDER.map((type, idx) => {
        const rows = groups[type] ?? [];
        if (rows.length === 0) return null;
        return (
          <Grup
            key={type} num={String(idx + 1).padStart(2, "0")}
            judul={`${type} — ${TYPE_LABELS[type]}`} desc={TYPE_DESC[type]}
            rows={rows} pakaiJurnal={pakaiJurnal} bolehKelola={bolehKelola} punyaAnak={punyaAnak}
          />
        );
      })}
    </>
  );
}

function Grup({
  num, judul, desc, rows, pakaiJurnal, bolehKelola, punyaAnak,
}: {
  num: string; judul: string; desc: string;
  rows: CoaAccount[]; pakaiJurnal: Map<string, number>; bolehKelola: boolean;
  punyaAnak: Set<string>;
}) {
  // Ditampilkan bertingkat: akun rincian menjorok di bawah induknya.
  const simpul = ratakan(susunPohon(rows as unknown as (AkunPohon & CoaAccount)[]));
  return (
    <div className="crm-sec" style={{ marginBottom: 14 }}>
      <SecHeader num={num} title={judul} desc={desc} />
      <div style={{ overflowX: "auto" }}>
        <table className="tbl" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Kode</th>
              <th>Nama Akun</th>
              <th style={{ width: 110, textAlign: "center" }}>Saldo Normal</th>
              <th style={{ width: 90, textAlign: "center" }}>Dipakai</th>
              <th style={{ width: 80, textAlign: "center" }}>Status</th>
              {bolehKelola && <th style={{ width: 130 }} />}
            </tr>
          </thead>
          <tbody>
            {simpul.map(({ akun: acc, level }) => {
              const n = pakaiJurnal.get(acc.id) ?? 0;
              const sistem = akunSistem(acc.code);
              return (
                <tr key={acc.id} style={acc.is_header ? { background: "var(--sf1, #f8fafc)" } : undefined}>
                  <td style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "var(--tm)", paddingLeft: 6 + level * 16 }}>
                    {acc.code}
                  </td>
                  <td style={{ fontSize: 12, fontWeight: acc.is_header ? 700 : 400 }}>
                    {acc.name}
                    {acc.is_header && (
                      <span className="bge o" style={{ fontSize: 8.5, marginLeft: 6 }} title="Akun penjumlahan — tidak bisa dijurnal">
                        induk
                      </span>
                    )}
                    {sistem && (
                      <span className="bge b" style={{ fontSize: 8.5, marginLeft: 6 }} title={KODE_SISTEM[acc.code]}>
                        akun sistem
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`bge ${acc.normal_balance === "D" ? "b" : "g"}`} style={{ fontSize: 9.5 }}>
                      {acc.normal_balance === "D" ? "Debit" : "Kredit"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center", fontSize: 10.5, color: n ? "var(--tm)" : "var(--td)" }}>
                    {acc.is_header
                      ? <span style={{ color: "var(--td)" }}>{punyaAnak.has(acc.id) ? "induk" : "induk kosong"}</span>
                      : n ? `${n} jurnal` : "—"}
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`bge ${acc.is_active ? "g" : "x"}`} style={{ fontSize: 9 }}>
                      {acc.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  {bolehKelola && (
                    <td>
                      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                        <Link href={`/keuangan/coa?edit=${acc.id}`} className="btn-def"
                          style={{ padding: "3px 9px", fontSize: 10, textDecoration: "none" }}>Ubah</Link>
                        {!sistem && (
                          <form action={toggleAkun}>
                            <input type="hidden" name="id" value={acc.id} />
                            <input type="hidden" name="aktif" value={acc.is_active ? "1" : "0"} />
                            <button type="submit" className="btn-def" style={{ padding: "3px 9px", fontSize: 10 }}>
                              {acc.is_active ? "Nonaktifkan" : "Aktifkan"}
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 6, textAlign: "right" }}>
        {rows.length} akun
      </div>
    </div>
  );
}
