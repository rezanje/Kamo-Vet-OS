"use client";

import { useMemo, useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { SubmitButton } from "@/components/SubmitButton";
import { cairkanSekaligus } from "./actions";

export type OrderPiutang = {
  id: string; no_struk: string | null; tanggal: string; external_ref: string | null; pembeli: string | null; total: number;
};
export type GrupPiutang = { key: string; channel: string; cabang: string; orders: OrderPiutang[] };
export type RekeningBank = { id: string; nama: string };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

// Satu transfer marketplace melunasi banyak order. Grup = marketplace + cabang, karena
// satu pencairan Shopee/Tokopedia selalu dari satu toko online.
// `requestKey` dibuat server per tampilan halaman; dobel kirim dengan kunci sama hanya
// mengulang hasil, dan order yang sudah cair selalu ditolak RPC walau kuncinya baru.
export function CairSekaligusForm({ groups, rekening, today, requestKey }: {
  groups: GrupPiutang[]; rekening: RekeningBank[]; today: string; requestKey: string;
}) {
  const [grupKey, setGrupKey] = useState(groups[0]?.key ?? "");
  const grup = groups.find((g) => g.key === grupKey) ?? groups[0];
  const [dipilih, setDipilih] = useState<Set<string>>(() => new Set(grup?.orders.map((o) => o.id) ?? []));
  const [dana, setDana] = useState("");

  const total = useMemo(
    () => (grup?.orders ?? []).filter((o) => dipilih.has(o.id)).reduce((a, o) => a + Number(o.total), 0),
    [grup, dipilih],
  );
  const danaN = Number(dana) || 0;
  const potongan = total - danaN;

  if (!grup) return null;

  const gantiGrup = (key: string) => {
    setGrupKey(key);
    setDipilih(new Set(groups.find((g) => g.key === key)?.orders.map((o) => o.id) ?? []));
  };
  const semua = grup.orders.length > 0 && grup.orders.every((o) => dipilih.has(o.id));
  const toggleSemua = () => setDipilih(semua ? new Set() : new Set(grup.orders.map((o) => o.id)));
  const toggle = (id: string) => setDipilih((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <form action={cairkanSekaligus}>
      <input type="hidden" name="request_key" value={requestKey} />
      <div className="frow">
        <div>
          <label className="flab">Toko online *</label>
          <select className="fi" value={grup.key} onChange={(e) => gantiGrup(e.target.value)}>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.channel} · {g.cabang} — {g.orders.length} order · {rp(g.orders.reduce((a, o) => a + Number(o.total), 0))}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flab">Tanggal dana masuk *</label>
          <input className="fi" type="date" name="tanggal" defaultValue={today} max={today} required />
        </div>
        {rekening.length > 0 && (
          <div>
            <label className="flab">Masuk ke rekening</label>
            <select className="fi" name="account_id" defaultValue="">
              <option value="">— ikut peta rekening —</option>
              {rekening.map((r) => <option key={r.id} value={r.id}>{r.nama}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="flab">Dana yang masuk (Rp) *</label>
          <NumberInput
            className="fi" type="number" name="nominal" min={1} step="any" required
            value={dana} onChange={(e) => setDana(e.target.value)} placeholder="sesuai mutasi bank"
          />
        </div>
      </div>

      <div style={{ overflowX: "auto", marginTop: 10, maxHeight: 360, overflowY: "auto" }}>
        <table className="tbl" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input type="checkbox" checked={semua} onChange={toggleSemua} aria-label="Pilih semua order" />
              </th>
              <th>Nomor #</th><th>Tanggal</th><th>Pembeli</th><th>Ref. order</th>
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {grup.orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <input
                    type="checkbox" name="sale_id" value={o.id} checked={dipilih.has(o.id)}
                    onChange={() => toggle(o.id)} aria-label={`Pilih ${o.no_struk ?? "order"}`}
                  />
                </td>
                <td style={{ fontSize: 11.5, fontWeight: 500 }}>{o.no_struk ?? "—"}</td>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{o.tanggal}</td>
                <td style={{ fontSize: 11.5 }}>{o.pembeli ?? "—"}</td>
                <td style={{ fontSize: 11, color: "var(--tm)" }}>{o.external_ref ?? "—"}</td>
                <td style={{ textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>{rp(Number(o.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "flex-end", marginTop: 12, fontSize: 11.5 }}>
        <span>Total order dipilih ({dipilih.size}): <b>{rp(total)}</b></span>
        <span>Dana masuk: <b>{rp(danaN)}</b></span>
        <span style={{ color: potongan < 0 ? "#b91c1c" : undefined }}>
          {potongan < 0 ? "Dana masuk melebihi total order" : <>Potongan platform: <b>{rp(potongan)}</b></>}
        </span>
        <SubmitButton
          className="btn-acc" icon="ti-cash-banknote" pendingText="Menyimpan…" style={{ background: "var(--posb)" }}
          disabled={dipilih.size === 0 || danaN <= 0 || potongan < 0}
        >
          Catat pencairan {dipilih.size} order
        </SubmitButton>
      </div>
    </form>
  );
}
