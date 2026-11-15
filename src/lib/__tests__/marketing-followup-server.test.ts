import { describe, expect, it } from "vitest";
import { bolehBukaPath } from "../akses";
import { FILTER_AWAL, HALAMAN_FOLLOWUP, ID_SUBMENU_FOLLOWUP, type BarisFollowUp } from "../marketing-followup";
import { barisExcelFollowUp, catatDihubungi, muatDaftarMarketing, muatKartuMarketing, periksaAksesMarketing, pesanGalatMarketing } from "../marketing-followup-server";
import { SUBMENU_ENTRIES, submenuIzinkan, submenuOfPath } from "../submenu-access";

type Opsi = {
  role?: string; aktif?: boolean; user?: boolean; rules?: { role: string; module_id: string }[]; policy?: unknown; policyError?: boolean;
  boleh?: unknown; bolehError?: boolean; daftar?: unknown; daftarError?: { code?: string; message?: string }; ringkas?: unknown; catat?: unknown; catatError?: { message: string };
};
function klien(o: Opsi = {}) {
  const panggilan: { nama: string; args?: unknown }[] = [];
  const role = o.role ?? "OWNER";
  return {
    panggilan,
    auth: { getUser: async () => ({ data: { user: o.user === false ? null : { id: "u1" } }, error: null }) },
    from(tabel: string) {
      panggilan.push({ nama: `from:${tabel}` });
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { role, is_active: o.aktif ?? true }, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: o.rules ?? [], error: null }).then(res),
      };
      return q;
    },
    rpc: async (nama: string, args?: unknown) => {
      panggilan.push({ nama: `rpc:${nama}`, args });
      if (nama === "get_my_submenu_policy") return o.policyError ? { data: null, error: { code: "XX000", message: "boom" } } : { data: o.policy ?? [], error: null };
      if (nama === "marketing_followup_allowed") return o.bolehError ? { data: null, error: { message: "x" } } : { data: o.boleh ?? true, error: null };
      if (nama === "marketing_followup_daftar") return o.daftarError ? { data: null, error: o.daftarError } : { data: o.daftar, error: null };
      if (nama === "marketing_followup_ringkas") return o.daftarError ? { data: null, error: o.daftarError } : { data: o.ringkas, error: null };
      if (nama === "marketing_log_contact") return o.catatError ? { data: null, error: o.catatError } : { data: o.catat ?? { already_applied: false }, error: null };
      return { data: null, error: { code: "42883" } };
    },
  };
}
const nama = (c: ReturnType<typeof klien>) => c.panggilan.map(p => p.nama);
const adminCrm = [{ role: "ADMIN", module_id: "crm" }];

describe("periksaAksesMarketing: siapa yang boleh", () => {
  it("OWNER selalu boleh dan tidak membaca kebijakan atau fungsi izin; boleh unduh", async () => {
    const c = klien({ role: "OWNER", policyError: true, bolehError: true });
    expect(await periksaAksesMarketing(c)).toEqual({ ok: true, role: "OWNER", bolehUnduh: true });
    expect(nama(c)).not.toContain("rpc:marketing_followup_allowed");
    expect(nama(c)).not.toContain("rpc:get_my_submenu_policy");
  });
  it("ADMIN dengan sub-menu dicentang: boleh dan boleh unduh", async () => {
    const policy = [{ role: "ADMIN", module_id: "crm", allowed: ["crm.pelanggan", ID_SUBMENU_FOLLOWUP] }];
    expect(await periksaAksesMarketing(klien({ role: "ADMIN", rules: adminCrm, policy }))).toEqual({ ok: true, role: "ADMIN", bolehUnduh: true });
  });
  it("ADMIN yang CRM-nya dipilih satu-satu tanpa sub-menu ini: ditolak (halaman dan unduhan)", async () => {
    const policy = [{ role: "ADMIN", module_id: "crm", allowed: ["crm.pelanggan", "crm.kategori-pelanggan"] }];
    const c = klien({ role: "ADMIN", rules: adminCrm, policy });
    expect((await periksaAksesMarketing(c)).ok).toBe(false);
    expect(nama(c)).not.toContain("rpc:marketing_followup_allowed");
  });
  it("peran tanpa modul CRM ditolak walau fungsi database mengizinkan", async () => {
    expect((await periksaAksesMarketing(klien({ role: "STAFF", rules: [], boleh: true }))).ok).toBe(false);
  });
  it("modul CRM terbuka penuh (tanpa kebijakan) TIDAK cukup: fungsi izin database harus mengiyakan (bawaan mati)", async () => {
    expect((await periksaAksesMarketing(klien({ role: "ADMIN", rules: adminCrm, policy: [], boleh: false }))).ok).toBe(false);
    expect((await periksaAksesMarketing(klien({ role: "ADMIN", rules: adminCrm, policy: [], boleh: true }))).ok).toBe(true);
    expect((await periksaAksesMarketing(klien({ role: "ADMIN", rules: adminCrm, policy: [], boleh: "true" }))).ok).toBe(false);
  });
  it("peran selain OWNER/ADMIN yang diberi izin boleh melihat tetapi tidak boleh unduh Excel", async () => {
    const policy = [{ role: "STAFF", module_id: "crm", allowed: [ID_SUBMENU_FOLLOWUP] }];
    expect(await periksaAksesMarketing(klien({ role: "STAFF", rules: [{ role: "STAFF", module_id: "crm" }], policy }))).toEqual({ ok: true, role: "STAFF", bolehUnduh: false });
  });
  it("gagal tertutup: kebijakan tak terbaca, fungsi izin galat, akun nonaktif, tanpa sesi", async () => {
    const policy = [{ role: "ADMIN", module_id: "crm", allowed: [ID_SUBMENU_FOLLOWUP] }];
    expect((await periksaAksesMarketing(klien({ role: "ADMIN", rules: adminCrm, policyError: true }))).ok).toBe(false);
    expect((await periksaAksesMarketing(klien({ role: "ADMIN", rules: adminCrm, policy, bolehError: true }))).ok).toBe(false);
    expect((await periksaAksesMarketing(klien({ role: "OWNER", aktif: false }))).ok).toBe(false);
    expect((await periksaAksesMarketing(klien({ user: false }))).ok).toBe(false);
  });
});

describe("pendaftaran sub-menu Akses Grup", () => {
  it("terdaftar di modul CRM, memetakan /crm/follow-up, dan tidak bentrok dengan halaman lain", () => {
    const e = SUBMENU_ENTRIES.find(x => x.id === ID_SUBMENU_FOLLOWUP)!;
    expect(e).toMatchObject({ module: "crm", routes: [HALAMAN_FOLLOWUP], label: "Follow up pelanggan" });
    expect(submenuOfPath("/crm/follow-up/unduh")?.id).toBe(ID_SUBMENU_FOLLOWUP);
    expect(submenuOfPath("/crm/pelanggan")?.id).toBe("crm.pelanggan");
  });
  it("kebijakan CRM yang tidak mencantumkannya menutup halaman dan unduhan; mencantumkannya membuka", () => {
    expect(submenuIzinkan("crm", "/crm/follow-up", ["crm.pelanggan"])).toBe(false);
    expect(submenuIzinkan("crm", "/crm/follow-up/unduh", ["crm.pelanggan"])).toBe(false);
    expect(submenuIzinkan("crm", "/crm/follow-up", [ID_SUBMENU_FOLLOWUP])).toBe(true);
    const rules = [{ role: "ADMIN", module_id: "crm", submenus: ["crm.pelanggan"] }];
    expect(bolehBukaPath("ADMIN", "/crm/follow-up", rules as never)).toBe(false);
    expect(bolehBukaPath("ADMIN", "/crm/follow-up", [{ role: "ADMIN", module_id: "crm", submenus: [ID_SUBMENU_FOLLOWUP] }] as never)).toBe(true);
    expect(bolehBukaPath("ADMIN", "/crm/follow-up", [{ role: "ADMIN", module_id: "crm" }] as never)).toBe(true); // modul terbuka penuh: izin database tetap diperiksa terpisah
  });
});

const DAFTAR = { tab: "lama", hari_ini: "2026-11-15", total: 0, belum: 0, sudah: 0, bucket: { "60": 0, "90": 0, "180": 0 }, cabang: [], tanpa_nomor: 0,
  dikecualikan: { kunjungan_belum_selesai: 0, hewan_tiada: 0, disembunyikan: 0 }, baris: [] };

describe("muatDaftarMarketing", () => {
  it("meneruskan saringan apa adanya ke satu fungsi database (cabang kosong = p_cabang_kosong)", async () => {
    const c = klien({ daftar: DAFTAR });
    await muatDaftarMarketing(c, { ...FILTER_AWAL, tab: "grooming", interval: 45, depan: 3, status: "sudah", cari: "bud", cabang: "kosong", cooldown: 30 });
    const p = c.panggilan.find(x => x.nama === "rpc:marketing_followup_daftar")!.args;
    expect(p).toEqual({ p_tab: "grooming", p_hari: 90, p_cabang: null, p_cabang_kosong: true, p_status: "sudah", p_cari: "bud", p_interval: 45, p_depan: 3, p_cooldown: 30, p_limit: 200 });
    const uuid = "3c9fa638-c99d-4bb7-925b-e28b6bdb4564";
    const d = klien({ daftar: DAFTAR });
    await muatDaftarMarketing(d, { ...FILTER_AWAL, cabang: uuid }, { limit: 500 });
    expect(d.panggilan[0].args).toMatchObject({ p_cabang: uuid, p_cabang_kosong: false, p_cari: null, p_limit: 500 });
  });
  it("galat: fungsi belum terpasang, ditolak, bentuk tak dikenal", async () => {
    await expect(muatDaftarMarketing(klien({ daftarError: { code: "PGRST202" } }), FILTER_AWAL)).rejects.toThrow("belum terpasang");
    await expect(muatDaftarMarketing(klien({ daftarError: { message: "MARKETING_DITOLAK: x" } }), FILTER_AWAL)).rejects.toThrow("belum diberi akses");
    await expect(muatDaftarMarketing(klien({ daftarError: { code: "XX000", message: "stack rahasia" } }), FILTER_AWAL)).rejects.toThrow("Daftar belum dapat dimuat");
    await expect(muatDaftarMarketing(klien({ daftar: { baris: [] } }), FILTER_AWAL)).rejects.toThrow("belum dapat dibaca lengkap");
  });
});

describe("catatDihubungi", () => {
  const dasar = { customerId: "c1", petId: null, tab: "lama" as const, cabangId: "b1", hasil: "Tertarik", catatan: "  minta jadwal  ", kunci: "k1" };
  it("memetakan ke RPC marketing_log_contact: jenis dari tab, catatan dirapikan, kunci anti-dobel", async () => {
    const c = klien({ catat: { already_applied: true } });
    expect(await catatDihubungi(c, dasar)).toEqual({ ok: true, sudahAda: true });
    expect(c.panggilan[0].args).toEqual({ p_customer_id: "c1", p_pet_id: null, p_jenis: "lama_tidak_balik", p_branch_id: "b1", p_hasil: "Tertarik", p_catatan: "minta jadwal", p_request_key: "k1" });
    const g = klien();
    await catatDihubungi(g, { ...dasar, tab: "grooming", petId: "p1", catatan: "  " });
    expect(g.panggilan[0].args).toMatchObject({ p_jenis: "grooming", p_pet_id: "p1", p_catatan: null });
  });
  it("isian tidak sah ditolak sebelum menyentuh database; galat database diterjemahkan tanpa membocorkan teks mentah", async () => {
    const c = klien();
    expect(await catatDihubungi(c, { ...dasar, hasil: "" })).toEqual({ ok: false, pesan: "Pilih hasil menghubungi." });
    expect(await catatDihubungi(c, { ...dasar, catatan: "x".repeat(501) })).toEqual({ ok: false, pesan: "Catatan maksimal 500 huruf." });
    expect(c.panggilan).toEqual([]);
    const r = await catatDihubungi(klien({ catatError: { message: "MARKETING_DITOLAK: hanya Owner ... password=abc" } }), dasar);
    expect(r).toMatchObject({ ok: false }); expect(JSON.stringify(r)).not.toContain("password");
    expect(pesanGalatMarketing("MARKETING_CABANG_DITOLAK: x")).toContain("Cabang");
    expect(pesanGalatMarketing("sesuatu yang aneh")).toContain("Muat ulang");
  });
});

describe("muatKartuMarketing (kartu dashboard)", () => {
  it("tanpa akses: null dan tidak memanggil fungsi ringkas", async () => {
    const c = klien({ role: "ADMIN", rules: adminCrm, policy: [{ role: "ADMIN", module_id: "crm", allowed: ["crm.pelanggan"] }] });
    expect(await muatKartuMarketing(c)).toBeNull();
    expect(nama(c)).not.toContain("rpc:marketing_followup_ringkas");
  });
  it("OWNER: tiga angka belum dihubungi", async () => {
    expect(await muatKartuMarketing(klien({ ringkas: { lama: 1045, grooming: 79, hari_ini: 4, baru: 125 } }))).toEqual({ lama: 1045, grooming: 79, hariIni: 4 });
  });
  it("galat apa pun menjadi kartu galat (dashboard tidak jatuh)", async () => {
    expect(await muatKartuMarketing(klien({ daftarError: { code: "XX000" } }))).toEqual({ galat: "Daftar belum dapat dimuat. Muat ulang sebentar lagi." });
    expect(await muatKartuMarketing(klien({ ringkas: { lama: "x" } }))).toEqual({ galat: "Angka follow up belum dapat dibaca." });
  });
});

describe("barisExcelFollowUp", () => {
  const b = (o: Partial<BarisFollowUp>): BarisFollowUp => ({
    customer_id: "c", pet_id: null, nama: "=HYPERLINK(\"http://x\")", hp: "+62 812-0000-0014", wa: "6281200000014", hewan: ["@Mochi"], hewan_total: 1, cabang_id: null, cabang: null,
    terakhir: "2026-08-01T03:00:00Z", jenis_terakhir: "Klinik", total_belanja: 1234.6, kunjungan: 3, hari: 106, sumber: null, jadwal: null, groomer: null, item: null,
    dihubungi: { at: "2026-11-14T03:00:00Z", hasil: "Nanti", catatan: "-awas", oleh: "Uji", sudah: true, hari_lalu: 1 }, ...o,
  });
  it("sel teks berawalan = + - @ diberi tanda petik; angka tetap angka; tanpa cabang diberi label", () => {
    const r = barisExcelFollowUp(b({}));
    expect(r[0]).toBe("Tanpa cabang (riwayat impor)");
    expect(r[1]).toBe("'=HYPERLINK(\"http://x\")"); expect(r[2]).toBe("'@Mochi"); expect(r[3]).toBe("'+62 812-0000-0014");
    expect(r[4]).toBe("2026-08-01"); expect(r[7]).toBe(1235); expect(r[8]).toBe(3);
    expect(r[10]).toBe("Sudah dihubungi"); expect(r[12]).toBe("'-awas");
  });
  it("hari ini: ringkasan jadwal; belum dihubungi", () => {
    const r = barisExcelFollowUp(b({ dihubungi: null, terakhir: null, jadwal: "2026-11-15", item: [{ jenis: "Kontrol", tanggal: "2026-11-15", catatan: "cek luka", hewan: "Aa" }], jenis_terakhir: null }));
    expect(r[4]).toBe("2026-11-15"); expect(r[9]).toBe("Kontrol 2026-11-15 (Aa): cek luka"); expect(r[10]).toBe("Belum dihubungi"); expect(r[11]).toBe("");
  });
});
