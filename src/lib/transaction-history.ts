// Riwayat perubahan per transaksi (hanya baca). Menyusun garis waktu dari tabel audit yang SUDAH ada;
// tidak menulis apa pun dan tidak menambah hak baca: setiap sumber dibaca lewat RLS tabelnya sendiri.

export type HistoryTone = "info" | "warn" | "danger" | "ok";
export type HistoryEvent = {
  key: string;
  /** ISO timestamp, "YYYY-MM-DD" bila hanya tanggal yang tercatat, atau null. */
  at: string | null;
  actor: string;
  label: string;
  detail: string[];
  reason: string | null;
  tone: HistoryTone;
};
export type ActorNames = ReadonlyMap<string, string>;

const RIWAYAT_ROLES = ["OWNER", "ADMIN", "FINANCE"] as const;

/** Panel riwayat hanya untuk peran keuangan/pemilik; basis data tetap memeriksa RLS tiap sumber. */
export function bolehLihatRiwayat(profile: { role?: string | null; is_active?: boolean | null } | null | undefined): boolean {
  return profile?.is_active === true && (RIWAYAT_ROLES as readonly string[]).includes(profile.role ?? "");
}

const rp = (n: number) => `Rp ${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : null);

/** Nama pelaku. UUID tidak pernah ditampilkan; profil lain hanya terbaca oleh OWNER/ADMIN (RLS profiles). */
export function actorLabel(id: string | null | undefined, names: ActorNames, viewerId?: string | null): string {
  if (!id) return "Tidak tercatat";
  const name = names.get(id)?.trim();
  if (name) return name;
  if (viewerId && id === viewerId) return "Anda";
  return "Pengguna lain";
}

function timeOf(at: string | null): number | null {
  if (!at) return null;
  const t = Date.parse(at.length === 10 ? `${at}T00:00:00+07:00` : at);
  return Number.isNaN(t) ? null : t;
}

/** Terbaru dulu; tanpa waktu di bawah; urutan masukan dipertahankan bila waktunya sama. */
export function sortHistory(events: readonly HistoryEvent[]): HistoryEvent[] {
  return events
    .map((event, index) => ({ event, index, t: timeOf(event.at) }))
    .sort((a, b) => (a.t === null ? 1 : 0) - (b.t === null ? 1 : 0) || (b.t ?? 0) - (a.t ?? 0) || a.index - b.index)
    .map((row) => row.event);
}

const clean = (text: string | null | undefined) => (text && text.trim() ? text.trim() : null);

// ───────────────────────────── Faktur Penjualan ─────────────────────────────
type FakturInvoice = { id: string; no_faktur: string; status: string; replaces_invoice_id: string | null; voided_on: string | null; void_reason: string | null };
type FakturCorrection = {
  id: string; invoice_id: string; created_at: string; tanggal: string; reason: string; created_by: string | null;
  paid_preserved: number; customer_credit: number;
  original_journal_id: string | null; reversal_journal_id: string | null; replacement_journal_id: string | null; credit_journal_id: string | null;
};
type FakturCancellation = {
  id: string; receipt_id?: string | null; invoice_id: string; created_at: string; tanggal: string; reason: string; created_by: string | null;
  advance_restored: number; original_journal_id: string | null; reversal_journal_id: string | null;
};
type FakturReceipt = { id: string; invoice_id: string; no_terima: string; jumlah: number; tanggal: string; metode: string | null; voided_at: string | null; void_reason: string | null; reversal_of: string | null };

export function fakturHistory(input: {
  viewerId?: string | null; names: ActorNames;
  invoices: FakturInvoice[]; corrections: FakturCorrection[]; cancellations: FakturCancellation[]; receipts: FakturReceipt[];
  /** Faktur lain dalam pesanan yang sama: hanya untuk mencari nomor pengganti, tidak menghasilkan kejadian sendiri. */
  related?: FakturInvoice[];
}): HistoryEvent[] {
  const { viewerId, names } = input;
  const lookup = [...input.invoices, ...(input.related ?? [])];
  const byId = new Map(lookup.map((row) => [row.id, row]));
  const successorOf = new Map<string, FakturInvoice>();
  for (const row of lookup) if (row.replaces_invoice_id) successorOf.set(row.replaces_invoice_id, row);
  const receiptById = new Map(input.receipts.map((row) => [row.id, row]));
  const events: HistoryEvent[] = [];

  for (const c of input.corrections) {
    const old = byId.get(c.invoice_id);
    const next = successorOf.get(c.invoice_id);
    const detail: string[] = [];
    if (old) detail.push(next ? `Faktur ${old.no_faktur} → ${next.no_faktur}` : `Faktur ${old.no_faktur}`);
    if (Number(c.paid_preserved) > 0) detail.push(`Pembayaran dipertahankan ${rp(Number(c.paid_preserved))}`);
    if (Number(c.customer_credit) > 0) detail.push(`Kredit pelanggan ${rp(Number(c.customer_credit))}`);
    const journals = [["asli", c.original_journal_id], ["pembalik", c.reversal_journal_id], ["pengganti", c.replacement_journal_id], ["kredit", c.credit_journal_id]]
      .filter((pair): pair is [string, string] => !!pair[1]).map(([name, id]) => `${name} ${short(id)}`);
    if (journals.length) detail.push(`Jurnal ${journals.join(" · ")}`);
    events.push({ key: `koreksi:${c.id}`, at: c.created_at, actor: actorLabel(c.created_by, names, viewerId), label: "Faktur dikoreksi", detail, reason: clean(c.reason), tone: "warn" });
  }

  for (const c of input.cancellations) {
    const receipt = c.receipt_id ? receiptById.get(c.receipt_id) : undefined;
    const detail: string[] = [];
    if (receipt) detail.push([`Penerimaan ${receipt.no_terima}`, receipt.metode, rp(Number(receipt.jumlah))].filter(Boolean).join(" · "));
    if (Number(c.advance_restored) > 0) detail.push(`Uang muka dikembalikan ${rp(Number(c.advance_restored))}`);
    const journals = [["asli", c.original_journal_id], ["pembalik", c.reversal_journal_id]]
      .filter((pair): pair is [string, string] => !!pair[1]).map(([name, id]) => `${name} ${short(id)}`);
    if (journals.length) detail.push(`Jurnal ${journals.join(" · ")}`);
    events.push({ key: `hapus-penerimaan:${c.id}`, at: c.created_at, actor: actorLabel(c.created_by, names, viewerId), label: "Penerimaan dihapus", detail, reason: clean(c.reason), tone: "danger" });
  }

  const corrected = new Set(input.corrections.map((c) => c.invoice_id));
  for (const row of input.invoices) {
    if (row.status !== "batal" || corrected.has(row.id)) continue;
    events.push({ key: `batal:${row.id}`, at: row.voided_on, actor: actorLabel(null, names, viewerId), label: "Faktur dibatalkan",
      detail: [`Faktur ${row.no_faktur}`], reason: clean(row.void_reason), tone: "danger" });
  }
  return sortHistory(events);
}

// ───────────────────────────── Klinik ─────────────────────────────
type KlinikEdit = { id: string; invoice_id: string; field_changed: string; old_value: string | null; new_value: string | null; reason: string | null;
  edited_at: string; edited_by?: string | null; editor_name?: string | null };
type KlinikInvoice = { id: string; invoice_no: string | null; reissued_from: string | null; created_at: string | null; voided_at?: string | null };
type KlinikCorrection = { id: string; revision: number; amount: number; from_method: string; to_method: string; reason: string; created_at: string; created_by: string | null };
type KlinikRefund = { id: string; no_refund: string; tanggal: string; total: number; method: string; keterangan: string | null; created_at: string; created_by: string | null };
type KlinikReceipt = { id: string; no_kwitansi: string; total: number; status: string; void_reason: string | null; voided_at: string | null; voided_by: string | null };

export function klinikHistory(input: {
  viewerId?: string | null; names: ActorNames;
  editLog: KlinikEdit[]; invoices: KlinikInvoice[]; corrections: KlinikCorrection[]; refunds: KlinikRefund[]; receipts: KlinikReceipt[];
}): HistoryEvent[] {
  const { viewerId, names } = input;
  const events: HistoryEvent[] = [];
  const editorOf = (row: KlinikEdit) => clean(row.editor_name) ?? actorLabel(row.edited_by, names, viewerId);

  for (const row of input.editLog) {
    const before = row.old_value ?? "—";
    const after = row.new_value ?? "—";
    events.push({ key: `edit:${row.id}`, at: row.edited_at, actor: editorOf(row), label: row.field_changed === "voided" ? "Invoice di-void" : "Invoice diedit",
      detail: [`${row.field_changed}: ${before} → ${after}`], reason: clean(row.reason), tone: row.field_changed === "voided" ? "danger" : "info" });
  }

  const byId = new Map(input.invoices.map((row) => [row.id, row]));
  for (const row of input.invoices) {
    if (!row.reissued_from) continue;
    const old = byId.get(row.reissued_from);
    // Pelaku terbit ulang tidak disimpan di invoice; pakai log 'voided' invoice lama bila ada.
    const voided = input.editLog.find((log) => log.invoice_id === row.reissued_from && log.field_changed === "voided");
    events.push({ key: `terbit-ulang:${row.id}`, at: row.created_at,
      actor: voided ? editorOf(voided) : actorLabel(null, names, viewerId), label: "Invoice terbit ulang",
      detail: [`${old?.invoice_no ?? "invoice lama"} → ${row.invoice_no ?? "invoice baru"}`], reason: clean(voided?.reason), tone: "warn" });
  }

  for (const c of input.corrections) {
    events.push({ key: `koreksi-metode:${c.id}`, at: c.created_at, actor: actorLabel(c.created_by, names, viewerId), label: `Koreksi metode bayar (revisi ${c.revision})`,
      detail: [`${c.from_method} → ${c.to_method} · ${rp(Number(c.amount))}`], reason: clean(c.reason), tone: "warn" });
  }
  for (const r of input.refunds) {
    events.push({ key: `refund:${r.id}`, at: r.created_at, actor: actorLabel(r.created_by, names, viewerId), label: "Refund",
      detail: [`${r.no_refund} · ${r.method} · ${rp(Number(r.total))}`], reason: clean(r.keterangan), tone: "warn" });
  }
  for (const r of input.receipts) {
    if (r.status !== "batal") continue;
    events.push({ key: `batal-kwitansi:${r.id}`, at: r.voided_at, actor: actorLabel(r.voided_by, names, viewerId), label: "Kwitansi dibatalkan",
      detail: [`${r.no_kwitansi} · ${rp(Number(r.total))}`], reason: clean(r.void_reason), tone: "danger" });
  }
  return sortHistory(events);
}

// ───────────────────────────── Petshop (struk POS) ─────────────────────────────
type PayPart = { method: string; amount: number };
type PetshopCorrection = { id: string; revision: number; reason: string; created_at: string; created_by: string | null; before_payments: PayPart[]; after_payments: PayPart[] };
type PetshopCancellation = { id: string; reason: string; created_at: string; created_by: string | null };
type PetshopReturn = { id: string; no_retur: string | null; tanggal: string; total: number; voided_at: string | null };
/** Batalkan penerimaan (gaya Accurate): satu catatan = pembatalan, dan (bila sudah) penutupannya. */
export type PetshopReceiptCancel = {
  id: string; reason: string; created_at: string; created_by: string | null; source_shift_status: string | null;
  effect_shift_id: string | null; source_shift_id: string | null; before_payments: PayPart[]; after_payments: PayPart[] | null;
  closed_at: string | null; closed_by: string | null; closed_kind: string | null;
};
export type PetshopOnlineCancel = { id: string; reason: string; created_at: string; created_by: string | null; amount_bank: number; amount_fee: number };

export function petshopHistory(input: {
  viewerId?: string | null; names: ActorNames;
  corrections: PetshopCorrection[]; cancellation: PetshopCancellation | null; returns: PetshopReturn[];
  receiptCancellations?: PetshopReceiptCancel[]; onlineCancellations?: PetshopOnlineCancel[];
}): HistoryEvent[] {
  const { viewerId, names } = input;
  const events: HistoryEvent[] = [];
  const parts = (rows: PayPart[]) => rows.map((p) => `${p.method} ${rp(Number(p.amount))}`).join(" + ");
  for (const c of input.corrections) {
    events.push({ key: `koreksi-metode:${c.id}`, at: c.created_at, actor: actorLabel(c.created_by, names, viewerId), label: `Koreksi metode bayar (revisi ${c.revision})`,
      detail: [`${parts(c.before_payments)} → ${parts(c.after_payments)}`], reason: clean(c.reason), tone: "warn" });
  }
  if (input.cancellation) {
    const c = input.cancellation;
    events.push({ key: `batal:${c.id}`, at: c.created_at, actor: actorLabel(c.created_by, names, viewerId), label: "Penjualan dibatalkan",
      detail: ["Stok dan jurnal dibalik"], reason: clean(c.reason), tone: "danger" });
  }
  for (const c of input.receiptCancellations ?? []) {
    const other = c.effect_shift_id && c.effect_shift_id !== c.source_shift_id ? " · dicatat di shift terbuka lain (shift asal sudah ditutup)" : "";
    events.push({ key: `batal-terima:${c.id}`, at: c.created_at, actor: actorLabel(c.created_by, names, viewerId), label: "Penerimaan dibatalkan (struk belum dibayar)",
      detail: [`${parts(c.before_payments)} dikeluarkan dari kas/bank${other}`], reason: clean(c.reason), tone: "warn" });
    if (c.closed_at && c.closed_kind === "diterima-ulang") {
      events.push({ key: `terima-ulang:${c.id}`, at: c.closed_at, actor: actorLabel(c.closed_by, names, viewerId), label: "Pembayaran diterima ulang",
        detail: [`${parts(c.before_payments)} → ${parts(c.after_payments ?? [])}`], reason: null, tone: "info" });
    }
  }
  for (const c of input.onlineCancellations ?? []) {
    events.push({ key: `batal-cair:${c.id}`, at: c.created_at, actor: actorLabel(c.created_by, names, viewerId), label: "Pencairan marketplace dibatalkan (kembali piutang)",
      detail: [`Dana bank ${rp(Number(c.amount_bank))} + komisi ${rp(Number(c.amount_fee))} dibalik`], reason: clean(c.reason), tone: "warn" });
  }
  for (const r of input.returns) {
    events.push({ key: `retur:${r.id}`, at: r.tanggal, actor: actorLabel(null, names, viewerId), label: r.voided_at ? "Retur dibatalkan / diganti" : "Retur dibuat",
      detail: [`${r.no_retur ?? "retur"} · ${rp(Number(r.total))}`], reason: null, tone: "info" });
  }
  return sortHistory(events);
}
