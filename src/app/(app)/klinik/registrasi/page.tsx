import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { daftarDokter } from "@/lib/dokter";
import { hariIniWIB } from "@/lib/followup";
import { RegistrasiForm } from "./RegistrasiForm";

export default async function RegistrasiPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; booking?: string }>;
}) {
  const { error, booking } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();

  // Kunci cabang ke shift klinik yang lagi jalan — staff cuma boleh transaksi
  // di cabang yang di-assign (user_branches), pilih bebas bikin RLS visits nolak insert.
  const shift = await getOpenShift(supabase as never, user.id, "klinik");

  // STAFF wajib mulai shift dulu (alur kasir) — tanpa shift gak ada cabang terkunci buat dia.
  if (!shift && profile?.role === "STAFF") redirect("/klinik/shift");

  const { data: branches } = shift
    ? { data: [{ id: shift.branch_id, code: "", name: shift.branchName }] }
    : await supabase.from("branches").select("id, code, name").order("name");

  // Ditandai siapa yang memang jaga hari ini — pendaftaran sering menugaskan
  // dokter yang ternyata libur, dan baru ketahuan saat pasien sudah menunggu.
  const dokter = await daftarDokter(supabase, { tanggal: hariIniWIB() });

  // Datang dari booking online: isian awal diambil dari pesanan pelanggan supaya
  // staf tidak mengetik ulang. Booking yang sudah dipakai mendaftar tidak boleh
  // dibuka lagi — kalau tidak, satu pesanan bisa jadi dua kunjungan.
  const { data: bookingRow } = booking
    ? await supabase.from("bookings")
        .select("id, branch_id, poli, nama_pemilik, phone, nama_hewan, jenis_hewan, keluhan, visit_id")
        .eq("id", booking).maybeSingle()
    : { data: null };
  const awal = bookingRow && !bookingRow.visit_id
    ? {
        bookingId: bookingRow.id as string,
        phone: (bookingRow.phone as string) ?? "",
        nama: (bookingRow.nama_pemilik as string) ?? "",
        branchId: (bookingRow.branch_id as string) ?? "",
        poli: (bookingRow.poli as string) ?? "Poli Umum",
        namaHewan: (bookingRow.nama_hewan as string) ?? "",
        jenisHewan: (bookingRow.jenis_hewan as string) ?? "Anjing",
        keluhan: (bookingRow.keluhan as string) ?? "",
      }
    : undefined;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/klinik" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Registrasi Pasien Baru</span>
      </div>

      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}

      <RegistrasiForm branches={branches ?? []} dokter={dokter} lockBranch={!!shift} awal={awal} />
    </>
  );
}
