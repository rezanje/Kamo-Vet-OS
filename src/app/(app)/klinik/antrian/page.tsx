import Link from "next/link";
import { hasActiveInpatient } from "@/lib/status-pasien-rekam-medis";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { ALL_BRANCHES, BRANCH_HEADER } from "@/lib/operational-context";
import { availableOperationalBranches, resolveOperationalBranch } from "@/lib/operational-branch";
import { requireOperationalBranch } from "@/lib/operational-branch-server";
import { updateVisitStatus } from "./actions";
import { CancelButton } from "./CancelButton";
import { SubmitButton } from "@/components/SubmitButton";
import { LiveRefresh } from "./LiveRefresh";
import { estimatedWaitMinutes, queueDayBounds } from "@/lib/queue";
import { hariIniWIB } from "@/lib/tanggal";
import { UlasanBadge } from "@/components/UlasanBadge";
import { serviceDurations } from "@/lib/operasional-klinik";
import { branchDisplayName } from "@/lib/branch-display";
import { mulai } from "@/lib/u07-waktu";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

// Umur anabul dari tgl lahir → "X Tahun" / "X Bulan" (ringkas, gaya referensi).
function petAge(dob: string | null | undefined): string | null {
  if (!dob) return null;
  const d = new Date(dob), now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months--;
  if (months < 0) return null;
  const y = Math.floor(months / 12), m = months % 12;
  return y >= 1 ? `${y} Tahun` : `${m} Bulan`;
}

const KOLOM_ANTRIAN = "id, poli, dokter, status, created_at, keluhan, queue_number, called_at, branch_id, checked_in_at, service_started_at, service_finished_at, checked_out_at, pets(name, species, breed, dob, photo_url), customers(name, phone, customer_review_statuses(nama, warna, nada)), branches(code), inpatient_records(discharged_at)";

// Batas baca pasien belum selesai dari hari-hari sebelumnya (terbaru dulu), supaya
// satu layar antrian yang diperbarui tiap 20 detik tidak membaca tanpa batas.
const BATAS_SISA = 200;

// warna aksen per status (kartu, border baris, pill)
const STATUS_META: Record<string, { badge: string; border: string; label: string }> = {
  Menunggu: { badge: "b", border: "var(--posb)", label: "Menunggu" },
  Diperiksa: { badge: "o", border: "#d97706", label: "Diperiksa" },
  Pembayaran: { badge: "r", border: "#b91c1c", label: "Pembayaran" },
  Selesai: { badge: "g", border: "#16a34a", label: "Selesai" },
};

function PetPhoto({ url, size = 38 }: { url?: string | null; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 8, background: "var(--sf1)", border: ".5px solid var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
      {url
        ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <i className="ti ti-paw" style={{ fontSize: size * 0.42, color: "var(--td)" }} />}
    </div>
  );
}

export default async function AntrianPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; success?: string; tanggal?: string; cabang?: string }>;
}) {
  const { filter = "aktif", success, tanggal = "", cabang = "" } = await searchParams;
  const supabase = await createClient();
  // Klinik-A: label cabang & pengingat voucher tidak bergantung pada akun/cabang, jadi
  // dibaca bersamaan dengan pemeriksaan sesi & cabang (dulu antre di belakangnya).
  const labelCatalogP = mulai(supabase.from("branches").select("code,name,type").eq("is_active", true));
  // Pengingat voucher untuk admin klinik (permintaan Pak Aldi, meeting 14
  // Agustus): voucher hari-ini-saja tidak ada gunanya kalau petugas depan
  // tidak tahu harus menawarkannya.
  const voucherAktifP = mulai(supabase.from("vouchers")
    .select("code, tipe, nilai, valid_from, valid_until, customer_id, category_id, customers(name), customer_categories(nama)")
    .eq("is_active", true));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const allMode = (await headers()).get(BRANCH_HEADER) === ALL_BRANCHES;
  const allAccess = allMode ? await resolveOperationalBranch(supabase, user.id, "klinik", ALL_BRANCHES) : null;
  if (allMode && !allAccess) redirect("/mulai/cabang?mode=klinik");
  const branches = allMode ? await availableOperationalBranches(supabase, user.id, "klinik") : [];
  const selected = branches.find(b => b.id === cabang);
  const branch = allAccess ? selected ?? allAccess : await requireOperationalBranch(supabase, user.id, "klinik");
  const { data: labelCatalog } = await labelCatalogP;
  const branchLabel = branch.id === ALL_BRANCHES ? branch.name : branchDisplayName(branch, labelCatalog ?? []);
  const scopeIds = allAccess ? selected ? [selected.id] : branches.map(b => b.id) : [branch.id];

  // Keep historical views within the authenticated operational branch.
  const hariIni = hariIniWIB();
  const requestedDay = queueDayBounds(tanggal || hariIni);
  const day = requestedDay ?? queueDayBounds(hariIni)!;
  const hariDipilih = day.date;
  const mulaiHari = day.from;
  const akhirHari = day.until;
  const lihatHariIni = hariDipilih === hariIni;

  let query = supabase
    .from("visits")
    .select(KOLOM_ANTRIAN)
    .in("branch_id", scopeIds)
    .gte("created_at", mulaiHari).lt("created_at", akhirHari)
    .order("created_at", { ascending: true });

  if (filter === "aktif") query = query.neq("status", "Selesai");
  if (filter === "menunggu") query = query.eq("status", "Menunggu");
  if (filter === "diperiksa") query = query.eq("status", "Diperiksa");
  if (filter === "selesai") query = query.eq("status", "Selesai");

  // Counters and next-up use the same day/branch, independent of the status tab.
  // One read serves both: next-up is the day's Menunggu rows in arrival order.
  const qHari = supabase
    .from("visits")
    .select("id, poli, dokter, status, queue_number, pets(name, species, breed, dob, photo_url), customers(name, phone), inpatient_records(discharged_at)")
    .in("branch_id", scopeIds)
    .gte("created_at", mulaiHari).lt("created_at", akhirHari)
    .order("created_at", { ascending: true });

  // Pasien hari sebelumnya yang belum selesai (belum diperiksa / belum dibayar) tetap
  // tampil di antrian hari ini. Tanpa ini, lewat 00:00 WIB pasien shift malam yang
  // belum lunas "hilang" dari layar walau datanya utuh (laporan klinik 2 Nov 2026).
  // Hanya untuk tampilan hari ini; melihat tanggal lampau tetap persis hari itu.
  const qSisa = lihatHariIni
    ? supabase
      .from("visits")
      .select(KOLOM_ANTRIAN)
      .in("branch_id", scopeIds)
      .neq("status", "Selesai")
      .lt("created_at", mulaiHari)
      .order("created_at", { ascending: false })
      .limit(BATAS_SISA)
    : null;

  const [visitsResult, todayResult, sisaResult, { data: voucherAktif }] =
    await Promise.all([
      query,
      qHari,
      qSisa,
      voucherAktifP,
    ]);
  if (visitsResult.error || todayResult.error || sisaResult?.error) {
    return <>
      <LiveRefresh branchId={branch.id} />
      <div role="alert" className="p2ban">Antrian gagal dimuat. Periksa koneksi dan coba lagi. Data pasien belum dapat ditampilkan.</div>
      <Link href={`/klinik/antrian?${new URLSearchParams({ filter, tanggal: hariDipilih, cabang: selected?.id ?? "" })}`} className="btn-def">Coba lagi</Link>
    </>;
  }
  const operational = (row: { inpatient_records?: { discharged_at: string | null }[] | { discharged_at: string | null } | null }) => !hasActiveInpatient(row.inpatient_records);
  const visits = filter === "semua" || filter === "selesai" ? visitsResult.data : visitsResult.data?.filter(operational);
  const today = todayResult.data?.filter(operational);
  const allWaiting = today?.filter((v) => v.status === "Menunggu");
  // Rawat inap aktif tetap diurus dari Rawat Inap; sisanya ikut saringan tab status.
  const sisaSemua = (sisaResult?.data ?? []).filter(operational);
  const sisaTerpotong = (sisaResult?.data?.length ?? 0) >= BATAS_SISA;
  const sisa = sisaSemua.filter((v) =>
    filter === "menunggu" ? v.status === "Menunggu"
      : filter === "diperiksa" ? v.status === "Diperiksa"
        : filter !== "selesai");
  const sisaHitung = { Menunggu: 0, Diperiksa: 0, Pembayaran: 0 };
  for (const v of sisaSemua) if (v.status in sisaHitung) sisaHitung[v.status as keyof typeof sisaHitung]++;

  type VoucherIngat = {
    code: string; tipe: string; nilai: number;
    valid_from: string | null; valid_until: string | null;
    customer_id: string | null; category_id: string | null;
    customers: Rel<{ name: string }>; customer_categories: Rel<{ nama: string }>;
  };
  // Yang diingatkan: voucher yang MULAI hari ini (perlu ditawarkan) dan yang
  // BERAKHIR hari ini (kesempatan terakhir). Sisanya tidak perlu mengganggu layar.
  const ingatVoucher = ((voucherAktif ?? []) as unknown as VoucherIngat[]).filter(
    (v) => v.valid_from === hariIni || v.valid_until === hariIni,
  );

  const nextUp = (allWaiting ?? [])[0];
  const poliCounts = new Map<string, number>();
  for (const v of allWaiting ?? []) poliCounts.set(v.poli, (poliCounts.get(v.poli) ?? 0) + 1);
  const waitPos = new Map<string, number>();
  (allWaiting ?? []).forEach((v, i) => waitPos.set(v.id as string, i));

  const counts = { Menunggu: 0, Diperiksa: 0, Pembayaran: 0, Selesai: 0 };
  for (const v of today ?? []) {
    if (v.status in counts) counts[v.status as keyof typeof counts]++;
  }
  const totalToday = today?.length ?? 0;

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  const fmtOptional = (iso: string | null | undefined) => iso ? fmtTime(iso) : "—";
  // Nomor antrian berulang tiap hari, jadi baris dari hari lain wajib membawa tanggalnya.
  const fmtTgl = (iso: string) =>
    new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });

  const nextPet = nextUp ? one(nextUp.pets) : null;

  const kepalaTabel = (
    <thead>
      <tr>
        <th>No. Antri</th><th>Pasien</th><th>Pemilik</th><th>Cabang</th>
        <th>Poli / Dokter</th><th>Jadwal</th><th>Estimasi</th><th>Status</th><th>Aksi</th>
      </tr>
    </thead>
  );

  type BarisAntrian = NonNullable<typeof visitsResult.data>[number];
  const barisAntrian = (v: BarisAntrian, dariHariLalu = false) => {
    const pet = one(v.pets);
    const cust = one(v.customers);
    const branch = one(v.branches);
    const pos = dariHariLalu ? undefined : waitPos.get(v.id);
    const meta = STATUS_META[v.status] ?? STATUS_META.Menunggu;
    const age = petAge(pet?.dob);
    const durations = serviceDurations({
      checkedInAt: v.checked_in_at ?? null,
      serviceStartedAt: v.service_started_at ?? null,
      serviceFinishedAt: v.service_finished_at ?? null,
      checkedOutAt: v.checked_out_at ?? null,
    });
    return (
      <tr key={v.id} style={{ boxShadow: `inset 3px 0 0 ${meta.border}` }}>
        <td style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: meta.border, paddingLeft: 14 }}>
          {v.queue_number ?? "—"}
          {dariHariLalu && (
            <div style={{ fontFamily: "inherit", fontSize: 9.5, fontWeight: 600, color: "#b45309", marginTop: 2 }}>
              <i className="ti ti-history" /> {fmtTgl(v.created_at)}
            </div>
          )}
        </td>
        <td>
          <Link href={`/klinik/antrian/${v.id}`} style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: "inherit" }}>
            <PetPhoto url={pet?.photo_url} />
            <div>
              <div style={{ fontWeight: 600, color: "var(--posb)" }}>{pet?.name ?? "—"}</div>
              <div style={{ fontSize: 10, color: "var(--tm)" }}>
                {pet?.species}{pet?.breed ? ` / ${pet.breed}` : ""}{age ? ` · ${age}` : ""}
              </div>
            </div>
          </Link>
        </td>
        <td>
          <div style={{ fontSize: 11.5 }}>{cust?.name ?? "—"}</div>
          <div style={{ fontSize: 10, color: "var(--tm)" }}>{cust?.phone}</div>
          {one(cust?.customer_review_statuses ?? null) && (
            <div style={{ marginTop: 3 }}><UlasanBadge s={one(cust!.customer_review_statuses)!} size={9.5} /></div>
          )}
        </td>
        <td style={{ fontSize: 11, color: "var(--tm)" }}>{branch?.code ?? "—"}</td>
        <td>
          <div style={{ fontSize: 11.5 }}>{v.poli}</div>
          {v.dokter && <div style={{ fontSize: 10, color: "var(--tm)" }}>{v.dokter}</div>}
        </td>
        <td style={{ fontSize: 10.5, color: "var(--tm)", lineHeight: 1.55 }}>
          <div>Daftar {dariHariLalu ? `${fmtTgl(v.created_at)} ` : ""}{fmtTime(v.created_at)}</div>
          <div>Check-in {fmtOptional(v.checked_in_at)}</div>
          <div>Mulai {fmtOptional(v.service_started_at)} · Selesai {fmtOptional(v.service_finished_at)}</div>
          <div style={{ color: "var(--td)" }}>Tunggu {durations.waitMinutes == null ? "Belum tercatat" : `${durations.waitMinutes} mnt`} · Layanan {durations.serviceMinutes == null ? "Belum tercatat" : `${durations.serviceMinutes} mnt`}</div>
        </td>
        <td style={{ fontSize: 10.5, color: "var(--tm)" }}>
          {v.status === "Menunggu" && pos !== undefined ? `± ${estimatedWaitMinutes(pos)} mnt` : "—"}
        </td>
        <td><span className={`bge ${meta.badge}`}>{meta.label}</span></td>
        <td>
          <div style={{ display: "flex", gap: 5 }}>
            <Link href={`/klinik/antrian/${v.id}`} className="btn-def"
              style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <i className="ti ti-eye" /> Detail
            </Link>
            {v.status === "Menunggu" && (
              <>
                <form action={updateVisitStatus}>
                  <input type="hidden" name="id" value={v.id} />
                  <input type="hidden" name="status" value="Diperiksa" />
                  <SubmitButton className="btn-acc" icon="ti-bell" style={{ padding: "4px 10px", fontSize: 10.5, background: "var(--posb)" }} pendingText="…">Panggil</SubmitButton>
                </form>
                <CancelButton id={v.id} />
              </>
            )}
            {v.status === "Diperiksa" && (
              <Link href={`/klinik/rekam-medis/${v.id}`} className="btn-acc"
                style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                <i className="ti ti-stethoscope" /> Rekam medis
              </Link>
            )}
            {v.status === "Pembayaran" && (
              <>
              <Link href={`/klinik/rekam-medis/${v.id}`} className="btn-def"
                style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                <i className="ti ti-stethoscope" /> Buka rekam medis
              </Link>
              <Link href={`/klinik/pembayaran/${v.id}`} className="btn-acc"
                style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                <i className="ti ti-cash" /> Bayar
              </Link>
              </>
            )}
            {v.status === "Selesai" && (
              <>
                <Link href={`/klinik/rekam-medis/${v.id}`} className="btn-def"
                  style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-eye" /> Lihat
                </Link>
                <Link href={`/klinik/pembayaran/${v.id}`} className="btn-def"
                  style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <i className="ti ti-file-invoice" /> Tagihan
                </Link>
              </>
            )}
          </div>
        </td>
      </tr>
    );
  };

  const rincianSisa = [
    sisaHitung.Pembayaran ? `${sisaHitung.Pembayaran} belum dibayar` : "",
    sisaHitung.Diperiksa ? `${sisaHitung.Diperiksa} sedang diperiksa` : "",
    sisaHitung.Menunggu ? `${sisaHitung.Menunggu} belum dipanggil` : "",
  ].filter(Boolean).join(" · ");

  return (
    <>
      <LiveRefresh branchId={branch.id} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 9.5, color: "var(--td)" }}>
          <i className="ti ti-broadcast" /> Pembaruan otomatis · cabang {branchLabel}
        </span>
      </div>

      {(!requestedDay || (!allMode && cabang && cabang !== branch.id)) && <div role="status" className="p2ban">
        {!requestedDay ? "Tanggal tidak valid; menampilkan hari ini. " : ""}
        {!allMode && cabang && cabang !== branch.id ? "Filter cabang pada tautan berbeda; menampilkan cabang aktif. Gunakan Ganti cabang untuk berpindah." : ""}
      </div>}

      {/* Judul besar (gaya referensi) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <i className="ti ti-users" style={{ fontSize: 22, color: "var(--posb)" }} />
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--sb)", lineHeight: 1.1 }}>ANTRIAN PASIEN</div>
          <div style={{ fontSize: 11.5, color: "var(--tm)" }}>Daftar pasien yang sedang menunggu pelayanan</div>
        </div>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" />{" "}
          {success === "bayar"
            ? "Pembayaran selesai, kunjungan ditutup."
            : Number(success) > 1
              ? `${success} pasien berhasil didaftarkan, nomor antriannya berurutan.`
              : "Pasien berhasil didaftarkan, masuk antrian."}
        </div>
      )}

      {ingatVoucher.length > 0 && (
        <div className="p2ban" style={{ background: "#f5f3ff", border: ".5px solid #c4b5fd", color: "#6d28d9" }}>
          <i className="ti ti-ticket" /> Voucher yang perlu ditawarkan hari ini:{" "}
          {ingatVoucher.map((v) => {
            const sasaran = one(v.customers)?.name ?? one(v.customer_categories)?.nama ?? null;
            const nilai = v.tipe === "persen" ? `${Number(v.nilai)}%` : `Rp ${Math.round(Number(v.nilai)).toLocaleString("id-ID")}`;
            const akhir = v.valid_until === hariIni ? " · terakhir hari ini" : "";
            return `${v.code} (${nilai}${sasaran ? ` · khusus ${sasaran}` : ""}${akhir})`;
          }).join(", ")}.
        </div>
      )}

      {lihatHariIni && sisaSemua.length > 0 && (
        <div role="status" className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fde68a", color: "#92400e" }}>
          <i className="ti ti-history" /> Ada {sisaSemua.length} pasien dari hari sebelumnya yang belum selesai
          {rincianSisa ? ` (${rincianSisa})` : ""}.{" "}
          {sisa.length > 0
            ? "Daftarnya ada di bagian “Belum selesai dari hari sebelumnya” di bawah; lanjutkan pemeriksaan atau pembayarannya dari sana."
            : <Link href={`/klinik/antrian?${new URLSearchParams({ filter: "aktif", cabang: selected?.id ?? "" })}`} style={{ color: "inherit", fontWeight: 700 }}>Lihat di tab Aktif</Link>}
        </div>
      )}

      {/* Stat cards berwarna (gaya referensi) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
        {([
          { label: "TOTAL ANTRIAN", val: totalToday, color: "var(--posb)", bg: "#eff6ff", icon: "ti-users" },
          { label: "MENUNGGU", val: counts.Menunggu, color: "#16a34a", bg: "#e8f5ee", icon: "ti-clock" },
          { label: "SEDANG DIPERIKSA", val: counts.Diperiksa, color: "#d97706", bg: "#fffbeb", icon: "ti-stethoscope" },
          // Label tanpa "hari ini": angka-angka ini ikut tanggal yang sedang dilihat.
          { label: "SELESAI", val: counts.Selesai, color: "#7c3aed", bg: "#f3f0ff", icon: "ti-clipboard-check" },
        ] as const).map((c) => (
          <div key={c.label} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <i className={`ti ${c.icon}`} style={{ color: c.color, fontSize: 22 }} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: c.color, letterSpacing: ".03em" }}>{c.label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "#141413", lineHeight: 1.1 }}>{c.val}</div>
                <div style={{ fontSize: 10, color: "var(--tm)" }}>Pasien</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Layout 2 kolom: tabel kiri, sidebar kanan */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14, alignItems: "start" }}>
        {/* ===== KIRI: tabel antrian ===== */}
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {[
                { key: "semua", label: "Semua Antrian" },
                { key: "menunggu", label: "Menunggu" },
                { key: "diperiksa", label: "Sedang Diperiksa" },
                { key: "selesai", label: "Selesai" },
                { key: "aktif", label: "Aktif" },
              ].map((t) => (
                <Link key={t.key}
                  href={`/klinik/antrian?filter=${t.key}&tanggal=${hariDipilih}&cabang=${selected?.id ?? ""}`}
                  className="back-btn"
                  style={{
                    padding: "5px 12px", borderRadius: 7, border: ".5px solid var(--bd)",
                    background: filter === t.key ? "var(--posb)" : "#fff",
                    color: filter === t.key ? "#fff" : "var(--tm)",
                  }}>
                  {t.label}
                </Link>
              ))}
            </div>
            <Link href="/klinik/registrasi" className="btn-acc" style={{ textDecoration: "none", background: "var(--posb)", flexShrink: 0 }}>
              <i className="ti ti-plus" /> Daftarkan pasien
            </Link>
          </div>

          {/* Saringan tanggal & cabang — boleh mundur ke hari-hari sebelumnya. */}
          <form method="get" style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
            <input type="hidden" name="filter" value={filter} />
            <div style={{ width: 150 }}>
              <label className="flab">Tanggal</label>
              <input className="fi" type="date" name="tanggal" defaultValue={hariDipilih} max={hariIni} />
            </div>
            <div style={{ minWidth: 190 }}>
              <label className="flab">Cabang</label>
              {allMode ? <select className="fi" name="cabang" defaultValue={selected?.id ?? ""} aria-label="Filter cabang">
                <option value="">Semua cabang</option>
                {branches.map(b => <option key={b.id} value={b.id}>{branchDisplayName(b, labelCatalog ?? [])}</option>)}
              </select> : <input className="fi" value={branchLabel} readOnly aria-label="Cabang aktif" />}
            </div>
            <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
            {!lihatHariIni && (
              <span style={{ fontSize: 10.5, color: "#b45309" }}>
                <i className="ti ti-history" /> Sedang melihat antrian {hariDipilih}, bukan hari ini.
              </span>
            )}
          </form>

          {lihatHariIni && sisa.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "#b45309", letterSpacing: ".04em", marginBottom: 4 }}>
                <i className="ti ti-history" /> BELUM SELESAI DARI HARI SEBELUMNYA · {sisa.length} PASIEN
              </div>
              <div style={{ fontSize: 10.5, color: "var(--tm)", marginBottom: 6 }}>
                Pasien yang didaftarkan sebelum hari ini dan belum diperiksa atau belum dibayar. Nomor antrian berlaku pada tanggal daftarnya.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="tbl" style={{ minWidth: 780 }}>
                  {kepalaTabel}
                  <tbody>{sisa.map((v) => barisAntrian(v, true))}</tbody>
                </table>
              </div>
              {sisaTerpotong && (
                <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 6 }}>
                  Menampilkan {BATAS_SISA} pasien terbaru. Yang lebih lama bisa dilihat lewat filter Tanggal.
                </div>
              )}
            </div>
          )}

          {lihatHariIni && sisa.length > 0 && (
            <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--posb)", letterSpacing: ".04em", marginBottom: 6 }}>
              <i className="ti ti-calendar" /> ANTRIAN HARI INI
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 780 }}>
              {kepalaTabel}
              <tbody>
                {(visits ?? []).map((v) => barisAntrian(v))}
                {(visits ?? []).length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Tidak ada pasien untuk filter ini di {branchLabel}, tanggal {hariDipilih}.
                    {filter === "selesai" ? " Pasien baru ada di tab Menunggu atau Aktif." : ""}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== KANAN: sidebar ===== */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Panggilan berikutnya */}
          <div className="card" style={{ borderColor: "var(--posb)" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--posb)", letterSpacing: ".05em", marginBottom: 10 }}>
              <i className="ti ti-bell-ringing" /> PANGGILAN BERIKUTNYA
            </div>
            {nextUp ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 800, color: "var(--posb)", fontFamily: "ui-monospace, monospace", lineHeight: 1 }}>
                    {nextUp.queue_number ?? "—"}
                  </div>
                  <PetPhoto url={nextPet?.photo_url} size={64} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{nextPet?.name ?? "—"}</div>
                    <div style={{ fontSize: 10.5, color: "var(--tm)" }}>
                      {nextPet?.species}{nextPet?.breed ? ` / ${nextPet.breed}` : ""}
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--tm)", borderTop: ".5px solid var(--bd)", paddingTop: 8, width: "100%" }}>
                    Pemilik: {one(nextUp.customers)?.name ?? "—"}<br />
                    {nextUp.poli}{nextUp.dokter ? ` · ${nextUp.dokter}` : ""}
                  </div>
                </div>
                <form action={updateVisitStatus} style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={nextUp.id} />
                  <input type="hidden" name="status" value="Diperiksa" />
                  <SubmitButton className="pay-btn" icon="ti-bell" style={{ background: "var(--posb)" }} pendingText="Memanggil…">Panggil Sekarang</SubmitButton>
                </form>
              </>
            ) : (
              <div style={{ fontSize: 12, color: "var(--td)", textAlign: "center", padding: "12px 0" }}>Tidak ada antrian menunggu.</div>
            )}
          </div>

          {/* Informasi poli */}
          <div className="card">
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--sb)", letterSpacing: ".05em", marginBottom: 8 }}>
              <i className="ti ti-building-hospital" /> INFORMASI POLI (MENUNGGU)
            </div>
            {poliCounts.size === 0 ? (
              <div style={{ fontSize: 11, color: "var(--td)" }}>Semua poli kosong.</div>
            ) : (
              [...poliCounts.entries()].map(([poli, n]) => (
                <div key={poli} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: ".5px solid var(--bd)" }}>
                  <span style={{ fontSize: 11.5, color: "var(--tx)" }}>{poli}</span>
                  <span className="bge b">{n} Antrian</span>
                </div>
              ))
            )}
          </div>

          {/* Keterangan status */}
          <div className="card" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: "#92400e", letterSpacing: ".05em", marginBottom: 8 }}>
              <i className="ti ti-info-circle" /> KETERANGAN STATUS
            </div>
            {([
              { color: "var(--posb)", label: "Menunggu", desc: "Pasien menunggu giliran" },
              { color: "#d97706", label: "Sedang Diperiksa", desc: "Pasien dalam pemeriksaan dokter" },
              { color: "#16a34a", label: "Selesai", desc: "Pemeriksaan telah selesai" },
            ] as const).map((s) => (
              <div key={s.label} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.color, marginTop: 3, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--tx)" }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: "var(--tm)" }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
