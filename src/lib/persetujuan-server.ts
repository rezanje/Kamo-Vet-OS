// Pemeriksa persetujuan transaksi (S6). Dipanggil dari server action TEPAT SEBELUM
// uang keluar, bukan saat dokumennya dibuat.
//
// Alurnya sengaja "ajukan lalu ulangi": percobaan pertama membuat pengajuan dan
// menahan transaksinya; setelah disetujui, orang yang sama menekan tombol yang sama
// dan transaksinya lanjut. Tidak ada salinan data pembayaran yang disimpan di
// antrean persetujuan — apa yang dieksekusi selalu apa yang diisi di layar saat itu,
// bukan angka lama yang mengendap di antrean.
import { aturanBerlaku, putuskan, type AturanPersetujuan, type StatusPengajuan } from "@/lib/persetujuan";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export type HasilCek = { boleh: boolean; pesan?: string };

export async function cekPersetujuan(
  supabase: AnyClient,
  o: {
    jenis: string;
    /** Dokumen yang dibayar — faktur, bukti kas, dst. */
    refId: string;
    nilai: number;
    noDokumen?: string | null;
    keterangan?: string | null;
    userId?: string | null;
  },
): Promise<HasilCek> {
  const { data: rulesRaw } = await supabase
    .from("approval_rules")
    .select("id, jenis, min_nilai, penyetuju_role, is_active")
    .eq("jenis", o.jenis).eq("is_active", true);

  const aturan: AturanPersetujuan[] = ((rulesRaw ?? []) as {
    id: string; jenis: string; min_nilai: number; penyetuju_role: string; is_active: boolean;
  }[]).map((r) => ({
    id: r.id, jenis: r.jenis, minNilai: Number(r.min_nilai) || 0,
    penyetujuRole: r.penyetuju_role as AturanPersetujuan["penyetujuRole"],
    aktif: r.is_active,
  }));

  const berlaku = aturanBerlaku(aturan, o.jenis, o.nilai);
  if (!berlaku) return { boleh: true };

  const { data: adaRaw } = await supabase
    .from("approval_requests")
    .select("id, status, catatan")
    .eq("jenis", o.jenis).eq("ref_id", o.refId)
    .in("status", ["menunggu", "disetujui", "ditolak"])
    .order("diajukan_at", { ascending: false })
    .limit(1);

  const ada = ((adaRaw ?? []) as { id: string; status: StatusPengajuan; catatan: string | null }[])[0] ?? null;
  const keputusan = putuskan(berlaku, ada, berlaku.penyetujuRole);

  if (keputusan.boleh) {
    // Persetujuan dipakai sekali. Kalau penandaan gagal, transaksinya TIDAK dilanjutkan —
    // lebih baik pembayaran tertahan daripada satu persetujuan dipakai berkali-kali.
    if (ada) {
      const { error } = await supabase
        .from("approval_requests").update({ status: "terpakai" }).eq("id", ada.id).eq("status", "disetujui");
      if (error) {
        return { boleh: false, pesan: `Gagal memakai persetujuan: ${error.message}` };
      }
    }
    return { boleh: true };
  }

  if (keputusan.alasan === "baru diajukan") {
    const { error } = await supabase.from("approval_requests").insert({
      jenis: o.jenis, ref_id: o.refId, no_dokumen: o.noDokumen ?? null,
      nilai: o.nilai, keterangan: o.keterangan ?? null,
      penyetuju_role: berlaku.penyetujuRole, diajukan_oleh: o.userId ?? null,
    });
    // Kalau pengajuan gagal dibuat, transaksinya tetap ditahan — jangan sampai gagal
    // mencatat izin malah jadi jalan pintas melewati izin.
    if (error) {
      return { boleh: false, pesan: `Transaksi ditahan: gagal membuat pengajuan persetujuan (${error.message}).` };
    }
  }

  return { boleh: false, pesan: keputusan.pesan };
}
