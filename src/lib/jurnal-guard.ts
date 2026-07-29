// Pengaman jalur uang. Dua masalah yang ditutup file ini:
//
// 1. Kunci tutup buku ditegakkan TRIGGER DB (migrasi 0055) yang melempar exception.
//    postJournal menelan semua error, jadi jurnal periode terkunci gagal DIAM-DIAM
//    padahal baris transaksinya sudah tertulis. Makanya periode dicek DULU di aplikasi.
// 2. postJournal best-effort: bisa gagal karena sebab lain (kode akun tidak ada,
//    jurnal tidak seimbang) tanpa memberi tahu pemanggil. Untuk uang yang berpindah,
//    keberadaan jurnalnya wajib diverifikasi lalu di-rollback kalau tidak ada.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

// Batas tutup buku bersifat INKLUSIF: tanggal == closed_until masih terkunci
// (sama dengan trigger DB: `new.tanggal <= v_closed`).
export function periodeTerkunci(closedUntil: string | null | undefined, tanggal: string): boolean {
  if (!closedUntil) return false;
  return tanggal <= closedUntil;
}

export async function cekPeriode(supabase: AnyClient, tanggal: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("accounting_locks").select("closed_until").eq("id", true).maybeSingle();

  // Fail-closed: status tidak terbaca ≠ periode terbuka. Kalau dianggap terbuka,
  // justru itu lubang di guard uang ini.
  if (error) {
    console.error("[cekPeriode] gagal baca status tutup buku:", error);
    return "Gagal memeriksa status tutup buku, coba lagi.";
  }
  if (periodeTerkunci(data?.closed_until, tanggal)) {
    return `Periode akuntansi s/d ${data.closed_until} sudah ditutup — tidak bisa posting tanggal ini.`;
  }
  return null;
}

export async function jurnalTersimpan(supabase: AnyClient, source: string, sourceRef: string): Promise<boolean> {
  const { data } = await supabase
    .from("journal_entries").select("id").eq("source", source).eq("source_ref", sourceRef).maybeSingle();
  return !!data;
}
