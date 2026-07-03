// Kirim WA via Fonnte (Addendum §3) — helper terpisah dari WA engine rutin.
// ponytail: no retry/queue; kalau butuh reliability tambah antrian belakangan.

export type WaResult = { ok: boolean; reason?: string };

export async function sendWA(phone: string, message: string): Promise<WaResult> {
  const token = process.env.FONNTE_TOKEN;
  if (!token) {
    console.warn("[fonnte] FONNTE_TOKEN belum di-set — WA tidak terkirim.");
    return { ok: false, reason: "FONNTE_TOKEN belum dikonfigurasi (set di .env)" };
  }
  // normalisasi nomor: 08xx → 628xx.
  const target = phone.replace(/\D/g, "").replace(/^0/, "62");
  try {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: JSON.stringify({ target, message }),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: boolean; reason?: string };
    if (!res.ok || body.status === false) return { ok: false, reason: body.reason ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error" };
  }
}
