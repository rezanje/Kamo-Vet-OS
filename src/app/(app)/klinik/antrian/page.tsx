import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { updateVisitStatus } from "./actions";
import { CancelButton } from "./CancelButton";
import { SubmitButton } from "@/components/SubmitButton";
import { LiveRefresh } from "./LiveRefresh";
import { estimatedWaitMinutes } from "@/lib/queue";
import { hariIniWIB } from "@/lib/tanggal";
import { UlasanBadge } from "@/components/UlasanBadge";

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

  // Antrian hari lain & per cabang (permintaan Pak Andri, meeting 14 Agustus):
  // dulu layar ini selalu memakai antrian berjalan seluruh cabang, jadi menengok
  // antrian kemarin cuma bisa lewat database.
  const hariDipilih = tanggal || hariIniWIB();
  const mulaiHari = `${hariDipilih}T00:00:00+07:00`;
  const akhirHari = `${hariDipilih}T23:59:59+07:00`;

  let query = supabase
    .from("visits")
    .select("id, poli, dokter, status, created_at, keluhan, queue_number, called_at, branch_id, pets(name, species, breed, dob, photo_url), customers(name, phone, customer_review_statuses(nama, warna, nada)), branches(code)")
    .gte("created_at", mulaiHari).lte("created_at", akhirHari)
    .order("created_at", { ascending: true });

  if (filter === "aktif") query = query.neq("status", "Selesai");
  if (filter === "menunggu") query = query.eq("status", "Menunggu");
  if (filter === "diperiksa") query = query.eq("status", "Diperiksa");
  if (filter === "selesai") query = query.eq("status", "Selesai");
  if (cabang) query = query.eq("branch_id", cabang);

  // 4 query independen → jalan barengan (kurangi latency berurutan).
  // Kartu angka & "berikutnya dipanggil" ikut hari + cabang yang sedang dilihat,
  // supaya menengok kemarin tidak menampilkan angka hari ini.
  let qWaiting = supabase
    .from("visits")
    .select("id, poli, dokter, queue_number, pets(name, species, breed, dob, photo_url), customers(name, phone)")
    .eq("status", "Menunggu")
    .gte("created_at", mulaiHari).lte("created_at", akhirHari)
    .order("created_at", { ascending: true });
  if (cabang) qWaiting = qWaiting.eq("branch_id", cabang);

  let qHari = supabase.from("visits").select("status")
    .gte("created_at", mulaiHari).lte("created_at", akhirHari);
  if (cabang) qHari = qHari.eq("branch_id", cabang);

  const [{ data: visits }, { data: allWaiting }, { data: today }, { data: cabangList }, { data: voucherAktif }] =
    await Promise.all([
      query,
      qWaiting,
      qHari,
      supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
      // Pengingat voucher untuk admin klinik (permintaan Pak Aldi, meeting 14
      // Agustus): voucher hari-ini-saja tidak ada gunanya kalau petugas depan
      // tidak tahu harus menawarkannya.
      supabase.from("vouchers")
        .select("code, tipe, nilai, valid_from, valid_until, customer_id, category_id, customers(name), customer_categories(nama)")
        .eq("is_active", true),
    ]);

  type VoucherIngat = {
    code: string; tipe: string; nilai: number;
    valid_from: string | null; valid_until: string | null;
    customer_id: string | null; category_id: string | null;
    customers: Rel<{ name: string }>; customer_categories: Rel<{ nama: string }>;
  };
  const hariIni = hariIniWIB();
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
    new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  const nextPet = nextUp ? one(nextUp.pets) : null;

  return (
    <>
      <LiveRefresh />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Link href="/klinik" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 9.5, color: "var(--td)" }}>
          <i className="ti ti-broadcast" style={{ color: "#16a34a" }} /> live — update otomatis via realtime
        </span>
      </div>

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
                  href={`/klinik/antrian?filter=${t.key}${tanggal ? `&tanggal=${tanggal}` : ""}${cabang ? `&cabang=${cabang}` : ""}`}
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
              <input className="fi" type="date" name="tanggal" defaultValue={hariDipilih} max={hariIniWIB()} />
            </div>
            <div style={{ minWidth: 190 }}>
              <label className="flab">Cabang</label>
              <select className="fi" name="cabang" defaultValue={cabang}>
                <option value="">Semua cabang</option>
                {(cabangList ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
            {hariDipilih !== hariIniWIB() && (
              <span style={{ fontSize: 10.5, color: "#b45309" }}>
                <i className="ti ti-history" /> Sedang melihat antrian {hariDipilih}, bukan hari ini.
              </span>
            )}
          </form>

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th>No. Antri</th><th>Pasien</th><th>Pemilik</th><th>Cabang</th>
                  <th>Poli / Dokter</th><th>Jadwal</th><th>Estimasi</th><th>Status</th><th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {(visits ?? []).map((v) => {
                  const pet = one(v.pets);
                  const cust = one(v.customers);
                  const branch = one(v.branches);
                  const pos = waitPos.get(v.id);
                  const meta = STATUS_META[v.status] ?? STATUS_META.Menunggu;
                  const age = petAge(pet?.dob);
                  return (
                    <tr key={v.id} style={{ boxShadow: `inset 3px 0 0 ${meta.border}` }}>
                      <td style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700, fontSize: 12, color: meta.border, paddingLeft: 14 }}>{v.queue_number ?? "—"}</td>
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
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{fmtTime(v.created_at)}</td>
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
                            <Link href={`/klinik/pembayaran/${v.id}`} className="btn-acc"
                              style={{ padding: "4px 10px", fontSize: 10.5, textDecoration: "none" }}>
                              <i className="ti ti-cash" /> Bayar
                            </Link>
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
                })}
                {(visits ?? []).length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "20px 0", fontSize: 11 }}>
                    Tidak ada pasien di antrian.
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
