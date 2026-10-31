import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Driven by scripts/test-coa-import-postgres.py: a throwaway native PostgreSQL with ALL repository
// migrations. Only the transport is adapted — every query/RPC runs as role `authenticated` with a
// fictional JWT; no business rule, table result or RPC outcome is mocked.
const env = process.env;
const native = vi.hoisted(() => ({ user: "" }));
const q = (s: unknown) => "'" + String(s).replaceAll("'", "''") + "'";

function psql(source: string, asUser: boolean) {
  const prefix = asUser
    ? `set role authenticated;select set_config('request.jwt.claims',${q(JSON.stringify({ sub: native.user, role: "authenticated" }))},false);`
    : "";
  return execFileSync(env.KAMO_TEST_PSQL!, ["-X", "-qAt", "-h", env.KAMO_TEST_SOCKET!, "-U", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: prefix + source, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sqlJson = (source: string) => JSON.parse(psql(source, true).split("\n").at(-1)!);
/** Test-owner statements (fault injection, readback); never used by the action under test. */
const admin = (source: string) => psql(source, false).split("\n").at(-1) ?? "";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: native.user ? { id: native.user } : null } }) },
  from(table: string) {
    let fields = "*"; const where: string[] = [];
    const run = (single: boolean) => {
      try {
        const data = sqlJson(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select ${fields} from public.${table}${where.length ? " where " + where.join(" and ") : ""}) r;`);
        return { data: single ? data[0] ?? null : data, error: null };
      } catch (error) { return { data: null, error: { message: String(error) } }; }
    };
    const chain = {
      select: (cols: string) => { fields = cols; return chain; },
      eq: (col: string, value: string) => { where.push(`${col}=${q(value)}`); return chain; },
      maybeSingle: async () => run(true),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(run(false)).then(resolve),
    };
    return chain;
  },
  rpc: async (name: string, params: Record<string, unknown> = {}) => {
    const args = Object.entries(params).map(([k, v]) =>
      `${k} => ${typeof v === "string" ? q(v) + "::text" : q(JSON.stringify(v)) + "::jsonb"}`).join(",");
    try { return { data: sqlJson(`select to_jsonb(public.${name}(${args}));`), error: null }; }
    catch (error) { return { data: null, error: { message: String(error).split("\n").find((l) => l.includes("ERROR:")) ?? String(error) } }; }
  },
}) }));

import { prosesImporAkun, type HasilImporAkun } from "@/app/(app)/pengaturan/impor/actions";

const FIXTURE = readFileSync(new URL("../../../supabase/tests/fixtures/coa-impor-kamo-fiktif.csv", import.meta.url), "utf8");
const AWAL: HasilImporAkun = { langkah: "awal", pesan: null, rencana: null, coaPengguna: null, sha: null, versi: null };

function form(csv: string, langkah: "periksa" | "simpan", extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set("csv", csv); f.set("langkah", langkah); f.set("sumber", "kamo");
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}
async function periksa(csv: string) { return prosesImporAkun(AWAL, form(csv, "periksa")); }
async function simpan(csv: string, p: HasilImporAkun, extra: Record<string, string> = {}) {
  return prosesImporAkun(p, form(csv, "simpan", { sha: p.sha ?? "", versi: p.versi ?? "", ...extra }));
}
const jumlahAkun = () => Number(admin("select count(*) from public.coa_accounts;"));
const uang = () => admin("select (select count(*) from public.journal_entries)||'/'||(select count(*) from public.journal_lines);");
const ada = (kode: string) => admin(`select count(*) from public.coa_accounts where code=${q(kode)};`) === "1";

const live = !!env.KAMO_TEST_SOCKET;

describe.skipIf(!live)("COA import: parser → preview → real action → real writer → readback", () => {
  it("denies STAFF, DOCTOR, FINANCE and an inactive ADMIN before reading or writing", async () => {
    const before = jumlahAkun();
    for (const user of [env.KAMO_TEST_STAFF, env.KAMO_TEST_DOCTOR, env.KAMO_TEST_FINANCE, env.KAMO_TEST_ADMIN_NONAKTIF]) {
      native.user = user!;
      const p = await periksa(FIXTURE);
      expect(p.rencana).toBeNull();
      expect(p.pesan).toMatch(/OWNER\/ADMIN/);
      const s = await simpan(FIXTURE, { ...p, sha: "x", versi: "y" });
      expect(s.langkah).not.toBe("tersimpan");
    }
    expect(jumlahAkun()).toBe(before);
  });

  it("a failed account-list read is an error, never an empty list", async () => {
    native.user = env.KAMO_TEST_OWNER!;
    admin("revoke execute on function public.read_coa_import_context() from authenticated;");
    try {
      const p = await periksa(FIXTURE);
      expect(p.langkah).toBe("gagal");
      expect(p.rencana).toBeNull();
      expect(p.pesan).toMatch(/gagal dibaca/);
    } finally {
      admin("grant execute on function public.read_coa_import_context() to authenticated;");
    }
  });

  it("OWNER imports the pinned fictional KAMO-template file atomically and reads it back exactly", async () => {
    expect(createHash("sha256").update(FIXTURE).digest("hex")).toBe("0157ac9570bed5208e4c36c2326c8086d88393ccddfbf28398885da5e2dff663");
    native.user = env.KAMO_TEST_OWNER!;
    const before = jumlahAkun(); const money = uang();
    const p = await periksa(FIXTURE);
    expect(p.pesan).toBeNull();
    expect(p.rencana!.jumlah).toEqual({ total: 12, baru: 12, sama: 0, berubah: 0, konflik: 0, ditolak: 0 });
    expect(p.rencana!.bolehSimpan).toBe(true);
    const s = await simpan(FIXTURE, p);
    expect(s.langkah).toBe("tersimpan");
    expect(s.pesan).toMatch(/12 akun baru/);
    expect(jumlahAkun()).toBe(before + 12);
    expect(uang()).toBe(money); // master import never creates journals/balances
    const rows = admin(`select string_agg(c.code||':'||coalesce(p.code,'-')||':'||c.is_header::text||':'||c.normal_balance, ',' order by c.code)
      from public.coa_accounts c left join public.coa_accounts p on p.id=c.parent_id
      where c.code in ('190000','191000','191100','330000','330100','540000','540100','540200','770000','770100','770200','770301');`);
    expect(rows).toBe([
      "190000:-:true:D", "191000:190000:false:D", "191100:190000:false:D", "330000:-:true:K", "330100:330000:false:K",
      "540000:-:true:K", "540100:540000:false:K", "540200:540000:false:K", "770000:-:true:D", "770100:770000:false:D",
      "770200:770000:false:D", "770301:770000:false:D",
    ].join(","));
  });

  it("ADMIN re-uploading the same file sees duplicates only and nothing is written", async () => {
    native.user = env.KAMO_TEST_ADMIN!;
    const before = jumlahAkun();
    const p = await periksa(FIXTURE);
    expect(p.rencana!.jumlah).toMatchObject({ total: 12, sama: 12, baru: 0 });
    expect(p.rencana!.bolehSimpan).toBe(false);
    const s = await simpan(FIXTURE, p);
    expect(s.langkah).not.toBe("tersimpan");
    expect(jumlahAkun()).toBe(before);
  });

  it("changes are shown as a diff and only applied after explicit confirmation", async () => {
    native.user = env.KAMO_TEST_OWNER!;
    const csv = "kode,nama,tipe,induk\n770100,Beban Laundry Kandang Fiktif Baru,BEBAN,770000";
    const p = await periksa(csv);
    expect(p.rencana!.baris[0]).toMatchObject({ status: "berubah", perubahan: [{ kolom: "nama", lama: "Beban Laundry Kandang Fiktif", baru: "Beban Laundry Kandang Fiktif Baru" }] });
    const tanpa = await simpan(csv, p);
    expect(tanpa.langkah).not.toBe("tersimpan");
    expect(tanpa.pesan).toMatch(/konfirmasi/i);
    expect(admin("select name from public.coa_accounts where code='770100';")).toBe("Beban Laundry Kandang Fiktif");
    const ok = await simpan(csv, p, { konfirmasi: "1" });
    expect(ok.langkah).toBe("tersimpan");
    expect(admin("select name from public.coa_accounts where code='770100';")).toBe("Beban Laundry Kandang Fiktif Baru");
  });

  it("conflicting and wrong rows block the whole file; codes are never rewritten", async () => {
    native.user = env.KAMO_TEST_OWNER!;
    const before = jumlahAkun();
    const csv = [
      "kode,nama,tipe,induk,header",
      "01101,Kas Nol Depan Fiktif,ASET,,",
      "110003.01,Kas Titik Fiktif,ASET,,",
      "780100,Beban Kelompok Salah,ASET,,",
      "781000,Anak Tanpa Induk,BEBAN,789900,",
      "782100,Beban Di Bawah Pendapatan,BEBAN,540000,",
      "789100,Akun Baik,BEBAN,,",
    ].join("\n");
    const p = await periksa(csv);
    expect(p.rencana!.jumlah).toMatchObject({ total: 6, konflik: 3, ditolak: 2, baru: 1 });
    expect(p.rencana!.baris.map((b) => b.kode)).toEqual(["01101", "110003.01", "780100", "781000", "782100", "789100"]);
    const s = await simpan(csv, p);
    expect(s.langkah).not.toBe("tersimpan");
    expect(jumlahAkun()).toBe(before);
    expect(ada("01101")).toBe(false);
    expect(ada("110003.01")).toBe(false);
    expect(ada("789100")).toBe(false);
  });

  it("a stale preview or an edited file after preview is refused", async () => {
    native.user = env.KAMO_TEST_OWNER!;
    const csv = "kode,nama,tipe\n789500,Beban Pratinjau Basi,BEBAN";
    const p = await periksa(csv);
    expect(p.rencana!.bolehSimpan).toBe(true);
    const edited = await simpan(csv + "\n789600,Beban Selundupan,BEBAN", p);
    expect(edited.langkah).not.toBe("tersimpan");
    expect(ada("789600")).toBe(false);
    admin("insert into public.coa_accounts(code,name,type,normal_balance) values('789700','Beban Sesi Lain','BEBAN','D');");
    const stale = await simpan(csv, p);
    expect(stale.langkah).not.toBe("tersimpan");
    expect(stale.pesan).toMatch(/berubah/);
    expect(ada("789500")).toBe(false);
  });

  it("user COA file (Kode/Nama Akun/Normal, synthetic .xlsx): full preview from the real chart, save refused, nothing written", async () => {
    native.user = env.KAMO_TEST_OWNER!;
    const xlsx = readFileSync(new URL("../../../supabase/tests/fixtures/coa-pengguna-sintetis.xlsx", import.meta.url));
    expect(createHash("sha256").update(xlsx).digest("hex")).toBe("cc7d84f77dbd40693f60d5b04ba4f47f4baf3736e9d50822dbd6a4144ee703ff");
    const f = (langkah: string, extra: Record<string, string> = {}) => {
      const d = new FormData();
      d.set("sumber", "pengguna-kode-nama-normal"); d.set("langkah", langkah); d.set("csv", "");
      d.set("berkas", new File([new Uint8Array(xlsx)], "COA.xlsx"));
      for (const [k, v] of Object.entries(extra)) d.set(k, v);
      return d;
    };
    const before = jumlahAkun(); const money = uang();
    const p = await prosesImporAkun(AWAL, f("periksa"));
    expect(p.pesan).toBeNull();
    expect(p.coaPengguna!.jumlah).toEqual({ totalData: 204, menunggu_pemetaan: 177, sudah_ada: 0, ditahan: 27, konflik: 0, ditolak: 0 });
    expect(p.coaPengguna!.kodeUnik).toBe(179);
    expect(p.coaPengguna!.barisJudul).toBe(4);
    const s = await prosesImporAkun(p, f("simpan", { konfirmasi: "1", sha: p.sha!, versi: p.versi! }));
    expect(s.langkah).not.toBe("tersimpan");
    expect(s.pesan).toMatch(/belum bisa disimpan/);
    expect(jumlahAkun()).toBe(before);
    expect(uang()).toBe(money);
    // 110001/120001 are part of the new chart of accounts (20261105010000); the file's own rows were not written.
    expect(admin("select count(*) from public.coa_accounts where code in ('110101','510101');")).toBe("0");
  });

  it("a failure at the final parent-linking stage leaves nothing behind and is reported as failed", async () => {
    native.user = env.KAMO_TEST_OWNER!;
    const csv = "kode,nama,tipe,induk,header\n779000,Induk Gagal Akhir,BEBAN,,ya\n779100,Anak Gagal Akhir,BEBAN,779000,";
    const before = jumlahAkun();
    const p = await periksa(csv);
    expect(p.rencana!.bolehSimpan).toBe(true);
    // Fault injection only (not a business rule): the last write step fails.
    admin(`create function public.uji_gagal_tautan_induk() returns trigger language plpgsql as $$begin
      if new.code='779100' and new.parent_id is not null then raise exception 'injected parent-link failure'; end if; return new; end$$;
      create trigger uji_gagal_tautan_induk before update on public.coa_accounts for each row execute function public.uji_gagal_tautan_induk();`);
    try {
      const s = await simpan(csv, p);
      expect(s.langkah).toBe("gagal");
      expect(s.pesan).toMatch(/tidak ada akun yang tersimpan/i);
    } finally {
      admin("drop trigger uji_gagal_tautan_induk on public.coa_accounts; drop function public.uji_gagal_tautan_induk();");
    }
    expect(jumlahAkun()).toBe(before);
    expect(ada("779000")).toBe(false);
  });
});
