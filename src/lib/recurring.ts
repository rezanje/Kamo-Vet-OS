// Jurnal Berulang — catch-up bulanan (pola penyusutan): posting semua bulan tertinggal.
// Idempotent via last_posted (YYYY-MM). Dipanggil lazy dari halaman Jurnal Umum.

import { postJournal } from "./posting";
import { jurnalTersimpan } from "./jurnal-guard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

type RJLine = { code: string; debit: number; credit: number };
type RJ = {
  id: string; nama: string; deskripsi: string | null; day_of_month: number;
  branch_id: string | null; lines: RJLine[]; is_active: boolean; last_posted: string | null;
};

const MAX_CATCHUP = 12; // ponytail: batas mundur 12 bulan

// Daftar periode YYYY-MM dari (last_posted, bulan-berjalan]. PURE — dites.
//
// dayOfMonth = tanggal jatuhnya jurnal. Bulan BERJALAN hanya ikut kalau tanggal itu
// sudah lewat; kalau tidak, jurnal sewa tanggal 25 akan diposting bertanggal 25 padahal
// hari ini baru tanggal 10 — beban masa depan masuk ke laporan bulan ini.
export function periodeTertinggal(lastPosted: string | null, now: Date, dayOfMonth = 1): string[] {
  const bulanIni = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const batas = now.getDate() >= dayOfMonth ? bulanIni : bulanSebelum(bulanIni);

  const out: string[] = [];
  const cursor = lastPosted
    ? new Date(Number(lastPosted.slice(0, 4)), Number(lastPosted.slice(5, 7)), 1) // bulan setelah last_posted
    : new Date(now.getFullYear(), now.getMonth(), 1);                             // belum pernah: bulan ini saja
  while (out.length < MAX_CATCHUP) {
    const p = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    if (p > batas) break;
    out.push(p);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

function bulanSebelum(periode: string): string {
  const y = Number(periode.slice(0, 4));
  const m = Number(periode.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export async function postRecurringCatchUp(supabase: AnyClient): Promise<{ nama: string; periode: string }[]> {
  const { data } = await supabase.from("recurring_journals").select("*").eq("is_active", true);
  const posted: { nama: string; periode: string }[] = [];
  const now = new Date();

  for (const rj of (data ?? []) as RJ[]) {
    const periods = periodeTertinggal(rj.last_posted, now, rj.day_of_month);
    // last_posted hanya boleh maju sejauh periode yang jurnalnya BENAR-BENAR ada.
    // postJournal best-effort: kalau bulan ke-2 gagal (periode terkunci, akun hilang),
    // menaikkan last_posted ke bulan terakhir bikin bulan itu hilang selamanya.
    let terakhirSukses: string | null = null;
    for (const periode of periods) {
      const tanggal = `${periode}-${String(rj.day_of_month).padStart(2, "0")}`;
      const ref = `${rj.id.slice(0, 8)}-${periode}`;
      await postJournal(supabase, {
        tanggal,
        deskripsi: `${rj.nama} (jurnal berulang ${periode})${rj.deskripsi ? ` — ${rj.deskripsi}` : ""}`,
        source: "recurring",
        sourceRef: ref,
        branchId: rj.branch_id,
        lines: (rj.lines ?? []).map((l) => ({ code: l.code, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      });
      if (!(await jurnalTersimpan(supabase, "recurring", ref))) break;
      terakhirSukses = periode;
      posted.push({ nama: rj.nama, periode });
    }
    if (terakhirSukses) {
      await supabase.from("recurring_journals")
        .update({ last_posted: terakhirSukses })
        .eq("id", rj.id);
    }
  }
  return posted;
}
