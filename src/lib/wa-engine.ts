import { sendWA } from "./fonnte";
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
  const { data: rawSettings } = await supabase.from("wa_engine_settings").select("*").eq("id", true).maybeSingle();
  const settings = rawSettings as Settings | null;
  if (!settings?.is_enabled) return { enabled: false, created: 0, sent: 0, failed: 0 };

  const [{ data: customers }, { data: pets }, { data: visits }, { data: followUps }, { data: sales }] = await Promise.all([
    supabase.from("customers").select("id, name, phone, dob"),
    supabase.from("pets").select("id, customer_id, name, dob"),
    supabase.from("visits").select("id, customer_id, pet_id, branch_id, poli, created_at"),
    supabase.from("follow_ups").select("id, customer_id, pet_id, branch_id, jenis, tanggal"),
    supabase.from("sales").select("id, customer_id, created_at"),
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
    const owner = ownerById.get(visit.customer_id);
    const pet = petById.get(visit.pet_id);
    if (!owner || !pet) continue;
    const visitDate = tanggalWIB(visit.created_at);
    if (visitDate === geserHari(today, -30) && visit.poli.toLowerCase().includes("groom")) add({ customerId: owner.id, petId: pet.id, branchId: visit.branch_id, phone: owner.phone, message: pesan("post_grooming", owner.name, pet.name), trigger: "post_grooming", subject: visit.id });
    if (visitDate === geserHari(today, -7) && !visit.poli.toLowerCase().includes("groom")) add({ customerId: owner.id, petId: pet.id, branchId: visit.branch_id, phone: owner.phone, message: pesan("post_treatment", owner.name, pet.name), trigger: "post_treatment", subject: visit.id });
  }

  const fups = (followUps ?? []) as FollowUp[];
  for (const fup of fups) {
    const owner = fup.customer_id ? ownerById.get(fup.customer_id) : null;
    const pet = petById.get(fup.pet_id);
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
    if (insertError || !log) continue;
    created++;
    const result = await sendWA(candidate.phone, candidate.message);
    if (result.ok) {
      await supabase.from("whatsapp_message_log").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", log.id);
      sent++;
    } else {
      await supabase.from("whatsapp_message_log").update({ status: "failed", error: result.reason ?? "Gagal kirim" }).eq("id", log.id);
      failed++;
    }
  }
  return { enabled: true, created, sent, failed };
}

export async function kirimStrukWa(supabase: Db, input: {
  invoiceNo: string; customerId: string; phone: string; customerName: string; petName?: string | null;
  total: number; items: { deskripsi: string; qty: number; harga: number }[];
}) {
  const { data: settings } = await supabase.from("wa_engine_settings").select("is_enabled").eq("id", true).maybeSingle();
  if (!settings?.is_enabled) return { ok: false, reason: "Pengiriman WA belum diaktifkan" };
  const idempotencyKey = `receipt:${input.invoiceNo}`;
  const message = [
    `Halo Kak ${input.customerName || ""}, terima kasih sudah berkunjung${input.petName ? ` bersama ${input.petName}` : ""}.`,
    `Struk ${input.invoiceNo}\n${input.items.map((i) => `${i.deskripsi} x${i.qty} — Rp ${Math.round(i.qty * i.harga).toLocaleString("id-ID")}`).join("\n")}\nTotal: Rp ${Math.round(input.total).toLocaleString("id-ID")}`,
    "Simpan pesan ini sebagai bukti transaksi. Terima kasih!",
  ].join("\n\n");
  const { data: log } = await supabase.from("whatsapp_message_log").insert({
    customer_id: input.customerId, phone: input.phone, trigger_key: "receipt", idempotency_key: idempotencyKey, message,
  }).select("id").maybeSingle();
  if (!log) return { ok: false, reason: "Struk WA sudah pernah diproses atau gagal dicatat" };
  const result = await sendWA(input.phone, message);
  await supabase.from("whatsapp_message_log").update(result.ok
    ? { status: "sent", sent_at: new Date().toISOString() }
    : { status: "failed", error: result.reason ?? "Gagal kirim" }).eq("id", log.id);
  return result;
}
