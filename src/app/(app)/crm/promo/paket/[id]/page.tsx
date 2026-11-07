import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ActivityHistoryLink } from "@/components/ActivityHistoryLink";
import { hariIniWIB } from "@/lib/tanggal";
import { paketFormFromSnapshot, UUID_RE } from "@/lib/promo-paket";
import type { PromoEditSnapshot } from "@/lib/promo-edit";
import { PaketEditor } from "../PaketEditor";
import { belowHppReleased, getManager, loadPaketOptions, paketReleased, PESAN_GAGAL_MUAT, PESAN_TIDAK_BERHAK } from "../loadPaketPage";

const back = <Link className="back-btn" href="/crm/promo"><i className="ti ti-arrow-left" /> Kembali ke daftar promo</Link>;

export default async function PromoPaketUbahPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createClient();
  const manager = await getManager(db);
  if (!manager) return <>{back}<p role="alert">{PESAN_TIDAK_BERHAK}</p></>;
  if (!UUID_RE.test(id)) return <>{back}<p role="alert">Promo tidak ditemukan atau tidak dapat diakses.</p></>;
  const { data, error } = await db.rpc("read_promo_edit", { p_id: id });
  if (error || !data) return <>{back}<p role="alert">Data promo belum dapat dimuat. Muat ulang atau kembali ke daftar; perubahan belum disimpan.</p></>;
  const snapshot = data as PromoEditSnapshot;
  // Promo lama (per satuan / paket total / quantity pool) tetap memakai editor lamanya.
  if (snapshot.promo.rule?.discount_mode !== "syarat_hasil") redirect(`/crm/promo/${id}/edit`);
  const form = paketFormFromSnapshot(snapshot);
  if (!form) return <>{back}<p role="alert">Aturan promo paket ini tidak dapat dibaca. Promo tidak diubah; hubungi admin rilis.</p></>;
  const used = [...form.syarat.flatMap((r) => (r.kind === "qty" ? r.items : [])), ...form.hasil.items].map((r) => r.item_id);
  const options = await loadPaketOptions(db, used, form.branchIds);
  if (!options) return <>{back}<p role="alert">{PESAN_GAGAL_MUAT}</p></>;
  const [released, belowReleased] = await Promise.all([paketReleased(db), belowHppReleased(db)]);
  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>{back}<ActivityHistoryLink entity="promos" id={id} /><span style={{ fontSize: 13, fontWeight: 500 }}>Promo Paket — {snapshot.promo.name}</span></div>
      <div className="crm-sec">
        <PaketEditor key={`${manager.userId}:${id}:${snapshot.version}`} userId={manager.userId} mode="ubah" promoId={id} version={snapshot.version} initialForm={form} active={snapshot.promo.is_active}
          items={options.items} branches={options.branches} role={manager.role} today={hariIniWIB()} released={released} belowHppReleased={belowReleased} />
      </div>
    </>
  );
}
