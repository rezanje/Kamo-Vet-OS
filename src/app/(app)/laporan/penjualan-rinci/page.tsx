import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LaporanPage, KartuAngka, TabelKosong } from "@/components/LaporanPage";
import { hariIniWIB } from "@/lib/tanggal";

// Rincian penjualan PER DOKUMEN (per struk / per invoice) — pelengkap laporan
// "Penjualan per Kasir" yang hanya menampilkan rekap per orang. Sebelum halaman ini
// ada, satu-satunya jalan melihat struk satuan adalah lewat layar Retur Penjualan.

type Rel<T> = T | T[] | null;
const one = <T,>(r: Rel<T>): T | null => (Array.isArray(r) ? (r[0] ?? null) : r);

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const jam = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  });

const awalBulan = () => hariIniWIB().slice(0, 8) + "01";

type Kanal = "POS" | "Online" | "Klinik";

type Baris = {
  id: string;
  href: string;
  nomor: string;
  waktu: string;
  kanal: Kanal;
  cabang: string;
  pelanggan: string;
  metode: string;
  total: number;
  status: string;
};

const BADGE: Record<Kanal, { cls: string; style?: React.CSSProperties }> = {
  POS: { cls: "bge g" },
  Online: { cls: "bge", style: { background: "#fff1eb", color: "#ea580c" } },
  Klinik: { cls: "bge b" },
};

export default async function PenjualanRinciPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; cabang?: string; kanal?: string }>;
}) {
  const sp = await searchParams;
  const dari = sp.dari || awalBulan();
  const sampai = sp.sampai || hariIniWIB();
  const cabang = sp.cabang || "";
  const kanal = sp.kanal || "";

  const supabase = await createClient();
  // Rentang dipakai apa adanya sebagai batas hari WIB. created_at disimpan UTC,
  // jadi batasnya digeser 7 jam supaya struk jam 07:00 WIB tidak jatuh ke hari sebelumnya.
  const mulai = `${dari}T00:00:00+07:00`;
  const akhir = `${sampai}T23:59:59+07:00`;

  const [{ data: sales }, { data: invoices }, { data: cabangList }] = await Promise.all([
    supabase
      .from("sales")
      .select("id, no_struk, total, metode_bayar, channel, marketplace_status, created_at, branches(name), customers(name)")
      .gte("created_at", mulai).lte("created_at", akhir)
      .order("created_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, invoice_no, total, metode_bayar, paid_status, created_at, visit_id, visits(branches(name), customers(name))")
      .is("voided_at", null)
      .gte("created_at", mulai).lte("created_at", akhir)
      .order("created_at", { ascending: false }),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  type SaleRow = {
    id: string; no_struk: string | null; total: number; metode_bayar: string | null;
    channel: string | null; marketplace_status: string | null; created_at: string;
    branches: Rel<{ name: string }>; customers: Rel<{ name: string }>;
  };
  type InvRow = {
    id: string; invoice_no: string | null; total: number; metode_bayar: string | null;
    paid_status: string | null; created_at: string; visit_id: string;
    visits: Rel<{ branches: Rel<{ name: string }>; customers: Rel<{ name: string }> }>;
  };

  const barisSales: Baris[] = ((sales ?? []) as unknown as SaleRow[]).map((s) => ({
    id: s.id,
    href: `/penjualan/${s.id}`,
    nomor: s.no_struk ?? "—",
    waktu: s.created_at,
    kanal: s.channel ? "Online" : "POS",
    cabang: one(s.branches)?.name ?? "—",
    pelanggan: one(s.customers)?.name ?? "—",
    metode: s.channel ?? s.metode_bayar ?? "—",
    total: Number(s.total) || 0,
    // Order marketplace baru jadi uang setelah dana cair; POS selalu lunas di kasir.
    status: s.channel ? (s.marketplace_status === "piutang" ? "Belum cair" : "Cair") : "Lunas",
  }));

  const barisKlinik: Baris[] = ((invoices ?? []) as unknown as InvRow[]).map((i) => {
    const v = one(i.visits);
    return {
      id: i.id,
      href: `/klinik/pembayaran/${i.visit_id}/invoice`,
      nomor: i.invoice_no ?? "—",
      waktu: i.created_at,
      kanal: "Klinik" as const,
      cabang: one(v?.branches ?? null)?.name ?? "—",
      pelanggan: one(v?.customers ?? null)?.name ?? "—",
      metode: i.metode_bayar ?? "—",
      total: Number(i.total) || 0,
      status: i.paid_status ?? "—",
    };
  });

  const rows = [...barisSales, ...barisKlinik]
    .filter((r) => (cabang ? r.cabang === cabang : true))
    .filter((r) => (kanal ? r.kanal === kanal : true))
    .sort((a, b) => b.waktu.localeCompare(a.waktu));

  const totalOmzet = rows.reduce((a, r) => a + r.total, 0);
  const perKanal = (k: Kanal) => rows.filter((r) => r.kanal === k).reduce((a, r) => a + r.total, 0);

  return (
    <LaporanPage
      icon="ti-list-details" title="RINCIAN PENJUALAN PER TRANSAKSI"
      desc="Semua struk kasir, order online, dan invoice klinik dalam satu daftar. Klik nomornya untuk melihat isi transaksi."
      filter={
        <>
          <div>
            <label className="flab">Dari tanggal</label>
            <input className="fi" type="date" name="dari" defaultValue={dari} />
          </div>
          <div>
            <label className="flab">Sampai tanggal</label>
            <input className="fi" type="date" name="sampai" defaultValue={sampai} />
          </div>
          <div style={{ minWidth: 190 }}>
            <label className="flab">Cabang</label>
            <select className="fi" name="cabang" defaultValue={cabang}>
              <option value="">Semua cabang</option>
              {(cabangList ?? []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label className="flab">Jenis</label>
            <select className="fi" name="kanal" defaultValue={kanal}>
              <option value="">Semua jenis</option>
              <option value="POS">Kasir (POS)</option>
              <option value="Online">Online</option>
              <option value="Klinik">Klinik</option>
            </select>
          </div>
          <button type="submit" className="btn-def"><i className="ti ti-filter" /> Tampilkan</button>
        </>
      }
      ringkasan={
        <KartuAngka items={[
          { label: "Jumlah transaksi", nilai: `${rows.length}x` },
          { label: "Total omzet", nilai: rp(totalOmzet), warna: "#15803d" },
          { label: "Kasir (POS)", nilai: rp(perKanal("POS")) },
          { label: "Online", nilai: rp(perKanal("Online")) },
          { label: "Klinik", nilai: rp(perKanal("Klinik")) },
        ]} />
      }
    >
      <div className="crm-sec" style={{ marginBottom: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 160 }}>No. Dokumen</th>
                <th style={{ width: 130 }}>Waktu</th>
                <th style={{ width: 80 }}>Jenis</th>
                <th>Cabang</th>
                <th>Pelanggan</th>
                <th style={{ width: 110 }}>Pembayaran</th>
                <th style={{ width: 90, textAlign: "center" }}>Status</th>
                <th style={{ width: 120, textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kanal}-${r.id}`}>
                  <td style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                    <Link href={r.href} style={{ color: "#2563eb", textDecoration: "none" }}>{r.nomor}</Link>
                  </td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{jam(r.waktu)}</td>
                  <td>
                    <span className={BADGE[r.kanal].cls} style={{ fontSize: 9, ...BADGE[r.kanal].style }}>{r.kanal}</span>
                  </td>
                  <td style={{ fontSize: 11 }}>{r.cabang}</td>
                  <td style={{ fontSize: 11 }}>{r.pelanggan}</td>
                  <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{r.metode}</td>
                  <td style={{ textAlign: "center", fontSize: 10 }}>
                    <span className={`bge ${r.status === "Lunas" || r.status === "Cair" ? "g" : "r"}`} style={{ fontSize: 9 }}>
                      {r.status}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{rp(r.total)}</td>
                </tr>
              ))}
              {rows.length === 0 && <TabelKosong kolom={8} pesan="Belum ada transaksi di rentang tanggal ini." />}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: "var(--td)", marginTop: 8 }}>
          Invoice klinik yang dibatalkan tidak ditampilkan. Order online berstatus &quot;Belum cair&quot;
          berarti dananya masih ditahan marketplace.
        </div>
      </div>
    </LaporanPage>
  );
}
