import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hariIniWIB } from "@/lib/tanggal";
import { emptyPaketForm } from "@/lib/promo-paket";
import { PaketEditor } from "../PaketEditor";
import { belowHppReleased, getManager, loadPaketOptions, paketReleased, PESAN_GAGAL_MUAT, PESAN_TIDAK_BERHAK } from "../loadPaketPage";

const back = <Link className="back-btn" href="/crm/promo"><i className="ti ti-arrow-left" /> Kembali ke daftar promo</Link>;

export default async function PromoPaketBaruPage() {
  const db = await createClient();
  const manager = await getManager(db);
  if (!manager) return <>{back}<p role="alert">{PESAN_TIDAK_BERHAK}</p></>;
  const options = await loadPaketOptions(db);
  if (!options) return <>{back}<p role="alert">{PESAN_GAGAL_MUAT}</p></>;
  const today = hariIniWIB();
  const [released, belowReleased] = await Promise.all([paketReleased(db), belowHppReleased(db)]);
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>{back}<span style={{ color: "var(--td)" }}>·</span><span style={{ fontSize: 13, fontWeight: 500 }}>Promo Paket — Buat baru</span></div>
      <div className="crm-sec">
        <PaketEditor key={manager.userId} userId={manager.userId} mode="baru" initialForm={emptyPaketForm(today)} active={false} items={options.items} branches={options.branches} role={manager.role} today={today} released={released} belowHppReleased={belowReleased} />
      </div>
    </>
  );
}
