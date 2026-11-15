// Tanggal efektif (backdate) "Batalkan penerimaan" klinik: aksi server mengirim tanggal hanya bila bukan hari ini, pratinjau tanggal, lepas tanggal.
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: [] as { name: string; params: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as { message: string } | null },
  redirected: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async (name: string, params: Record<string, unknown>) => { state.rpc.push({ name, params }); return state.reply; } }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { state.redirected.push(to); throw new Error("REDIRECT"); } }));
import { batalkanPenerimaanKlinik, lepasTanggalEfektif, pratinjauTanggalBatalPenerimaan } from "../actions";
import { hariIniWIB } from "@/lib/tanggal";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function form(over: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ invoice_id: U(2), visit_id: U(1), reason: "Harga vaksin salah, disetujui pemilik", request_key: "kunci-1", ...over })) f.set(k, v);
  return f;
}
const OK = { status: "CANCELLED", cancellation_id: "c1", invoice_id: U(2), invoice_no: "INV-9", paid_status: "Belum Lunas", amount: 63000, direct_amount: 108000, cash_amount: 0, shift_mode: "nonkas", receipts: [], other_invoices_unpaid: [], applications_released: 0, tanggal: "2026-11-09", effective_date: "2026-11-09", actual_date: "2026-11-12", backdated: true };
const hariIni = hariIniWIB();
beforeEach(() => { state.rpc = []; state.reply = { data: null, error: null }; state.redirected = []; });

it("tanggal mundur dikirim sebagai p_effective_date; hasil memuat tanggal efektif", async () => {
  state.reply = { data: OK, error: null };
  const r = await batalkanPenerimaanKlinik(form({ effective_date: "2026-11-09" }));
  expect(r.ok && r.hasil.effective_date).toBe("2026-11-09");
  expect(state.rpc).toEqual([{ name: "clinic_cancel_invoice_receipt", params: { p_invoice_id: U(2), p_request_key: "kunci-1", p_reason: "Harga vaksin salah, disetujui pemilik", p_effective_date: "2026-11-09" } }]);
});
it("tanggal kosong atau hari ini TIDAK dikirim (sidik permintaan sama persis dengan versi lama)", async () => {
  state.reply = { data: OK, error: null };
  await batalkanPenerimaanKlinik(form({ effective_date: "" })); await batalkanPenerimaanKlinik(form({ effective_date: hariIni })); await batalkanPenerimaanKlinik(form());
  expect(state.rpc.map((c) => "p_effective_date" in c.params)).toEqual([false, false, false]);
});
it("tanggal masa depan tetap dikirim agar DATABASE yang menolak (layar bukan penjaga); format salah ditolak di server", async () => {
  state.reply = { data: null, error: { message: "BATAL_PENERIMAAN_TANGGAL_MASA_DEPAN: tanggal efektif 2030-01-01 belum tiba; paling jauh hari ini (2026-11-12)" } };
  const r = await batalkanPenerimaanKlinik(form({ effective_date: "2030-01-01" }));
  expect(state.rpc[0].params.p_effective_date).toBe("2030-01-01");
  expect(!r.ok && r.pesan).toMatch(/belum tiba/);
  state.rpc = [];
  for (const bad of ["09-11-2026", "2026-11-9", "kemarin", "2026-11-09T00:00"]) { const x = await batalkanPenerimaanKlinik(form({ effective_date: bad })); expect(x.ok).toBe(false); }
  expect(state.rpc).toEqual([]);
});
it("penolakan tanggal dari database diterjemahkan: periode terkunci memuat petunjuk Tutup Buku apa adanya, tanggal sebelum penerimaan, peran tanpa izin", async () => {
  state.reply = { data: null, error: { message: "BATAL_PENERIMAAN_PERIODE_TERKUNCI: Periode akuntansi sampai 2026-11-09 sudah ditutup, jadi tanggal 2026-11-09 tidak bisa dibukukan. Owner perlu membuka kembali periodenya di Keuangan > Tutup Buku, atau pilih tanggal setelah 2026-11-09." } };
  let r = await batalkanPenerimaanKlinik(form({ effective_date: "2026-11-09" }));
  expect(!r.ok && r.pesan).toMatch(/Tutup Buku/);
  state.reply = { data: null, error: { message: "BATAL_PENERIMAAN_TANGGAL_MUNDUR_DITOLAK: Memilih tanggal sebelum hari ini hanya untuk Owner." } };
  r = await batalkanPenerimaanKlinik(form({ effective_date: "2026-11-09" }));
  expect(!r.ok && r.pesan).toMatch(/hanya untuk Owner/);
});
it("pratinjau tanggal: ringkasan memuat satu kalimat tanggal pembukuan; alasan tanggal ditolak diteruskan", async () => {
  const p = { refuse: null, invoice: { id: U(2), no: "INV-9", total: 63000, paid_status: "Lunas", metode_bayar: "QRIS", dp_amount: 0, shift_id: null, visit_id: U(1), branch_id: null }, direct: { amount: 108000, kas_code: "120002", metode: "QRIS" }, payments: [], apps: [], receipts: [], actor: "OWNER", cash_amount: 0, shift_mode: "nonkas", today: "2026-11-12", min_date: "2026-11-09", max_date: "2026-11-12", can_backdate: true, effective_date: "2026-11-09", date_refuse: null, window: null };
  state.reply = { data: p, error: null };
  const r = await pratinjauTanggalBatalPenerimaan(U(2), "2026-11-09");
  expect(r.ok && r.ringkasan.join("\n")).toMatch(/Dicatat di tanggal 2026-11-09; uang fisik tetap hari ini/);
  expect(r.ok && r.minTanggal).toBe("2026-11-09");
  expect(state.rpc[0]).toEqual({ name: "clinic_cancel_invoice_receipt_preview", params: { p_invoice_id: U(2), p_effective_date: "2026-11-09" } });
  state.reply = { data: { ...p, date_refuse: { code: "PERIODE_TERKUNCI", message: "Periode ditutup. Tutup Buku." } }, error: null };
  const r2 = await pratinjauTanggalBatalPenerimaan(U(2), "2026-11-09"); expect(r2.ok && r2.tolakTanggal).toBe("Periode ditutup. Tutup Buku.");
  state.rpc = []; state.reply = { data: { ...p, effective_date: hariIni }, error: null };
  const r3 = await pratinjauTanggalBatalPenerimaan(U(2), hariIni); expect(r3.ok && !r3.ringkasan.join(" ").includes("Dicatat di tanggal")).toBe(true);
  expect("p_effective_date" in state.rpc[0].params).toBe(false);
  expect((await pratinjauTanggalBatalPenerimaan("x", "2026-11-09")).ok).toBe(false); expect((await pratinjauTanggalBatalPenerimaan(U(2), "salah")).ok).toBe(false);
});
it("pratinjau menolak tagihan yang memang tidak bisa dibatalkan dengan pesan database", async () => {
  state.reply = { data: { refuse: { code: "SUDAH_REFUND", message: "Tagihan ini sudah/sedang direfund." }, invoice: {} }, error: null };
  const r = await pratinjauTanggalBatalPenerimaan(U(2), "2026-11-09"); expect(!r.ok && r.pesan).toBe("Tagihan ini sudah/sedang direfund.");
});
it("lepas tanggal efektif: alasan wajib, RPC dipanggil, kembali ke tagihan dengan pesan", async () => {
  state.reply = { data: { status: "DILEPAS" }, error: null };
  await expect(lepasTanggalEfektif(form({ reason: "ab" }))).rejects.toThrow("REDIRECT");
  expect(state.rpc).toEqual([]); expect(state.redirected[0]).toMatch(/error=/);
  state.redirected = [];
  await expect(lepasTanggalEfektif(form({ reason: "Periode ditutup, lanjut hari ini" }))).rejects.toThrow("REDIRECT");
  expect(state.rpc).toEqual([{ name: "clinic_backdate_release", params: { p_invoice_id: U(2), p_reason: "Periode ditutup, lanjut hari ini" } }]);
  expect(state.redirected[0]).toMatch(new RegExp(`^/klinik/pembayaran/${U(1)}\\?invoice_id=${U(2)}&success=`));
  state.rpc = []; state.redirected = []; state.reply = { data: null, error: { message: "ACCESS_DENIED: hanya Owner" } };
  await expect(lepasTanggalEfektif(form())).rejects.toThrow("REDIRECT");
  expect(state.redirected[0]).toMatch(/error=.*Owner/);
  state.redirected = []; await expect(lepasTanggalEfektif(form({ invoice_id: "x" }))).rejects.toThrow("REDIRECT"); expect(state.rpc.length).toBe(1);
});
