"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  estimasiHasil, parseBulat, parsePaketForm, ringkasPaket, rp, validatePaketForm, PESAN_STALE,
  type PaketForm, type PaketIssue, type PaketItemInfo, type PaketSyaratForm,
} from "@/lib/promo-paket";
import type { HppRow } from "@/lib/promo-paket-hpp";
import { SH_MAX_HASIL_ITEMS, SH_MAX_ROW_ITEMS, SH_MAX_SYARAT_ROWS } from "@/lib/promo-syarat-hasil";
import { simpanPromoPaket, taksirHppPaket, ubahStatusPromoPaket } from "./actions";
import { PaketItemPicker } from "./PaketItemPicker";
import s from "./PaketEditor.module.css";

type Role = "OWNER" | "ADMIN";
type Props = {
  userId: string; mode: "baru" | "ubah"; promoId?: string; version?: string; initialForm: PaketForm; active: boolean;
  items: PaketItemInfo[]; branches: { id: string; name: string }[]; role: Role; today: string; released: boolean;
};
const draftKey = (userId: string, scope: string) => `vetos:paket-draft:v1:${userId}:${scope}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function PaketEditor({ userId, mode, promoId, version: initialVersion, initialForm, active: initialActive, items, branches, role, today, released }: Props) {
  const router = useRouter();
  const isOwner = role === "OWNER";
  const [form, setForm] = useState<PaketForm>(initialForm);
  const [saved, setSaved] = useState<PaketForm>(initialForm);
  const [id, setId] = useState<string | undefined>(promoId);
  const [version, setVersion] = useState<string | undefined>(initialVersion);
  const [active, setActive] = useState(initialActive);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<PaketIssue[]>([]);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  const [info, setInfo] = useState("");
  const [restored, setRestored] = useState("");
  const [hpp, setHpp] = useState<HppRow[]>([]);
  const ready = useRef(false);
  const scope = promoId ?? "baru";

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const nameOf = (item: string) => itemMap.get(item)?.name ?? "Barang tidak tersedia";
  const dirty = !same(form, saved);
  const lockedByWaiver = !isOwner && saved.belowHpp.allowed;
  const locked = active || lockedByWaiver || busy;

  // Draf browser: isian tidak hilang saat konflik versi / muat ulang. Dibersihkan setelah simpan berhasil.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const raw = sessionStorage.getItem(draftKey(userId, scope));
        const d = raw ? JSON.parse(raw) as { baseVersion?: string; form?: unknown } : null;
        const f = d ? parsePaketForm(d.form) : null;
        if (f && !same(f, initialForm)) {
          setForm(f);
          setRestored(d!.baseVersion && d!.baseVersion !== initialVersion ? "Draf Anda dipulihkan dari versi sebelumnya. Data promo sudah berubah di server — periksa isian sebelum menyimpan." : "Draf Anda dipulihkan dari browser ini.");
        }
      } catch { /* draf browser opsional */ }
      ready.current = true;
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!ready.current) return;
    try {
      if (same(form, saved)) sessionStorage.removeItem(draftKey(userId, scope));
      else sessionStorage.setItem(draftKey(userId, scope), JSON.stringify({ baseVersion: initialVersion ?? null, form, at: Date.now() }));
    } catch { /* penyimpanan penuh/nonaktif: abaikan */ }
  }, [form, saved, userId, scope, initialVersion]);

  // Taksiran harga/HPP barang hasil (baca saja, server) untuk panel peringatan di bawah HPP.
  const hasilKey = JSON.stringify([form.hasil.items, form.branchIds]);
  useEffect(() => {
    let alive = true;
    if (form.hasil.items.length === 0) return;
    taksirHppPaket(form.hasil.items, form.branchIds).then((r) => { if (alive) setHpp(r.ok ? r.rows : []); }, () => { if (alive) setHpp([]); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasilKey]);

  const patch = (p: Partial<PaketForm>) => { setForm((f) => ({ ...f, ...p })); setInfo(""); };
  const setSyarat = (i: number, row: PaketSyaratForm) => patch({ syarat: form.syarat.map((r, j) => (j === i ? row : r)) });
  const estimates = useMemo(() => {
    const value = parseBulat(form.hasil.value);
    if (!value || form.hasil.items.length === 0) return [];
    const cap = form.hasil.discountType === "percent" ? parseBulat(form.hasil.maxAmount) : null;
    return hpp.filter((r) => form.hasil.items.some((i) => i.item_id === r.item_id && i.unit === r.unit)).map((r) => ({ r, e: estimasiHasil({ price: r.price, hpp: r.hpp, discount: { type: form.hasil.discountType, value, maxAmount: cap } }) }));
  }, [hpp, form.hasil.items, form.hasil.value, form.hasil.discountType, form.hasil.maxAmount]);
  const rugi = estimates.filter((x) => x.e.belowHpp === true);
  const takDiketahui = estimates.filter((x) => x.e.belowHpp === null);

  const afterOk = (r: { id: string; version: string; active: boolean }, f: PaketForm) => {
    setId(r.id); setVersion(r.version); setActive(r.active); setSaved(f); setIssues([]); setError(""); setStale(false);
    try { sessionStorage.removeItem(draftKey(userId, scope)); } catch { /* abaikan */ }
  };
  const fail = (r: { message: string; stale?: boolean }) => { setError(r.message); setStale(!!r.stale); setInfo(""); };

  async function simpan() {
    setInfo(""); setError(""); setStale(false);
    const found = validatePaketForm(form, { today, items: itemMap, isOwner });
    setIssues(found);
    if (found.length) return;
    setBusy(true);
    try {
      const r = await simpanPromoPaket({ id: id ?? null, version: version ?? null, form });
      if (!r.ok) { fail(r); return; }
      afterOk(r, form);
      setInfo("Tersimpan sebagai draf (nonaktif). Klik Aktifkan bila sudah siap dipakai di kasir.");
      if (!id) router.replace(`/crm/promo/paket/${r.id}`);
    } catch { setError("Respons simpan belum terkonfirmasi. Isian Anda tetap ada; periksa daftar promo sebelum menyimpan ulang."); }
    finally { setBusy(false); }
  }

  async function ubahStatus(next: boolean) {
    if (!id || !version) return;
    setInfo(""); setError(""); setStale(false); setBusy(true);
    try {
      const r = await ubahStatusPromoPaket({ id, version, active: next });
      if (!r.ok) { fail(r); return; }
      setId(r.id); setVersion(r.version); setActive(r.active); setError("");
      setInfo(r.active ? "Promo aktif dan berlaku di kasir petshop." : "Promo dinonaktifkan. Sekarang isinya bisa diubah.");
    } catch { setError("Respons belum terkonfirmasi. Muat ulang halaman untuk melihat status terbaru."); }
    finally { setBusy(false); }
  }

  const err = (field: string) => issues.filter((i) => i.field === field || i.field.startsWith(`${field}.`));
  const statusBadge = id ? <span className={`bge ${active ? "g" : "o"}`}>{active ? "Aktif" : "Draf (nonaktif)"}</span> : <span className="bge o">Baru</span>;

  return (
    <div className={s.root}>
      {!released && <div className={s.bannerAmber} role="status"><i className="ti ti-info-circle" /> Fitur promo paket belum dirilis oleh Owner. Anda tetap bisa menyusun dan menyimpan draf; tombol Aktifkan akan ditolak sampai dirilis.</div>}
      {stale && <div className={s.bannerRed} role="alert"><strong>{PESAN_STALE}</strong>{" "}
        <button type="button" className="btn-def" onClick={() => router.refresh()}>Muat ulang data terbaru</button></div>}
      {restored && <div className={s.bannerAmber} role="status">{restored}</div>}
      {active && <div className={s.bannerAmber} role="status"><i className="ti ti-lock" /> Promo sedang aktif di kasir, jadi isinya dikunci.{" "}
        <button type="button" className="btn-def" disabled={busy} onClick={() => ubahStatus(false)}>Nonaktifkan untuk mengubah</button></div>}
      {lockedByWaiver && !active && <div className={s.bannerAmber} role="status">Promo ini punya izin penjualan di bawah HPP dari Owner; hanya Owner yang dapat mengubah isinya.</div>}

      <fieldset className={s.lock} disabled={locked}>
        <div className={s.head}>
          <div>
            <label className="flab" htmlFor="paket-nama">Nama promo *</label>
            <input id="paket-nama" className="fi" name="nama" maxLength={120} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="mis. Beli 2 Bolt, ANC -Rp1.000" />
          </div>
          <div>
            <label className="flab" htmlFor="paket-dari">Berlaku dari</label>
            <input id="paket-dari" className="fi" type="date" name="tanggal-dari" value={form.validFrom} onChange={(e) => patch({ validFrom: e.target.value })} />
          </div>
          <div>
            <label className="flab" htmlFor="paket-sampai">Berlaku s/d</label>
            <input id="paket-sampai" className="fi" type="date" name="tanggal-sampai" value={form.validUntil} onChange={(e) => patch({ validUntil: e.target.value })} />
          </div>
          <div>
            <span className="flab">Cabang</span>
            <details>
              <summary className="fi" style={{ cursor: "pointer" }}>{form.branchIds.length === 0 ? "Semua cabang" : `${form.branchIds.length} cabang dipilih`}</summary>
              <div style={{ maxHeight: 150, overflow: "auto", border: ".5px solid var(--bd)", borderRadius: 6, padding: "3px 8px", marginTop: 3, background: "#fff" }}>
                <div className={s.hint}>Kosongkan semua = berlaku di semua cabang.</div>
                {branches.map((b) => (
                  <label key={b.id} style={{ display: "flex", gap: 6, fontSize: 11.5, alignItems: "center" }}>
                    <input type="checkbox" name={`cabang-${b.id}`} checked={form.branchIds.includes(b.id)} onChange={(e) => patch({ branchIds: e.target.checked ? [...form.branchIds, b.id] : form.branchIds.filter((x) => x !== b.id) })} /> {b.name}
                  </label>
                ))}
              </div>
            </details>
          </div>
        </div>
        {err("name").length > 0 && <ul className={s.errors} role="alert">{err("name").map((i) => <li key={i.message}>{i.message}</li>)}</ul>}
        {err("tanggal").length > 0 && <ul className={s.errors} role="alert">{err("tanggal").map((i) => <li key={i.message}>{i.message}</li>)}</ul>}

        {/* ── 1. SYARAT ─────────────────────────────────────────────── */}
        <div className={s.sec} style={{ marginTop: 10 }}>
          <div className={s.secHead}>
            <span className={s.secTitle}><i className="ti ti-list-check" /> Syarat Promo</span>
            <span className={s.hint}>Semua syarat harus terpenuhi (DAN). Pilih barang langsung di tiap syarat; beberapa varian boleh dicampur.</span>
            <span className={s.grow} />
            <button type="button" className="btn-def" disabled={form.syarat.length >= SH_MAX_SYARAT_ROWS} onClick={() => patch({ syarat: [...form.syarat, { kind: "qty", min: "1", items: [] }] })}>+ Syarat Promo</button>
          </div>
          {form.syarat.length >= SH_MAX_SYARAT_ROWS && <div className={s.hint}>Sudah mencapai batas maksimal {SH_MAX_SYARAT_ROWS} syarat.</div>}
          {form.syarat.map((r, i) => (
            <div key={i} className={s.rowCard} data-syarat-row>
              <div className={s.rowTop}>
                <span className={s.no}>{i + 1}</span>
                <div>
                  <label className="flab">Berdasarkan</label>
                  <select className="fi" aria-label={`Jenis syarat ${i + 1}`} value={r.kind}
                    onChange={(e) => setSyarat(i, e.target.value === "nilai" ? { kind: "nilai", min: "" } : { kind: "qty", min: "1", items: [] })}>
                    <option value="qty">Kuantitas Barang</option>
                    <option value="nilai">Nilai Belanja</option>
                  </select>
                </div>
                <div>
                  <label className="flab">{r.kind === "qty" ? "Kuantitas minimum *" : "Nilai minimum (Rp) *"}</label>
                  <input className="fi" inputMode="numeric" name={`syarat-min-${i}`} value={r.min} onChange={(e) => setSyarat(i, { ...r, min: e.target.value })} placeholder={r.kind === "qty" ? "mis. 2" : "mis. 100000"} />
                </div>
                <div className={s.hint} style={{ paddingBottom: 6 }}>
                  {r.kind === "qty" ? "Jumlah dihitung bersama untuk semua barang di bawah; satuan mengikuti pilihan tiap barang." : "Dihitung dari seluruh keranjang (total transaksi), bukan barang tertentu."}
                </div>
                <button type="button" className="btn-def" aria-label={`Buang syarat ${i + 1}`} disabled={form.syarat.length <= 1} onClick={() => patch({ syarat: form.syarat.filter((_, j) => j !== i) })}>×</button>
              </div>
              {r.kind === "qty" && <PaketItemPicker label={`syarat ${i + 1}`} items={items} value={r.items} max={SH_MAX_ROW_ITEMS} onChange={(next) => setSyarat(i, { ...r, items: next })} />}
              {err(`syarat.${i}`).length > 0 && <ul className={s.errors} role="alert">{err(`syarat.${i}`).map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
            </div>
          ))}
          {err("syarat").filter((x) => x.field === "syarat").length > 0 && <ul className={s.errors} role="alert">{err("syarat").filter((x) => x.field === "syarat").map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
        </div>

        {/* ── 2. HASIL ──────────────────────────────────────────────── */}
        <div className={s.sec} style={{ marginTop: 10 }}>
          <div className={s.secHead}>
            <span className={s.secTitle}><i className="ti ti-gift" /> Hasil — Promo barang</span>
            <span className={s.hint}>Barang hasil harus ada di keranjang. Boleh semua varian: tambahkan beberapa barang sekaligus.</span>
            <span className={s.grow} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5 }}>
              <input type="checkbox" name="kelipatan" checked={form.repeat} onChange={(e) => patch({ repeat: e.target.checked })} /> Berlaku kelipatan
            </label>
          </div>
          <PaketItemPicker label="hasil" items={items} value={form.hasil.items} max={SH_MAX_HASIL_ITEMS} onChange={(next) => patch({ hasil: { ...form.hasil, items: next } })} />
          <div className={s.hasilGrid}>
            <div>
              <label className="flab">Diskon barang</label>
              <select className="fi" aria-label="Jenis potongan" value={form.hasil.discountType} onChange={(e) => patch({ hasil: { ...form.hasil, discountType: e.target.value as "nominal" | "percent", maxAmount: "" } })}>
                <option value="nominal">Nominal (Rp per unit)</option>
                <option value="percent">Persen (%)</option>
              </select>
            </div>
            <div>
              <label className="flab">{form.hasil.discountType === "percent" ? "Persen potongan *" : "Potongan per unit (Rp) *"}</label>
              <input className="fi" inputMode="numeric" name="hasil-nilai" value={form.hasil.value} onChange={(e) => patch({ hasil: { ...form.hasil, value: e.target.value } })} placeholder={form.hasil.discountType === "percent" ? "mis. 50" : "mis. 1000"} />
            </div>
            {form.hasil.discountType === "percent" && (
              <div>
                <label className="flab">Maksimum diskon (Rp per unit)</label>
                <input className="fi" inputMode="numeric" name="hasil-maks" value={form.hasil.maxAmount} onChange={(e) => patch({ hasil: { ...form.hasil, maxAmount: e.target.value } })} placeholder="kosong = tanpa batas" />
              </div>
            )}
            <div>
              <label className="flab">Unit hasil per kelipatan</label>
              <input className="fi" inputMode="numeric" name="hasil-jumlah" value={form.hasil.rewardQty} onChange={(e) => patch({ hasil: { ...form.hasil, rewardQty: e.target.value } })} />
            </div>
          </div>
          <div className={s.hint} style={{ marginTop: 3 }}>Potongan dihitung dari harga normal barang hasil dan ditanggung margin. Harga akhir tidak pernah di bawah Rp1.</div>
          {err("hasil").length > 0 && <ul className={s.errors} role="alert">{err("hasil").map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
        </div>

        {/* ── 3. HPP / IZIN OWNER ───────────────────────────────────── */}
        {(estimates.length > 0 || isOwner || form.belowHpp.allowed) && (
          <div className={s.sec} style={{ marginTop: 10 }}>
            <div className={s.secHead}><span className={s.secTitle}><i className="ti ti-alert-triangle" /> Harga di bawah HPP</span>
              <span className={s.hint}>{isOwner ? "Hanya Owner yang boleh mengizinkan." : "Penjualan di bawah HPP hanya dapat diizinkan oleh Owner."}</span></div>
            {estimates.length > 0 && (
              <table className={s.hppTable} aria-label="Taksiran HPP barang hasil">
                <thead><tr><th>Barang hasil</th><th>Harga normal</th><th>Potongan</th><th>Harga akhir</th><th>HPP (perkiraan)</th></tr></thead>
                <tbody>{estimates.map(({ r, e }) => (
                  <tr key={`${r.item_id}|${r.unit}`}><td>{nameOf(r.item_id)} ({r.unit})</td><td>{rp(r.price)}</td><td>{rp(e.discountPerUnit)}</td><td>{rp(e.netPerUnit)}</td><td>{e.hpp === null ? "tidak terbaca" : rp(e.hpp)}</td></tr>
                ))}</tbody>
              </table>
            )}
            {rugi.map(({ r, e }) => (
              <div key={`${r.item_id}|${r.unit}`} className={s.bannerRed} style={{ marginTop: 5 }} role="status">
                Dengan promo ini harga jual {nameOf(r.item_id)} {rp(e.netPerUnit)} di BAWAH HPP {rp(e.hpp ?? 0)} (rugi {rp(e.lossPerUnit)}/unit). Ini diperbolehkan, mis. untuk menghabiskan barang expired/reject.
                {!isOwner && " Minta Owner mengizinkan, atau naikkan harga / kecilkan potongan."}
              </div>
            ))}
            {takDiketahui.length > 0 && <div className={s.bannerAmber} style={{ marginTop: 5 }} role="status">HPP tidak terbaca untuk: {takDiketahui.map(({ r }) => nameOf(r.item_id)).join(", ")}. Rugi tidak bisa ditaksir; kasir tetap menolak penjualan di bawah HPP tanpa izin Owner.</div>}
            {isOwner && (
              <div style={{ marginTop: 6 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11.5, fontWeight: 600 }}>
                  <input type="checkbox" name="izin-hpp" checked={form.belowHpp.allowed} onChange={(e) => patch({ belowHpp: { allowed: e.target.checked, reason: e.target.checked ? form.belowHpp.reason : "" } })} />
                  Saya mengerti dan mengizinkan penjualan di bawah HPP untuk promo ini
                </label>
                {form.belowHpp.allowed && (
                  <input className="fi" name="izin-hpp-alasan" maxLength={200} style={{ marginTop: 4 }} placeholder="Alasan (min. 10 karakter), mis. barang mendekati expired" value={form.belowHpp.reason} onChange={(e) => patch({ belowHpp: { allowed: true, reason: e.target.value } })} />
                )}
                <div className={s.hint}>Harga akhir tetap harus di atas Rp0 dan tidak boleh digabung voucher/poin/diskon total pada barang itu. Siapa & kapan mengizinkan dicatat otomatis.</div>
              </div>
            )}
            {err("waiver").length > 0 && <ul className={s.errors} role="alert">{err("waiver").map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
          </div>
        )}
      </fieldset>

      {err("definisi").length > 0 && <ul className={s.errors} role="alert">{err("definisi").map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
      <div className={s.preview} data-testid="pratinjau" aria-live="polite">Pratinjau: {ringkasPaket(form, nameOf)}</div>
      {error && !stale && <div className={s.bannerRed} role="alert">{error}</div>}
      {info && <div className={s.bannerGreen} role="status"><i className="ti ti-circle-check" /> {info}</div>}

      <div className={s.actions}>
        {statusBadge}
        {!active && !lockedByWaiver && <button type="button" className="btn-acc" disabled={busy} onClick={simpan}>{busy ? "Menyimpan…" : "Simpan sebagai draf"}</button>}
        {mode === "ubah" || id ? (
          <button type="button" className="btn-def" disabled={busy || active || dirty || !id || !version} onClick={() => ubahStatus(true)} title="Aktifkan promo agar berlaku di kasir">Aktifkan</button>
        ) : (
          <button type="button" className="btn-def" disabled title="Simpan sebagai draf dulu">Aktifkan</button>
        )}
        {dirty && !active && <span className={s.hint}>Simpan perubahan dulu sebelum mengaktifkan.</span>}
        {!id && <span className={s.hint}>Simpan sebagai draf dulu, lalu Aktifkan.</span>}
        <span className={s.grow} />
        <Link className="back-btn" href="/crm/promo">Kembali ke daftar promo</Link>
      </div>
    </div>
  );
}

