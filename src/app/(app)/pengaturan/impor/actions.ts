"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { klienMasterAdmin } from "@/lib/master-guard";
import { bacaCsvUmum, ringkasSalah, type BarisSalah } from "@/lib/impor-csv";
import { periksaPelanggan, periksaPemasok } from "@/lib/impor-master";
import {
  bacaFileAkun, bacaTabelCsv, rencanakanCoaPengguna, rencanakanImporAkun,
  type KonteksImporAkun, type RencanaCoaPenggunaOk, type RencanaImporAkun, type TabelSumber,
} from "@/lib/impor-akun";
import { BATAS_XLSX_AKUN, bacaTabelXlsx } from "@/lib/impor-akun-xlsx";
import { pemetaanAkun } from "@/lib/impor-akun-pemetaan";
import { KONFIG, isJenisImpor, type JenisImpor } from "@/lib/impor-jenis";
import { kunciNama, kunciTarget, periksaKomisi, periksaTarget } from "@/lib/impor-komisi";
import { pesanSimpanGagal } from "@/lib/barang";
import { ListLoadError, readCompleteList } from "@/lib/checked-list";

const POTONGAN_PELANGGAN = 500;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

async function assertBoleh(back: string): Promise<Db> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "OWNER" && profile?.role !== "ADMIN") {
    redirect(`${back}?error=${encodeURIComponent("Hanya OWNER/ADMIN yang boleh mengimpor data")}`);
  }
  return supabase;
}

/** Simpan hasil impor per jenis. Mengembalikan jumlah baris yang masuk. */
async function simpan(supabase: Db, jenis: JenisImpor, baris: ReturnType<typeof bacaCsvUmum>) {
  if (!baris.ok) return { masuk: 0, salah: [] as BarisSalah[], pesanGagal: baris.pesan };

  if (jenis === "pelanggan") {
    // Nomor terdaftar dibaca LENGKAP per halaman: satu select polos dipotong API di 1.000 baris,
    // sehingga pelanggan ke-1.001 dst. lolos cek kembar dan tercatat dua kali.
    let cust: { id: string; phone: string | null }[];
    let kat: { id: string; nama: string }[] | null;
    try {
      [{ data: kat }, cust] = await Promise.all([
        supabase.from("customer_categories").select("id, nama").eq("is_active", true),
        readCompleteList<{ id: string; phone: string | null }>((from, to) => supabase.from("customers")
          .select("id, phone", { count: "exact" }).order("id").range(from, to), "Data pelanggan", { maxRows: null }),
      ]);
    } catch (e) {
      return { masuk: 0, salah: [] as BarisSalah[], pesanGagal: e instanceof ListLoadError ? e.message : "Data pelanggan belum dapat dicek. Coba lagi." };
    }
    const { normalTelp } = await import("@/lib/impor-master");
    const { siap, salah } = periksaPelanggan(baris.baris, {
      kategori: new Map(((kat ?? []) as { id: string; nama: string }[]).map((k) => [k.nama.toLowerCase(), k.id])),
      telpTerpakai: new Set(((cust ?? []) as { phone: string | null }[])
        .map((c) => normalTelp(c.phone ?? "")).filter(Boolean)),
    });
    if (siap.length === 0) return { masuk: 0, salah, pesanGagal: null };
    // Kartu hasil impor = pelanggan lama, tidak pernah dihitung "customer baru" di quest staf (Q01).
    const importedAt = new Date().toISOString();
    // File besar (ribuan kartu) disimpan per potongan supaya tiap kiriman tidak kena batas waktu database.
    let masuk = 0;
    let pakaiPenanda = true;
    for (let i = 0; i < siap.length; i += POTONGAN_PELANGGAN) {
      const potongan = siap.slice(i, i + POTONGAN_PELANGGAN);
      let { error } = await supabase.from("customers").insert(
        pakaiPenanda ? potongan.map((row) => ({ ...row, imported_at: importedAt })) : potongan);
      // Sebelum langkah database Q01 kolomnya belum ada: impor tetap jalan tanpa penanda.
      if (error && pakaiPenanda && /imported_at/.test(error.message)) {
        pakaiPenanda = false;
        ({ error } = await supabase.from("customers").insert(potongan));
      }
      if (error) {
        const pesan = pesanSimpanGagal(error.message);
        return {
          masuk, salah,
          pesanGagal: masuk
            ? `${masuk} pelanggan sudah masuk, ${siap.length - masuk} belum: ${pesan} Impor ulang file yang sama — yang sudah masuk otomatis dilewati.`
            : pesan,
        };
      }
      masuk += potongan.length;
    }
    return { masuk, salah, pesanGagal: null };
  }

  if (jenis === "pemasok") {
    const [{ data: kat }, { data: sup }] = await Promise.all([
      supabase.from("supplier_categories").select("id, nama").eq("is_active", true),
      supabase.from("suppliers").select("nama"),
    ]);
    const { siap, salah } = periksaPemasok(baris.baris, {
      kategori: new Map(((kat ?? []) as { id: string; nama: string }[]).map((k) => [k.nama.toLowerCase(), k.id])),
      namaTerpakai: new Set(((sup ?? []) as { nama: string }[]).map((s) => s.nama.toLowerCase())),
    });
    if (siap.length === 0) return { masuk: 0, salah, pesanGagal: null };
    const { error } = await supabase.from("suppliers").insert(siap);
    if (error) return { masuk: 0, salah, pesanGagal: pesanSimpanGagal(error.message) };
    return { masuk: siap.length, salah, pesanGagal: null };
  }

  if (jenis === "komisi" || jenis === "target") {
    // Master pendukungnya dibaca sekali di sini, bukan per baris: file 200 baris
    // tidak boleh jadi 200 kali query cuma untuk mencocokkan nama cabang.
    const [{ data: emp }, { data: cab }, { data: kat }] = await Promise.all([
      supabase.from("employees").select("id, nama").eq("status", "Aktif"),
      supabase.from("branches").select("id, name").eq("is_active", true),
      supabase.from("item_categories").select("id, name"),
    ]);
    const karyawan = new Map(((emp ?? []) as { id: string; nama: string }[])
      .map((e) => [kunciNama(e.nama), e.id]));
    const cabang = new Map(((cab ?? []) as { id: string; name: string }[])
      .map((c) => [kunciNama(c.name), c.id]));
    const kategori = new Map(((kat ?? []) as { id: string; name: string }[])
      .map((k) => [kunciNama(k.name), k.id]));

    if (jenis === "komisi") {
      const { data: brg } = await supabase.from("items").select("id, code, name");
      // Barang boleh dirujuk lewat kode maupun namanya — di lapangan dua-duanya dipakai.
      const barang = new Map<string, string>();
      for (const b of (brg ?? []) as { id: string; code: string | null; name: string }[]) {
        if (b.code) barang.set(kunciNama(b.code), b.id);
        barang.set(kunciNama(b.name), b.id);
      }

      const { siap, salah } = periksaKomisi(baris.baris, { karyawan, cabang, kategori, barang });
      if (siap.length === 0) return { masuk: 0, salah, pesanGagal: null };
      // H04: rules naming an employee (or a group/exception) are pay configuration that only
      // OWNER may write. Refuse the whole file up front instead of a half-failed database insert.
      const khusus = siap.filter((row) => (row as { employee_id?: string | null }).employee_id
        || (row as { commission_group?: string | null }).commission_group || (row as { override_group_rule_id?: string | null }).override_group_rule_id);
      if (khusus.length > 0) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = user ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : { data: null };
        if (profile?.role !== "OWNER") {
          return { masuk: 0, salah, pesanGagal: `${khusus.length} aturan di file ini khusus untuk karyawan tertentu dan hanya boleh diimpor OWNER. Hapus kolom karyawan dari baris itu atau minta OWNER mengimpornya.` };
        }
      }
      const { error } = await supabase.from("commission_rules").insert(siap);
      if (error) return { masuk: 0, salah, pesanGagal: pesanSimpanGagal(error.message) };
      return { masuk: siap.length, salah, pesanGagal: null };
    }

    const { data: adaTarget } = await supabase
      .from("sales_targets").select("periode, employee_id, branch_id, category_id");
    const sudahAda = new Set(((adaTarget ?? []) as {
      periode: string; employee_id: string | null; branch_id: string | null; category_id: string | null;
    }[]).map(kunciTarget));

    const { siap, salah } = periksaTarget(baris.baris, { karyawan, cabang, kategori, sudahAda });
    if (siap.length === 0) return { masuk: 0, salah, pesanGagal: null };
    const { error } = await supabase.from("sales_targets").insert(siap);
    if (error) return { masuk: 0, salah, pesanGagal: pesanSimpanGagal(error.message) };
    return { masuk: siap.length, salah, pesanGagal: null };
  }

  // Bagan akun tidak pernah lewat jalur ini — lihat prosesImporAkun (pratinjau + RPC atomik).
  return { masuk: 0, salah: [] as BarisSalah[], pesanGagal: "Impor bagan akun wajib lewat pratinjau. Muat ulang halaman impor akun." };
}

export async function imporMaster(formData: FormData) {
  const jenisTeks = String(formData.get("jenis") ?? "");
  if (!isJenisImpor(jenisTeks)) redirect("/pengaturan?error=" + encodeURIComponent("Jenis impor tidak dikenal"));
  const jenis = jenisTeks as JenisImpor;
  const konfig = KONFIG[jenis];
  const back = `/pengaturan/impor/${jenis}`;

  const gagal = (pesan: string): never => redirect(`${back}?error=${encodeURIComponent(pesan)}`);
  // Bagan akun hanya lewat pratinjau + simpan atomik (prosesImporAkun); jangan pernah tulis langsung.
  if (jenis === "akun") gagal("Impor bagan akun wajib lewat pratinjau. Muat ulang halaman impor akun.");
  const supabase = await assertBoleh(back);

  const isi = String(formData.get("csv") ?? "");
  if (!isi.trim()) gagal("Belum ada file atau isian CSV.");

  const dibaca = bacaCsvUmum(isi, konfig.kolom, konfig.wajib);
  if (!dibaca.ok) gagal(dibaca.pesan);

  const { masuk, salah, pesanGagal } = await simpan(supabase, jenis, dibaca);
  if (pesanGagal) gagal(pesanGagal);

  // Tidak ada satu pun baris yang bisa masuk — kembalikan daftar masalahnya utuh,
  // jangan "berhasil 0" yang bikin pemakai kira filenya sudah beres.
  if (masuk === 0) gagal(`Tidak ada baris yang bisa disimpan. ${ringkasSalah(salah)}`);

  const label = { akun: "akun", komisi: "aturan komisi", target: "target" }[jenis as string] ?? jenis;
  const pesan = salah.length === 0
    ? `${masuk} ${label} berhasil diimpor.`
    : `${masuk} ${label} diimpor, ${salah.length} baris dilewati — ${ringkasSalah(salah)}`;

  redirect(`${konfig.kembali}${konfig.kembali.includes("?") ? "&" : "?"}success=${encodeURIComponent(pesan)}`);
}

// ── Bagan akun: pratinjau lengkap, lalu simpan atomik lewat satu RPC ─────────────

export type HasilImporAkun = {
  langkah: "awal" | "pratinjau" | "tersimpan" | "gagal";
  pesan: string | null;
  rencana: Omit<RencanaImporAkun, "kirim"> | null;
  /** Pratinjau format file COA pengguna (Kode/Nama Akun/Normal) — tidak pernah bisa disimpan. */
  coaPengguna: RencanaCoaPenggunaOk | null;
  /** SHA-256 isi file yang dipratinjau; simpan ditolak bila isinya sudah lain. */
  sha: string | null;
  /** Sidik jari bagan akun saat pratinjau; simpan ditolak bila sudah berubah. */
  versi: string | null;
};

const TANPA_HAK_AKUN = "Hanya OWNER/ADMIN aktif yang boleh mengimpor bagan akun.";
const sha256 = (isi: string | Uint8Array) => createHash("sha256").update(isi).digest("hex");
const GAGAL_BACA_AKUN = "Daftar akun KAMO gagal dibaca, jadi pratinjau belum bisa dibuat (bukan berarti bagan akun kosong). Coba lagi sebentar lagi.";

function bacaKonteksAkun(data: unknown): KonteksImporAkun | null {
  const d = data as Partial<KonteksImporAkun> | null;
  if (!d || typeof d.versi !== "string" || !Array.isArray(d.akun) || !d.pemakaian || typeof d.pemakaian !== "object") return null;
  return d as KonteksImporAkun;
}

/** Pesan penolakan dari import_coa_accounts (COA_IMPORT_*: …); pesan teknis lain tidak ditampilkan. */
function pesanTolakAkun(error: { message?: string } | null): string | null {
  const m = /COA_IMPORT_[A-Z_]+: ([^\n]+)/.exec(String(error?.message ?? ""));
  return m ? m[1].trim() : null;
}

/**
 * Satu aksi untuk dua langkah: "periksa" membuat pratinjau, "simpan" membuat ulang pratinjau di
 * server dari isi file yang sama (tidak ada data/flag klien yang dipercaya), lalu memanggil RPC.
 */
export async function prosesImporAkun(_prev: HasilImporAkun, formData: FormData): Promise<HasilImporAkun> {
  const tanpaRencana = { rencana: null, coaPengguna: null, sha: null, versi: null };
  const supabase = await klienMasterAdmin();
  if (!supabase) return { langkah: "gagal", pesan: TANPA_HAK_AKUN, ...tanpaRencana };

  const pemetaan = pemetaanAkun(String(formData.get("sumber") ?? "kamo"));
  if (!pemetaan) return { langkah: "gagal", pesan: "Format file belum didukung.", ...tanpaRencana };
  const csv = String(formData.get("csv") ?? "");
  const berkas = formData.get("berkas");
  const xlsx = berkas instanceof File && berkas.size > 0 && /\.xlsx$/i.test(berkas.name) ? berkas : null;

  const bacaKonteks = async () => {
    const { data, error } = await supabase.rpc("read_coa_import_context");
    return error ? null : bacaKonteksAkun(data);
  };

  // Format yang strukturnya sudah ditinjau tetapi belum lengkap: pratinjau saja, simpan dimatikan di
  // server (apa pun yang dikirim klien), tidak ada RPC tulis yang pernah dipanggil.
  if (pemetaan.jenis === "terblokir") {
    let tabel: TabelSumber;
    let sha: string;
    if (xlsx) {
      if (xlsx.size > BATAS_XLSX_AKUN) return { langkah: "gagal", pesan: "File Excel lebih dari 2 MB.", ...tanpaRencana };
      const bytes = new Uint8Array(await xlsx.arrayBuffer());
      const t = await bacaTabelXlsx(bytes, pemetaan);
      if (!t.ok) return { langkah: "gagal", pesan: t.pesan, ...tanpaRencana };
      tabel = t.tabel; sha = sha256(bytes);
    } else if (csv.trim()) {
      tabel = bacaTabelCsv(csv); sha = sha256(csv);
    } else {
      return { langkah: "gagal", pesan: "Belum ada file .xlsx atau isian CSV.", ...tanpaRencana };
    }
    const ctx = await bacaKonteks();
    if (!ctx) return { langkah: "gagal", pesan: GAGAL_BACA_AKUN, ...tanpaRencana };
    const r = rencanakanCoaPengguna(tabel, pemetaan, ctx);
    if (!r.ok) return { langkah: "gagal", pesan: r.pesan, ...tanpaRencana };
    const hasil: HasilImporAkun = { langkah: "pratinjau", pesan: null, rencana: null, coaPengguna: r, sha, versi: ctx.versi };
    if (formData.get("langkah") !== "simpan") return hasil;
    return {
      ...hasil,
      pesan: `Format ${pemetaan.label} belum bisa disimpan: kelompok, induk dan header/posting belum punya keputusan ` +
        `pemetaan yang disetujui, dan ${r.jumlah.ditahan} baris kode kembar ditahan. Tidak ada yang disimpan.`,
    };
  }

  if (xlsx) {
    return {
      langkah: "gagal", ...tanpaRencana,
      pesan: "Template KAMO dibaca dari CSV (Excel → Save As → CSV). File .xlsx hanya didukung untuk format file COA pengguna.",
    };
  }
  if (!csv.trim()) return { langkah: "gagal", pesan: "Belum ada file atau isian CSV.", ...tanpaRencana };
  const file = bacaFileAkun(csv, pemetaan);
  if (!file.ok) return { langkah: "gagal", pesan: file.pesan, ...tanpaRencana };

  const ctx = await bacaKonteks();
  if (!ctx) return { langkah: "gagal", pesan: GAGAL_BACA_AKUN, ...tanpaRencana };

  const { kirim, ...rencana } = rencanakanImporAkun(file, ctx);
  const sha = sha256(csv);
  const pratinjau = (pesan: string | null): HasilImporAkun =>
    ({ langkah: "pratinjau", pesan, rencana, coaPengguna: null, sha, versi: ctx.versi });
  if (formData.get("langkah") !== "simpan") return pratinjau(null);

  if (String(formData.get("sha") ?? "") !== sha) {
    return pratinjau("Isi file berubah sejak pratinjau. Tinjau pratinjau terbaru di bawah, lalu simpan lagi.");
  }
  if (String(formData.get("versi") ?? "") !== ctx.versi) {
    return pratinjau("Bagan akun sudah berubah sejak pratinjau dibuat. Tinjau pratinjau terbaru di bawah, lalu simpan lagi.");
  }
  if (!rencana.bolehSimpan) {
    return pratinjau(rencana.jumlah.ditolak + rencana.jumlah.konflik > 0
      ? "Masih ada baris ditolak atau konflik — tidak ada yang disimpan. Perbaiki file, lalu periksa ulang."
      : "Tidak ada akun baru atau perubahan untuk disimpan.");
  }
  if (rencana.perluKonfirmasi && formData.get("konfirmasi") !== "1") {
    return pratinjau(`Centang konfirmasi dulu untuk menerapkan ${rencana.jumlah.berubah} perubahan pada akun yang sudah ada.`);
  }

  const { data: hasil, error: gagal } = await supabase.rpc("import_coa_accounts", { p_rows: kirim, p_version: ctx.versi });
  if (gagal) {
    return {
      langkah: "gagal", rencana, coaPengguna: null, sha, versi: ctx.versi,
      pesan: `Impor gagal — tidak ada akun yang tersimpan. ${pesanTolakAkun(gagal) ?? "Coba lagi; bila berulang, laporkan ke admin sistem."}`,
    };
  }
  revalidatePath("/keuangan/coa");
  const jumlah = (hasil ?? {}) as { dibuat?: number; diubah?: number };
  return {
    langkah: "tersimpan", rencana, coaPengguna: null, sha, versi: null,
    pesan: `${jumlah.dibuat ?? 0} akun baru dibuat, ${jumlah.diubah ?? 0} akun diubah. Tidak ada saldo atau jurnal yang dibuat.`,
  };
}
