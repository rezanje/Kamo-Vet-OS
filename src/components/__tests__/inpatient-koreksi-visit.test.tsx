// @vitest-environment jsdom
// A5 (meeting 12 Nov 2026): koreksi visit rawat inap — aksi server (alasan wajib, jalur RPC koreksi, kunci setelah pulang)
// dan layar (form koreksi tanpa obat/ubah kondisi, edit setelah pulang, paramedis terkunci).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { name: string; args: Record<string, unknown> };
const fx = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  rec: { condition_status: "stabil", visit_id: "visit", medical_record_id: "record", discharged_at: null as string | null } as Record<string, unknown>,
  log: null as Record<string, unknown> | null,
  allowed: true as boolean | null,
  role: "STAFF",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), redirect: (href: string) => { throw Error(`REDIRECT ${href}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    fx.calls.push({ name, args });
    if (name === "clinic_inpatient_visit_correction_allowed") return fx.allowed === null ? { data: null, error: { message: "boom" } } : { data: fx.allowed, error: null };
    return { data: "log", error: null };
  },
  from(table: string) {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: table === "inpatient_records" ? fx.rec : table === "inpatient_daily_logs" ? fx.log : table === "profiles" ? { role: fx.role } : null, error: null }),
      then(resolve: (value: unknown) => void) { return Promise.resolve({ data: table === "inpatient_records" ? [{ id: "stay", stay_type: "sakit" }] : [], error: null }).then(resolve); },
    };
    return q;
  },
}) }));

import { addDailyLogPos, updateDailyLog } from "@/app/(app)/klinik/rawat-inap/actions";
import { CatatanForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/CatatanForm";
import { LogEditForm } from "@/app/(app)/klinik/rawat-inap/[id]/catatan/[logId]/LogEditForm";
import { InpatientStaffFields } from "@/components/InpatientStaffFields";
import { LogRowAction } from "@/app/(app)/klinik/rawat-inap/[id]/LogRowAction";

const DOK = "dc000000-0000-4000-8000-000000000002";
const DOK2 = "dc000000-0000-4000-8000-000000000003";
const PARA = "dc000000-0000-4000-8000-000000000004";
const PARA2 = "dc000000-0000-4000-8000-000000000005";
const saveCalls = () => fx.calls.filter((c: Call) => c.name !== "clinic_inpatient_visit_correction_allowed");

/** Tanggal & jam WIB `jam` jam yang lalu (format form). */
function wibAgo(hours: number) {
  const iso = new Date(Date.now() - hours * 3600_000 + 7 * 3600_000).toISOString();
  return { log_date: iso.slice(0, 10), log_time: iso.slice(11, 16) };
}
function entry(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ recordId: "stay", request_key: "req-1", condition_note: "Visit fiktif", log_kind: "doctor_visit", visit_doctor_id: DOK, resep: "[]", ...fields })) fd.set(k, v);
  return fd;
}
async function outcome(run: () => Promise<unknown>) {
  try { return { result: await run() }; } catch (e) { return { redirect: String((e as Error).message) }; }
}

beforeEach(() => {
  fx.calls = []; fx.allowed = true; fx.role = "STAFF";
  fx.rec = { condition_status: "stabil", visit_id: "visit", medical_record_id: "record", discharged_at: null };
  fx.log = null;
});

describe("aksi simpan catatan (addDailyLogPos)", () => {
  it("visit tepat waktu: jalur biasa tanpa alasan (tidak berubah)", async () => {
    const out = await outcome(() => addDailyLogPos(entry(wibAgo(1))));
    expect(out.result).toMatchObject({ saved: true });
    expect(saveCalls().map(c => c.name)).toEqual(["clinic_save_inpatient_log_with_status"]);
  });
  it("visit dokter > 48 jam lalu TANPA alasan: ditolak dengan pesan jelas, tidak ada simpan", async () => {
    const out = await outcome(() => addDailyLogPos(entry(wibAgo(72))));
    expect(out.redirect).toMatch(/\/klinik\/rawat-inap\/stay\/catatan\?error=/);
    expect(decodeURIComponent(out.redirect!)).toMatch(/lebih dari 48 jam lalu adalah koreksi/);
    expect(saveCalls()).toEqual([]);
  });
  it("visit dokter > 48 jam lalu dengan alasan: lewat RPC koreksi membawa alasan", async () => {
    const out = await outcome(() => addDailyLogPos(entry({ ...wibAgo(72), koreksi_alasan: "  Lupa dicatat  " })));
    expect(out.result).toMatchObject({ saved: true });
    expect(saveCalls()).toHaveLength(1);
    expect(saveCalls()[0]).toMatchObject({ name: "clinic_save_inpatient_log_correction", args: { p_reason: "Lupa dicatat", p_rows: [], p_compounds: [], p_new_status: null } });
  });
  it("pemantauan mundur > 48 jam: tetap jalur biasa tanpa alasan (aturan 48 jam hanya untuk visit dokter)", async () => {
    const out = await outcome(() => addDailyLogPos(entry({ ...wibAgo(96), log_kind: "monitoring", visit_doctor_id: "" })));
    expect(out.result).toMatchObject({ saved: true });
    expect(saveCalls().map(c => c.name)).toEqual(["clinic_save_inpatient_log_with_status"]);
  });
  it("setelah pasien pulang: wajib alasan; dengan alasan lewat RPC koreksi; galat kembali ke halaman koreksi", async () => {
    fx.rec = { ...fx.rec, discharged_at: "2026-11-11T03:00:00Z", condition_status: "sembuh" };
    const tanpa = await outcome(() => addDailyLogPos(entry({ ...wibAgo(30), koreksi_form: "1" })));
    expect(tanpa.redirect).toMatch(/\/klinik\/rawat-inap\/stay\/koreksi\?error=/);
    expect(decodeURIComponent(tanpa.redirect!)).toMatch(/Pasien sudah pulang/);
    expect(saveCalls()).toEqual([]);
    const dengan = await outcome(() => addDailyLogPos(entry({ ...wibAgo(30), koreksi_form: "1", koreksi_alasan: "Visit lupa dicatat" })));
    expect(dengan.result).toMatchObject({ saved: true });
    expect(saveCalls()[0]).toMatchObject({ name: "clinic_save_inpatient_log_correction", args: { p_reason: "Visit lupa dicatat", p_new_status: null } });
  });
  it("setelah pasien pulang dengan ubah kondisi: ditolak (koreksi tanpa ubah kondisi)", async () => {
    fx.rec = { ...fx.rec, discharged_at: "2026-11-11T03:00:00Z", condition_status: "sembuh" };
    const out = await outcome(() => addDailyLogPos(entry({ ...wibAgo(30), koreksi_alasan: "Visit lupa dicatat", new_status: "stabil" })));
    expect(decodeURIComponent(out.redirect ?? "")).toMatch(/tanpa obat, tagihan, atau ubah kondisi/);
    expect(saveCalls()).toEqual([]);
  });
});

describe("aksi koreksi catatan (updateDailyLog)", () => {
  const savedVisit = { id: "log", inpatient_record_id: "stay", log_kind: "doctor_visit", visit_doctor_id: DOK, paramedic_id: PARA, log_date: "2026-11-10", created_at: "2026-11-10T03:00:00Z", condition_note: "Visit fiktif" };
  function edit(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ logId: "log", recordId: "stay", condition_note: "Visit fiktif", log_date: "2026-11-10", log_time: "10:00", log_kind: "doctor_visit", visit_doctor_id: DOK, paramedic_id: PARA, ...fields })) fd.set(k, v);
    return fd;
  }
  beforeEach(() => { fx.log = { ...savedVisit }; });
  it("ubah isi saja (tanpa waktu/dokter/paramedis) selama dirawat: tidak perlu alasan", async () => {
    const out = await outcome(() => updateDailyLog(edit({ tindakan: "Infus" })));
    expect(out.redirect).toMatch(/success=logedit/);
    expect(saveCalls()[0]).toMatchObject({ name: "clinic_update_inpatient_log", args: { p_reason: null } });
    expect((saveCalls()[0].args.p_patch as Record<string, unknown>).created_at).toBeUndefined();
  });
  it("ubah paramedis visit dokter tanpa alasan: ditolak sebelum simpan", async () => {
    const out = await outcome(() => updateDailyLog(edit({ paramedic_id: PARA2 })));
    expect(decodeURIComponent(out.redirect ?? "")).toMatch(/catatan\/log\?error=.*paramedis visit dokter adalah koreksi/);
    expect(saveCalls()).toEqual([]);
  });
  it("ubah dokter/jam visit dengan alasan: dikirim ke RPC bersama alasan", async () => {
    const out = await outcome(() => updateDailyLog(edit({ visit_doctor_id: DOK2, log_time: "11:00", alasan: "Dokter tertukar" })));
    expect(out.redirect).toMatch(/success=logedit/);
    expect(saveCalls()[0]).toMatchObject({ name: "clinic_update_inpatient_log", args: { p_reason: "Dokter tertukar", p_patch: { visit_doctor_id: DOK2 } } });
  });
  it("setelah pulang, bukan pemegang izin: tetap dikunci dengan pesan lama", async () => {
    fx.rec = { discharged_at: "2026-11-11T03:00:00Z" }; fx.allowed = false;
    const out = await outcome(() => updateDailyLog(edit({ tindakan: "Infus", alasan: "Koreksi" })));
    expect(decodeURIComponent(out.redirect ?? "")).toMatch(/Rawat inap sudah ditutup — catatan tidak bisa diubah lagi/);
    expect(saveCalls()).toEqual([]);
  });
  it("setelah pulang, pemegang izin: tanpa alasan ditolak; dengan alasan disimpan", async () => {
    fx.rec = { discharged_at: "2026-11-11T03:00:00Z" }; fx.allowed = true;
    const tanpa = await outcome(() => updateDailyLog(edit({ tindakan: "Infus" })));
    expect(decodeURIComponent(tanpa.redirect ?? "")).toMatch(/Pasien sudah pulang — isi alasan koreksi/);
    expect(saveCalls()).toEqual([]);
    const dengan = await outcome(() => updateDailyLog(edit({ tindakan: "Infus", alasan: "Koreksi setelah pulang" })));
    expect(dengan.redirect).toMatch(/success=logedit/);
    expect(saveCalls()[0]).toMatchObject({ name: "clinic_update_inpatient_log", args: { p_reason: "Koreksi setelah pulang" } });
  });
  it("setelah pulang, izin tak terbaca: hanya Owner yang diteruskan (database memutuskan)", async () => {
    fx.rec = { discharged_at: "2026-11-11T03:00:00Z" }; fx.allowed = null; fx.role = "ADMIN";
    const admin = await outcome(() => updateDailyLog(edit({ tindakan: "Infus", alasan: "Koreksi" })));
    expect(decodeURIComponent(admin.redirect ?? "")).toMatch(/Rawat inap sudah ditutup/);
    fx.role = "OWNER"; fx.calls = [];
    const owner = await outcome(() => updateDailyLog(edit({ tindakan: "Infus", alasan: "Koreksi" })));
    expect(owner.redirect).toMatch(/success=logedit/);
  });
});

describe("layar", () => {
  const patient = { name: "Fiktif", species: "Kucing", breed: null, noRM: "FIKTIF", owner: "Fiktif", phone: "", address: "", tglMasuk: "-", dokter: "Fiktif", kondisi: "Sembuh", photo: null };
  const doctors = [{ id: DOK, nama: "Drh fiktif", jabatan: "Dokter" }];
  const paramedics = [{ id: PARA, nama: "Paramedis fiktif", jabatan: "Paramedis" }, { id: PARA2, nama: "Paramedis dua", jabatan: "Paramedis" }];
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
  const form = (extra: Record<string, unknown>) => <CatatanForm mode="clinical" recordId="stay" requestKey="request" draftUserId="actor" backHref="/klinik/rawat-inap/stay" patient={patient}
    items={[]} racikanItems={[]} bahanItems={[]} jasaItems={[]} tindakanItems={[]} katalogRacikan={[]} bolehManual={false} doctors={doctors} paramedics={paramedics} {...extra} />;

  it("form koreksi setelah pulang: tanpa obat & tanpa ubah kondisi, alasan wajib, kirim ke halaman koreksi", async () => {
    await act(async () => root.render(form({ setelahPulang: true, koreksiVisit: true })));
    expect(host.textContent).toMatch(/KOREKSI VISIT SETELAH PASIEN PULANG/);
    expect(host.querySelector('[name="new_status"]')).toBeNull();
    const alasan = host.querySelector<HTMLInputElement>('[name="koreksi_alasan"]')!;
    expect(alasan.required).toBe(true);
    expect(host.querySelector<HTMLInputElement>('[name="koreksi_form"]')!.value).toBe("1");
    expect(host.querySelector<HTMLInputElement>('[name="resep"]')!.value).toBe("[]");
    expect(host.textContent).toMatch(/Simpan Koreksi Visit/);
    expect(host.querySelector('a[href$="/obat-khusus"]')).toBeNull();
  });
  it("form biasa untuk pemegang izin: kolom alasan opsional (wajib bila visit > 48 jam); bukan pemegang izin: tidak ada kolom", async () => {
    await act(async () => root.render(form({ koreksiVisit: true })));
    expect(host.querySelector<HTMLInputElement>('[name="koreksi_alasan"]')!.required).toBe(false);
    expect(host.querySelector('[name="new_status"]')).not.toBeNull();
    await act(async () => root.render(form({})));
    expect(host.querySelector('[name="koreksi_alasan"]')).toBeNull();
  });
  it("edit setelah pulang oleh pemegang izin: bisa diedit, alasan wajib; alasan tambah-koreksi ditampilkan", async () => {
    await act(async () => root.render(<LogEditForm recordId="stay" backHref="/klinik/rawat-inap/stay" patient={patient} editable alasanWajib bolehKoreksiVisit edits={[]} doctors={doctors} paramedics={paramedics}
      log={{ id: "log", log_date: "2026-11-10", created_at: "2026-11-10T03:00:00Z", condition_note: "Visit", tindakan: null, keterangan: null, doctor_name: "Drh fiktif", log_kind: "doctor_visit", visit_doctor_id: DOK, paramedic_id: PARA, correction_reason: "Visit lupa dicatat" }} />));
    const alasan = host.querySelector<HTMLInputElement>('[name="alasan"]')!;
    expect(alasan.required).toBe(true);
    expect(host.textContent).toMatch(/Pasien sudah pulang — perubahan ini adalah koreksi visit/);
    expect(host.textContent).toMatch(/Ditambahkan sebagai koreksi visit\..*Visit lupa dicatat/);
    expect(host.querySelector<HTMLTextAreaElement>('[name="condition_note"]')!.disabled).toBe(false);
  });
  it("paramedis pada visit dokter terkunci untuk bukan pemegang izin (nilai tersimpan tetap terkirim)", async () => {
    await act(async () => root.render(<form><InpatientStaffFields value={{ log_kind: "doctor_visit", visit_doctor_id: DOK, paramedic_id: PARA }} onChange={() => {}} doctors={doctors} paramedics={paramedics} lockVisit savedKind="doctor_visit" /></form>));
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Paramedis yang membantu"]')!.disabled).toBe(true);
    const data = new FormData(host.querySelector("form")!);
    expect(data.getAll("paramedic_id")).toEqual([PARA]);
    expect(host.textContent).toMatch(/pemegang izin Koreksi visit rawat inap/);
    // pemantauan tetap bebas
    await act(async () => root.render(<form><InpatientStaffFields value={{ log_kind: "monitoring", visit_doctor_id: null, paramedic_id: PARA }} onChange={() => {}} doctors={doctors} paramedics={paramedics} lockVisit savedKind="monitoring" /></form>));
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Paramedis yang membantu"]')!.disabled).toBe(false);
  });
  it("baris catatan setelah pulang untuk pemegang izin: 'Lihat / Edit'", () => {
    expect(renderToStaticMarkup(<LogRowAction recordId="rec-1" logId="log-9" editable />)).toContain(">Lihat / Edit<");
  });
});
