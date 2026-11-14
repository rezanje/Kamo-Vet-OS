import { sendWA, type WaResult } from "./fonnte";
import { tanggalWIB, geserHari } from "./tanggal";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const WA_TRIGGERS = [
  ["post_grooming", "Grooming H+30"],
  ["post_treatment", "Treatment H+7"],
  ["vaccination_due", "Vaksin H-30"],
  ["vaccination_overdue", "Vaksin lewat H+7"],
  ["lapsed", "Tidak datang 60 hari"],
  ["owner_birthday", "Ulang tahun pemilik"],
  ["pet_birthday", "Ulang tahun anabul"],
] as const;

type TriggerKey = (typeof WA_TRIGGERS)[number][0];
type Candidate = {
  customerId: string;
  petId?: string | null;
  branchId?: string | null;
  phone: string;
  message: string;
  trigger: TriggerKey;
  subject: string;
};

type Settings = Record<`${TriggerKey}_enabled`, boolean> & { is_enabled: boolean };

const PAGE_SIZE = 500;
const SOURCE_LIMIT = 50_000;

async function bacaSumberWa<T extends { id: string }>(supabase: Db, table: string, fields: string): Promise<T[]> {
  const rows: T[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let start = 0; total === undefined || start < total; start += PAGE_SIZE) {
    const { data, error, count } = await supabase.from(table)
      .select(fields, { count: "exact" }).order("id").range(start, start + PAGE_SIZE - 1);
    if (error || !Array.isArray(data) || !Number.isInteger(count) || count < 0 || count > SOURCE_LIMIT) {
      throw new Error(`Data WA (${table}) belum bisa dibaca lengkap. Tidak ada pengingat baru yang dikirim.`);
    }
    if (total === undefined) total = count;
    if (count !== total || data.length !== Math.min(PAGE_SIZE, total! - start)) {
      throw new Error(`Data WA (${table}) berubah atau terpotong saat dibaca. Jalankan pemeriksaan lagi.`);
    }
    for (const row of data as T[]) {
      if (typeof row.id !== "string" || !row.id || ids.has(row.id)) {
        throw new Error(`Data WA (${table}) tidak lengkap. Jalankan pemeriksaan lagi.`);
      }
      ids.add(row.id);
      rows.push(row);
    }
  }
  return rows;
}

function dateAtWib(now: Date) {
  return tanggalWIB(now.toISOString());
}

function tanggalBirthday(dob: string | null, today: string) {
  return !!dob && dob.slice(5) === today.slice(5);
}

function pesan(trigger: TriggerKey, owner: string, pet: string, extra?: string) {
  const nama = owner || "Kak";
  const anabul = pet || "anabul";
  const pembuka: Record<TriggerKey, string> = {
    post_grooming: `${anabul} sudah waktunya grooming lagi`,
    post_treatment: `boleh kami cek kembali kondisi ${anabul}`,
    vaccination_due: `${anabul} sudah mendekati jadwal vaksin`,
    vaccination_overdue: `${anabul} sudah melewati jadwal vaksin`,
    lapsed: `kami sudah lama tidak bertemu dengan ${anabul}`,
    owner_birthday: "selamat ulang tahun",
    pet_birthday: `selamat ulang tahun untuk ${anabul}`,
  };
  return [`Halo Kak ${nama}, ${pembuka[trigger]}.`, extra ?? null, "Balas pesan ini kalau mau atur jadwal ya. Terima kasih!"].filter(Boolean).join("\n\n");
}

export async function jalankanWaEngine(supabase: Db, now = new Date()) {
  const today = dateAtWib(now);
  const { data: rawSettings, error: settingsError } = await supabase.from("wa_engine_settings").select("*").eq("id", true).maybeSingle();
  if (settingsError) throw new Error("Pengaturan WA belum bisa dibaca. Tidak ada pengingat baru yang dikirim.");
  const settings = rawSettings as Settings | null;
  if (!settings?.is_enabled) return { enabled: false, created: 0, sent: 0, failed: 0 };

  const [customers, pets, visits, followUps, sales] = await Promise.all([
    bacaSumberWa<Customer>(supabase, "customers", "id, name, phone, dob"),
    bacaSumberWa<Pet>(supabase, "pets", "id, customer_id, name, dob"),
    bacaSumberWa<Visit>(supabase, "visits", "id, customer_id, pet_id, branch_id, poli, created_at"),
    bacaSumberWa<FollowUp>(supabase, "follow_ups", "id, customer_id, pet_id, branch_id, jenis, tanggal"),
    bacaSumberWa<{ id: string; customer_id: string | null; created_at: string }>(supabase, "sales", "id, customer_id, created_at"),
  ]);

  type Customer = { id: string; name: string; phone: string; dob: string | null };
  type Pet = { id: string; customer_id: string; name: string; dob: string | null };
  type Visit = { id: string; customer_id: string; pet_id: string; branch_id: string; poli: string; created_at: string };
  type FollowUp = { id: string; customer_id: string | null; pet_id: string; branch_id: string | null; jenis: string; tanggal: string };
  const owners = ((customers ?? []) as Customer[]).filter((c) => c.phone?.trim());
  const petRows = (pets ?? []) as Pet[];
  const petById = new Map(petRows.map((p) => [p.id, p]));
  const ownerById = new Map(owners.map((c) => [c.id, c]));
  const candidates: Candidate[] = [];
  const add = (c: Candidate) => { if (settings[`${c.trigger}_enabled`]) candidates.push(c); };

  if (settings.owner_birthday_enabled) {
    for (const owner of owners) if (tanggalBirthday(owner.dob, today)) {
      add({ customerId: owner.id, phone: owner.phone, message: pesan("owner_birthday", owner.name, ""), trigger: "owner_birthday", subject: today });
    }
  }
  if (settings.pet_birthday_enabled) {
    for (const pet of petRows) {
      const owner = ownerById.get(pet.customer_id);
      if (owner && tanggalBirthday(pet.dob, today)) add({ customerId: owner.id, petId: pet.id, phone: owner.phone, message: pesan("pet_birthday", owner.name, pet.name), trigger: "pet_birthday", subject: today });
    }
  }

  const visitRows = (visits ?? []) as Visit[];
  for (const visit of visitRows) {
    const pet = petById.get(visit.pet_id);
    const owner = pet ? ownerById.get(pet.customer_id) : undefined;
    if (!owner || !pet) continue;
    const visitDate = tanggalWIB(visit.created_at);
    if (visitDate === geserHari(today, -30) && visit.poli.toLowerCase().includes("groom")) add({ customerId: owner.id, petId: pet.id, branchId: visit.branch_id, phone: owner.phone, message: pesan("post_grooming", owner.name, pet.name), trigger: "post_grooming", subject: visit.id });
    if (visitDate === geserHari(today, -7) && !visit.poli.toLowerCase().includes("groom")) add({ customerId: owner.id, petId: pet.id, branchId: visit.branch_id, phone: owner.phone, message: pesan("post_treatment", owner.name, pet.name), trigger: "post_treatment", subject: visit.id });
  }

  const fups = (followUps ?? []) as FollowUp[];
  for (const fup of fups) {
    const pet = petById.get(fup.pet_id);
    const owner = pet ? ownerById.get(pet.customer_id) : undefined;
    if (!owner || !pet || fup.jenis !== "Vaksin") continue;
    if (fup.tanggal === geserHari(today, 30)) add({ customerId: owner.id, petId: pet.id, branchId: fup.branch_id, phone: owner.phone, message: pesan("vaccination_due", owner.name, pet.name, `Jadwal vaksinnya ${fup.tanggal}.`), trigger: "vaccination_due", subject: fup.id });
    if (fup.tanggal === geserHari(today, -7)) add({ customerId: owner.id, petId: pet.id, branchId: fup.branch_id, phone: owner.phone, message: pesan("vaccination_overdue", owner.name, pet.name, `Jadwal sebelumnya ${fup.tanggal}.`), trigger: "vaccination_overdue", subject: fup.id });
  }

  if (settings.lapsed_enabled) {
    const activity = new Map<string, string>();
    for (const row of [...((sales ?? []) as { customer_id: string | null; created_at: string }[]), ...visitRows]) {
      if (!row.customer_id) continue;
      if (!activity.has(row.customer_id) || row.created_at > activity.get(row.customer_id)!) activity.set(row.customer_id, row.created_at);
    }
    for (const owner of owners) {
      const last = activity.get(owner.id);
      if (last && tanggalWIB(last) === geserHari(today, -60)) {
        const pet = petRows.find((p) => p.customer_id === owner.id);
        add({ customerId: owner.id, petId: pet?.id, phone: owner.phone, message: pesan("lapsed", owner.name, pet?.name ?? "anabul"), trigger: "lapsed", subject: today });
      }
    }
  }

  let created = 0, sent = 0, failed = 0;
  for (const candidate of candidates) {
    const idempotencyKey = `${candidate.trigger}:${candidate.subject}:${candidate.customerId}:${candidate.petId ?? "owner"}`;
    const { data: log, error: insertError } = await supabase.from("whatsapp_message_log").insert({
      customer_id: candidate.customerId, pet_id: candidate.petId ?? null, branch_id: candidate.branchId ?? null,
      trigger_key: candidate.trigger, idempotency_key: idempotencyKey, phone: candidate.phone, message: candidate.message,
    }).select("id").maybeSingle();
    if (insertError?.code === "23505") continue;
    if (insertError || !log) throw new Error("Pesan WA belum bisa dicatat. Pemeriksaan dihentikan; periksa riwayat sebelum mencoba lagi.");
    created++;
    const result = await sendWA(candidate.phone, candidate.message);
    if (result.ok) {
      const { data: updated, error } = await supabase.from("whatsapp_message_log").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", log.id).select("id").maybeSingle();
      if (error || updated?.id !== log.id) throw new Error("Status WA belum bisa disimpan setelah provider menerima pesan. Periksa riwayat; jangan kirim ulang otomatis.");
      sent++;
    } else {
      const { data: updated, error } = await supabase.from("whatsapp_message_log").update({ status: "failed", error: result.reason ?? "Gagal kirim" }).eq("id", log.id).select("id").maybeSingle();
      if (error || updated?.id !== log.id) throw new Error("Status kegagalan WA belum bisa disimpan. Periksa riwayat sebelum mencoba lagi.");
      failed++;
    }
  }
  return { enabled: true, created, sent, failed };
}

export type StrukWaInput = {
  invoiceNo: string; customerId: string; phone: string; customerName: string; petName?: string | null;
  branchId?: string | null; branchName?: string | null; jenis?: "klinik" | "toko";
  total: number; items: { deskripsi: string; qty: number; harga: number }[];
};

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/** Isi pesan struk WA. Selisih rincian vs total (diskon, voucher, poin, biaya) ditampilkan satu baris. */
export function pesanStrukWa(input: StrukWaInput) {
  const sapaan = input.jenis === "toko"
    ? `terima kasih sudah berbelanja${input.branchName ? ` di ${input.branchName}` : ""}`
    : `terima kasih sudah berkunjung${input.petName ? ` bersama ${input.petName}` : ""}${input.branchName ? ` ke ${input.branchName}` : ""}`;
  const rincian = input.items.map((i) => `${i.deskripsi} x${i.qty} — ${rupiah(i.qty * i.harga)}`);
  const jumlahRincian = input.items.reduce((sum, i) => sum + Math.round(i.qty * i.harga), 0);
  const selisih = Math.round(input.total) - jumlahRincian;
  if (selisih < 0) rincian.push(`Potongan — -${rupiah(-selisih)}`);
  if (selisih > 0) rincian.push(`Biaya lain — ${rupiah(selisih)}`);
  return [
    `Halo Kak ${input.customerName || ""}, ${sapaan}.`,
    `Struk ${input.invoiceNo}\n${rincian.join("\n")}\nTotal: ${rupiah(input.total)}`,
    "Simpan pesan ini sebagai bukti transaksi. Terima kasih!",
  ].join("\n\n");
}

// Fungsi basis data yang mencatat struk WA atas nama kasir mana pun (bukan hanya
// Owner/Admin — tabel riwayat WA sendiri tetap tertutup untuk staf). Bila migrasinya
// belum terpasang, jatuh ke tulis langsung seperti sebelumnya (hanya lolos untuk Owner/Admin).
const fungsiBelumAda = (error: { code?: string; message?: string } | null | undefined) =>
  !!error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? ""));

async function catatStruk(supabase: Db, input: StrukWaInput, message: string): Promise<{ id: string | null; reason?: string }> {
  if (typeof supabase.rpc === "function") {
    const { data, error } = await supabase.rpc("wa_struk_catat", {
      p_ref: input.invoiceNo, p_customer_id: input.customerId, p_branch_id: input.branchId ?? null, p_phone: input.phone, p_message: message,
    });
    if (!fungsiBelumAda(error)) {
      if (error) return { id: null, reason: "Struk WA gagal dicatat" };
      return data ? { id: String(data) } : { id: null, reason: "Struk WA sudah pernah diproses" };
    }
  }
  const { data: log } = await supabase.from("whatsapp_message_log").insert({
    customer_id: input.customerId, branch_id: input.branchId ?? null, phone: input.phone, trigger_key: "receipt", idempotency_key: `receipt:${input.invoiceNo}`, message,
  }).select("id").maybeSingle();
  return log ? { id: log.id } : { id: null, reason: "Struk WA sudah pernah diproses atau gagal dicatat" };
}

async function tandaiStruk(supabase: Db, id: string, result: WaResult): Promise<boolean> {
  if (typeof supabase.rpc === "function") {
    const { data, error } = await supabase.rpc("wa_struk_tandai", { p_log_id: id, p_sent: result.ok, p_error: result.ok ? null : (result.reason ?? "Gagal kirim") });
    if (!fungsiBelumAda(error)) return !error && data === true;
  }
  const { data: updated, error } = await supabase.from("whatsapp_message_log").update(result.ok
    ? { status: "sent", sent_at: new Date().toISOString() }
    : { status: "failed", error: result.reason ?? "Gagal kirim" }).eq("id", id).select("id").maybeSingle();
  return !error && updated?.id === id;
}

/** Struk WA aktif? Saklar sendiri (`receipt_enabled`); sebelum migrasinya ada, ikut saklar utama. */
export function strukWaAktif(settings: Record<string, unknown> | null | undefined) {
  if (!settings) return false;
  return typeof settings.receipt_enabled === "boolean" ? settings.receipt_enabled : settings.is_enabled === true;
}

export async function kirimStrukWa(supabase: Db, input: StrukWaInput): Promise<WaResult> {
  const { data: settings, error: settingsError } = await supabase.from("wa_engine_settings").select("*").eq("id", true).maybeSingle();
  if (settingsError) return { ok: false, reason: "Pengaturan WA belum bisa dibaca. Struk belum dikirim." };
  if (!strukWaAktif(settings)) return { ok: false, reason: "Pengiriman struk WA belum diaktifkan" };
  if (!input.phone?.replace(/\D/g, "")) return { ok: false, reason: "Pelanggan belum punya nomor WA" };
  const message = pesanStrukWa(input);
  const log = await catatStruk(supabase, input, message);
  if (!log.id) return { ok: false, reason: log.reason };
  const result = await sendWA(input.phone, message);
  if (!(await tandaiStruk(supabase, log.id, result))) return {
    ok: false,
    reason: result.ok ? "Provider menerima struk, tetapi status WA belum tersimpan. Periksa riwayat; jangan kirim ulang otomatis." : "Status kegagalan struk WA belum tersimpan. Periksa riwayat sebelum mencoba lagi.",
  };
  return result;
}
