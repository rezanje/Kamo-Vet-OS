import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { createQuestDef, createReward, fulfillRedemption, toggleQuestDef, toggleReward } from "./actions";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}
const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

// Konfigurasi Quest & Reward (Addendum §8) — owner/manajer, tanpa bantuan developer.
export default async function QuestAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const supabase = await createClient();

  const [{ data: defs }, { data: rewards }, { data: redemptions }, { data: branches }, { data: items }] = await Promise.all([
    supabase.from("staff_quest_definitions").select("id, quest_type, title, target_kind, target_value, points_reward, is_active, branches(name)").order("created_at", { ascending: false }),
    supabase.from("staff_reward_catalog").select("id, reward_name, reward_type, points_cost, is_active").order("points_cost"),
    supabase.from("staff_reward_redemptions").select("id, points_spent, status, redeemed_at, profiles(full_name), staff_reward_catalog(reward_name)").order("redeemed_at", { ascending: false }).limit(20),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
    supabase.from("items").select("id, name").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos" className="back-btn"><i className="ti ti-arrow-left" /> Kembali</Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Quest Staff — Konfigurasi</span>
      </div>

      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "quest" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Quest baru dibuat.</div>}
      {success === "reward" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Reward baru ditambahkan.</div>}
      {success === "fulfill" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-circle-check" /> Reward ditandai sudah diserahkan.</div>}

      <div className="crm-sec">
        <SecHeader num="01" title="BUAT QUEST BARU" desc="Target produk / kategori / nominal — daily atau monthly, per cabang atau semua cabang." />
        <form action={createQuestDef} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr 1fr 1fr 1.2fr auto", gap: 8, alignItems: "flex-end" }}>
          <div>
            <label className="flab">Judul quest *</label>
            <input className="fi" name="title" required placeholder="mis. Jual 5 Royal Canin Kitten 2kg" />
          </div>
          <div>
            <label className="flab">Tipe</label>
            <select className="fi" name="quest_type" defaultValue="daily">
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="flab">Jenis target</label>
            <select className="fi" name="target_kind" defaultValue="total_sales_amount">
              <option value="total_sales_amount">Total penjualan (Rp)</option>
              <option value="product_qty">Qty produk tertentu</option>
              <option value="category_qty">Qty per kategori</option>
            </select>
          </div>
          <div>
            <label className="flab">Produk (utk qty produk)</label>
            <select className="fi" name="target_ref_id" defaultValue="">
              <option value="">Semua produk</option>
              {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className="flab">Target *</label>
            <input className="fi" name="target_value" type="number" min={1} required placeholder="5 / 1000000" />
          </div>
          <div>
            <label className="flab">Poin reward *</label>
            <input className="fi" name="points_reward" type="number" min={1} required placeholder="50" />
          </div>
          <div>
            <label className="flab">Cabang</label>
            <select className="fi" name="branch_id" defaultValue="">
              <option value="">Semua cabang</option>
              {(branches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn-acc" style={{ gridColumn: "-2" }}><i className="ti ti-plus" /> Buat</button>
        </form>

        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>Quest</th><th>Tipe</th><th>Target</th><th>Poin</th><th>Cabang</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(defs ?? []).map((d) => {
                const br = one(d.branches as Rel<{ name: string }>);
                return (
                  <tr key={d.id} style={{ opacity: d.is_active ? 1 : 0.5 }}>
                    <td style={{ fontWeight: 500 }}>{d.title}</td>
                    <td><span className={`bge ${d.quest_type === "daily" ? "b" : "o"}`}>{d.quest_type}</span></td>
                    <td style={{ fontSize: 11 }}>{d.target_kind === "total_sales_amount" ? rp(Number(d.target_value)) : `${Number(d.target_value)} pcs`}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 700 }}>{d.points_reward}</td>
                    <td style={{ fontSize: 11 }}>{br?.name ?? "Semua"}</td>
                    <td><span className={`bge ${d.is_active ? "g" : "r"}`}>{d.is_active ? "Aktif" : "Nonaktif"}</span></td>
                    <td>
                      <form action={toggleQuestDef}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="active" value={d.is_active ? "0" : "1"} />
                        <button type="submit" className="btn-def" style={{ padding: "3px 10px", fontSize: 10 }}>
                          {d.is_active ? "Nonaktifkan" : "Aktifkan"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {(defs ?? []).length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada quest.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="02" title="KATALOG REWARD" desc="Reward yang bisa ditukar poin oleh staff." />
          <form action={createReward} style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="flab">Nama reward *</label>
              <input className="fi" name="reward_name" required placeholder="mis. Voucher Diskon 10%" />
            </div>
            <div>
              <label className="flab">Jenis</label>
              <select className="fi" name="reward_type" defaultValue="discount_voucher">
                <option value="discount_voucher">Voucher diskon</option>
                <option value="free_shipping">Gratis ongkir</option>
                <option value="free_product">Produk gratis</option>
                <option value="bonus_points">Bonus poin</option>
              </select>
            </div>
            <div style={{ width: 90 }}>
              <label className="flab">Poin *</label>
              <input className="fi" name="points_cost" type="number" min={1} required placeholder="500" />
            </div>
            <button type="submit" className="btn-acc"><i className="ti ti-plus" /></button>
          </form>
          <table className="tbl">
            <thead><tr><th>Reward</th><th>Poin</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(rewards ?? []).map((r) => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 500 }}>{r.reward_name}</td>
                  <td style={{ fontWeight: 700 }}>{r.points_cost}</td>
                  <td><span className={`bge ${r.is_active ? "g" : "r"}`}>{r.is_active ? "Aktif" : "Nonaktif"}</span></td>
                  <td>
                    <form action={toggleReward}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="active" value={r.is_active ? "0" : "1"} />
                      <button type="submit" className="btn-def" style={{ padding: "3px 10px", fontSize: 10 }}>
                        {r.is_active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 9, color: "var(--td)", marginTop: 8 }}>
            Catatan: penerima akhir voucher (staff pribadi vs customer) masih perlu konfirmasi Aldi — v1 hanya mencatat redemption.
          </div>
        </div>

        <div className="crm-sec" style={{ marginBottom: 0 }}>
          <SecHeader num="03" title="PENYERAHAN REWARD" desc="Redemption staff yang menunggu diserahkan (pending → fulfilled)." />
          <table className="tbl">
            <thead><tr><th>Waktu</th><th>Staff</th><th>Reward</th><th>Poin</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(redemptions ?? []).map((r) => {
                const staff = one(r.profiles as Rel<{ full_name: string | null }>);
                const reward = one(r.staff_reward_catalog as Rel<{ reward_name: string }>);
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{new Date(r.redeemed_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ fontSize: 11.5 }}>{staff?.full_name ?? "—"}</td>
                    <td style={{ fontSize: 11.5 }}>{reward?.reward_name ?? "—"}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 700 }}>{r.points_spent}</td>
                    <td><span className={`bge ${r.status === "fulfilled" ? "g" : r.status === "cancelled" ? "r" : "o"}`}>{r.status === "pending_fulfillment" ? "Menunggu" : r.status === "fulfilled" ? "Diserahkan" : "Batal"}</span></td>
                    <td>
                      {r.status === "pending_fulfillment" && (
                        <form action={fulfillRedemption}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className="btn-acc" style={{ padding: "3px 10px", fontSize: 10 }}>
                            <i className="ti ti-check" /> Serahkan
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(redemptions ?? []).length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--td)", padding: "16px 0", fontSize: 11 }}>Belum ada redemption.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
