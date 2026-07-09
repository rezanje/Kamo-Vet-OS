import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOpenShift } from "@/lib/shift";
import { monthlyLeaderboard, periodKey, type QuestDef } from "@/lib/quest-logic";
import { claimQuest, redeemReward } from "./actions";
import { ResetCountdown } from "./ResetCountdown";

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

type ProgressRow = { id: string; quest_definition_id: string; period_key: string; current_value: number; status: string };

// Dashboard Quest staff (Addendum §8, design petshop/08).
export default async function QuestPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string; success?: string }>;
}) {
  const { tab = "daily", error, success } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const shift = await getOpenShift(supabase as never, user.id);
  if (!shift) redirect("/kasir/mulai");

  const now = new Date();
  const dailyKey = periodKey("daily", now);
  const monthlyKey = periodKey("monthly", now);
  const monthStart = `${monthlyKey}-01T00:00:00Z`;

  const [{ data: defs }, { data: progress }, { data: sp }, { data: streak }, { data: rewards },
    { data: redemptions }, { data: monthLedger }, { data: cfg }] = await Promise.all([
    supabase.from("staff_quest_definitions").select("id, quest_type, title, target_kind, target_ref_id, target_value, points_reward, branch_id").eq("is_active", true),
    supabase.from("staff_quest_progress").select("id, quest_definition_id, period_key, current_value, status").eq("staff_id", user.id).in("period_key", [dailyKey, monthlyKey]),
    supabase.from("staff_points").select("total_points").eq("staff_id", user.id).maybeSingle(),
    supabase.from("staff_streaks").select("current_streak_days, longest_streak_days, last_active_date").eq("staff_id", user.id).maybeSingle(),
    supabase.from("staff_reward_catalog").select("id, reward_name, reward_type, points_cost").eq("is_active", true).order("points_cost"),
    supabase.from("staff_reward_redemptions").select("id, status").eq("staff_id", user.id),
    // leaderboard per cabang transaksi (§8 edge case: pindah cabang → progress nempel cabang lama).
    supabase.from("staff_points_ledger").select("staff_id, points_delta, source_type, created_at").eq("branch_id", shift.branch_id).gte("created_at", monthStart),
    supabase.from("quest_settings").select("streak_bonus_every_days, streak_bonus_points").eq("id", 1).maybeSingle(),
  ]);

  const activeDefs = ((defs ?? []) as (QuestDef & { title: string; branch_id: string | null })[])
    .filter((d) => !d.branch_id || d.branch_id === shift.branch_id);
  const progByDef = new Map(((progress ?? []) as ProgressRow[]).map((p) => [`${p.quest_definition_id}:${p.period_key}`, p]));

  const questRows = (type: "daily" | "monthly") =>
    activeDefs.filter((d) => d.quest_type === type).map((d) => {
      const key = type === "daily" ? dailyKey : monthlyKey;
      const p = progByDef.get(`${d.id}:${key}`);
      return { def: d, prog: p ?? null };
    });

  const daily = questRows("daily");
  const monthly = questRows("monthly");
  const shown = tab === "monthly" ? monthly : daily;

  const doneCount = (rows: { prog: ProgressRow | null }[]) =>
    rows.filter((r) => r.prog && r.prog.status !== "in_progress").length;
  const questSelesaiTotal = (progress ?? []).filter((p) => p.status !== "in_progress").length;

  const totalPoints = sp?.total_points ?? 0;
  const streakDays = streak?.current_streak_days ?? 0;
  const rewardClaimed = (redemptions ?? []).length;

  // leaderboard bulan ini (sum quest_completion, bukan lifetime).
  const board = monthlyLeaderboard((monthLedger ?? []) as { staff_id: string; points_delta: number; source_type: string; created_at: string }[], monthlyKey);
  const staffIds = board.slice(0, 10).map((b) => b.staff_id);
  const { data: names } = staffIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", staffIds)
    : { data: [] };
  const nameMap = new Map((names ?? []).map((n) => [n.id, n.full_name ?? "—"]));

  // kalender streak mingguan: 7 hari terakhir, checkmark bila <= streak berjalan dari last_active_date.
  const week: { label: string; active: boolean; today: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() + 7 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const dayNum = d.getUTCDate();
    const last = streak?.last_active_date ?? null;
    let active = false;
    if (last) {
      const diffDays = Math.round((new Date(last + "T00:00:00Z").getTime() - new Date(key + "T00:00:00Z").getTime()) / 86400000);
      active = diffDays >= 0 && diffDays < streakDays;
    }
    week.push({ label: `${dayNum}`, active, today: key === dailyKey });
  }

  return (
    <>
      {error && <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}><i className="ti ti-alert-circle" /> {error}</div>}
      {success === "klaim" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-confetti" /> Quest diklaim — poin sudah masuk saldo kamu!</div>}
      {success === "redeem" && <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}><i className="ti ti-gift" /> Reward ditukar — menunggu diserahkan manajer cabang.</div>}

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: "var(--sb)" }}>Quest</span>
        <span style={{ fontSize: 11, color: "var(--tm)" }}>Capai target penjualan & dapatkan reward menarik!</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: 12, alignItems: "start" }}>
        {/* KIRI: ringkasan + streak + leaderboard */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", letterSpacing: ".04em", marginBottom: 8 }}>📊 RINGKASAN PENCAPAIAN</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
              {([
                { label: "Total Poin", val: totalPoints.toLocaleString("id-ID"), icon: "ti-star", chip: "#2563eb", bg: "#eff6ff", color: "#1d4ed8", brd: "#bfdbfe" },
                { label: "Quest Selesai", val: `${questSelesaiTotal}`, icon: "ti-circle-check", chip: "#16a34a", bg: "#f0fdf4", color: "#15803d", brd: "#bbf7d0" },
                { label: "Streak Harian", val: `${streakDays} Hari`, icon: "ti-flame", chip: "#f59e0b", bg: "#fffbeb", color: "#b45309", brd: "#fde68a" },
                { label: "Reward Terklaim", val: `${rewardClaimed}`, icon: "ti-gift", chip: "#7c3aed", bg: "#f5f3ff", color: "#6d28d9", brd: "#ddd6fe" },
              ] as const).map((c) => (
                <div key={c.label} style={{ border: `1px solid ${c.brd}`, borderRadius: 10, padding: "10px", background: c.bg }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: c.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <i className={`ti ${c.icon}`} style={{ color: "#fff", fontSize: 14 }} />
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, marginTop: 6, color: c.color }}>{c.val}</div>
                  <div style={{ fontSize: 8.5, color: "var(--tm)" }}>{c.label}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              {([
                { label: "Daily Quest", rows: daily, grad: "linear-gradient(90deg,#3b82f6,#2563eb)", ink: "#2563eb" },
                { label: "Monthly Quest", rows: monthly, grad: "linear-gradient(90deg,#a78bfa,#7c3aed)", ink: "#7c3aed" },
              ] as const).map((g) => {
                const done = doneCount(g.rows);
                const pct = g.rows.length ? Math.round((done / g.rows.length) * 100) : 0;
                return (
                  <div key={g.label} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 4 }}>
                      <span style={{ color: g.ink, fontWeight: 600 }}><i className="ti ti-calendar" /> {g.label}</span>
                      <span style={{ fontWeight: 700, color: g.ink }}>{done} / {g.rows.length} Selesai · {pct}%</span>
                    </div>
                    <div style={{ height: 8, background: "var(--sf1)", borderRadius: 5, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: g.grad, borderRadius: 5 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card" style={{ borderColor: "#fde68a", background: "linear-gradient(180deg,#fffdf5,#fff)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#b45309", letterSpacing: ".04em" }}><i className="ti ti-flame" /> STREAK HARIAN</span>
              {cfg && (
                <span style={{ fontSize: 9.5, color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 6, padding: "3px 8px" }}>
                  Bonus tiap {cfg.streak_bonus_every_days} hari: <b>{cfg.streak_bonus_points} Poin</b> <i className="ti ti-star" style={{ color: "#f59e0b" }} />
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 15 }}>🔥</span> <b style={{ color: "#b45309" }}>{streakDays}</b> hari berturut-turut! <span style={{ color: "var(--tm)", fontSize: 10 }}>Pertahankan streak untuk bonus poin!</span>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              {week.map((d, i) => (
                <div key={i} style={{ textAlign: "center", flex: 1 }}>
                  <div style={{
                    width: 32, height: 32, margin: "0 auto", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: d.active ? "linear-gradient(180deg,#34d399,#16a34a)" : "var(--sf1)",
                    border: d.today ? "2px solid #f59e0b" : ".5px solid var(--bd)",
                    boxShadow: d.active ? "0 1px 3px rgba(22,163,74,.35)" : "none",
                  }}>
                    {d.active ? <i className="ti ti-check" style={{ color: "#fff", fontSize: 15 }} /> : <i className="ti ti-minus" style={{ color: "var(--td)", fontSize: 11 }} />}
                  </div>
                  {d.today && d.active && <div style={{ fontSize: 11, marginTop: 1 }}>🔥</div>}
                  <div style={{ fontSize: 8.5, color: "var(--tm)", marginTop: 2 }}>{d.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", letterSpacing: ".04em", marginBottom: 8 }}>🏆 LEADERBOARD (BULAN INI · {shift.branchName})</div>
            {board.length === 0 && <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada poin bulan ini.</div>}
            {board.slice(0, 10).map((b, i) => {
              const rank = [
                { bg: "linear-gradient(90deg,#fef9c3,#fff)", brd: "#fde047" },
                { bg: "linear-gradient(90deg,#f1f5f9,#fff)", brd: "#cbd5e1" },
                { bg: "linear-gradient(90deg,#ffedd5,#fff)", brd: "#fdba74" },
              ][i];
              const me = b.staff_id === user.id;
              return (
                <div key={b.staff_id} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 8, marginBottom: 4,
                  background: me ? "#eff6ff" : rank ? rank.bg : "transparent",
                  border: me ? "1px solid #bfdbfe" : rank ? `1px solid ${rank.brd}` : ".5px solid transparent",
                }}>
                  <span style={{ fontSize: 14, width: 20 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}</span>
                  <span style={{ fontSize: 11.5, flex: 1, fontWeight: me ? 700 : 400 }}>
                    {nameMap.get(b.staff_id) ?? "—"}{me ? " (Anda)" : ""}
                  </span>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: "#1d4ed8" }}>{b.points.toLocaleString("id-ID")} Poin</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* KANAN: quest list + reward */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="card">
            <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
              {(["daily", "monthly"] as const).map((t) => (
                <a key={t} href={`/kasir/quest?tab=${t}`} className="back-btn" style={{
                  padding: "5px 14px", borderRadius: 7, textDecoration: "none", fontSize: 11.5, fontWeight: 600,
                  border: tab === t ? "1px solid #2563eb" : ".5px solid var(--bd)", background: tab === t ? "linear-gradient(90deg,#3b82f6,#2563eb)" : "#fff", color: tab === t ? "#fff" : "var(--tm)",
                }}>
                  {t === "daily" ? "Daily Quest" : "Monthly Quest"}
                </a>
              ))}
              <span style={{ marginLeft: "auto" }}>{tab === "daily" && <ResetCountdown />}</span>
            </div>

            {shown.length === 0 && <div style={{ fontSize: 11, color: "var(--td)", padding: "10px 0" }}>Belum ada quest {tab === "daily" ? "harian" : "bulanan"} aktif — minta manajer membuat di dashboard admin.</div>}
            {shown.map(({ def, prog }) => {
              const cur = Number(prog?.current_value ?? 0);
              const target = Number(def.target_value);
              const pct = Math.min(100, Math.round((cur / target) * 100));
              const isAmount = def.target_kind === "total_sales_amount";
              const done = !!prog && prog.status !== "in_progress";
              return (
                <div key={def.id} style={{ padding: "9px 10px", borderRadius: 9, marginBottom: 6, background: done ? "linear-gradient(90deg,#f0fdf4,#fff)" : "#fafafa", border: `1px solid ${done ? "#bbf7d0" : "var(--bd)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <i className={`ti ${done ? "ti-circle-check-filled" : "ti-circle"}`} style={{ color: done ? "#16a34a" : "#cbd5e1", fontSize: 18 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700 }}>{def.title}</div>
                      <div style={{ height: 8, background: "#eef2f7", borderRadius: 5, overflow: "hidden", marginTop: 5 }}>
                        <div style={{ width: `${pct}%`, height: "100%", borderRadius: 5, background: done ? "linear-gradient(90deg,#34d399,#16a34a)" : "linear-gradient(90deg,#3b82f6,#2563eb)" }} />
                      </div>
                      <div style={{ fontSize: 9.5, color: "var(--tm)", marginTop: 3 }}>
                        {isAmount ? `${rp(cur)} / ${rp(target)}` : `${cur} / ${target}`}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", minWidth: 74 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12.5, fontWeight: 800, color: "#b45309", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 999, padding: "2px 9px" }}>{def.points_reward} <i className="ti ti-star" style={{ color: "#f59e0b", fontSize: 11 }} /></div>
                      <div style={{ fontSize: 8.5, color: "var(--td)", marginTop: 2 }}>Poin</div>
                      {prog?.status === "completed" && (
                        <form action={claimQuest} style={{ marginTop: 4 }}>
                          <input type="hidden" name="progressId" value={prog.id} />
                          <button type="submit" className="btn-acc" style={{ padding: "3px 12px", fontSize: 10, background: "#16a34a", borderColor: "#16a34a" }}>Klaim</button>
                        </form>
                      )}
                      {prog?.status === "claimed" && <span className="bge g" style={{ marginTop: 4 }}>Selesai</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#1d4ed8", letterSpacing: ".04em" }}>🎁 REWARD TERSEDIA</span>
              <span style={{ fontSize: 11 }}>Poin Anda: <b style={{ color: "#b45309", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 999, padding: "2px 9px" }}><i className="ti ti-star" style={{ color: "#f59e0b" }} /> {totalPoints.toLocaleString("id-ID")}</b></span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
              {(rewards ?? []).map((r, i) => {
                const afford = totalPoints >= r.points_cost;
                const icon = r.reward_type === "discount_voucher" ? "ti-ticket" : r.reward_type === "free_shipping" ? "ti-truck" : r.reward_type === "free_product" ? "ti-gift" : "ti-star";
                const tint = [
                  { chip: "linear-gradient(180deg,#fbbf24,#f59e0b)", bg: "#fffbeb", brd: "#fde68a" },
                  { chip: "linear-gradient(180deg,#60a5fa,#2563eb)", bg: "#eff6ff", brd: "#bfdbfe" },
                  { chip: "linear-gradient(180deg,#f472b6,#db2777)", bg: "#fdf2f8", brd: "#fbcfe8" },
                  { chip: "linear-gradient(180deg,#a78bfa,#7c3aed)", bg: "#f5f3ff", brd: "#ddd6fe" },
                ][i % 4];
                return (
                  <div key={r.id} style={{ border: `1px solid ${tint.brd}`, background: tint.bg, borderRadius: 11, padding: "12px 10px", textAlign: "center" }}>
                    <div style={{ width: 40, height: 40, margin: "0 auto", borderRadius: "50%", background: tint.chip, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 5px rgba(0,0,0,.12)" }}>
                      <i className={`ti ${icon}`} style={{ fontSize: 20, color: "#fff" }} />
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 7, minHeight: 26 }}>{r.reward_name}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, margin: "3px 0", color: "#b45309" }}>{r.points_cost.toLocaleString("id-ID")} <i className="ti ti-star" style={{ color: "#f59e0b", fontSize: 11 }} /></div>
                    <form action={redeemReward}>
                      <input type="hidden" name="rewardId" value={r.id} />
                      <button type="submit" disabled={!afford}
                        style={{ width: "100%", padding: "6px 0", fontSize: 10.5, fontWeight: 600, borderRadius: 7, border: "none", color: "#fff",
                          background: afford ? "linear-gradient(90deg,#3b82f6,#2563eb)" : "#cbd5e1", opacity: afford ? 1 : 0.7, cursor: afford ? "pointer" : "not-allowed" }}>
                        Tukar
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 9, color: "var(--td)", marginTop: 8 }}>
              Reward diserahkan manual oleh manajer cabang setelah redeem (pending → fulfilled).
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
