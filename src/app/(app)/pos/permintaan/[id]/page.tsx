import { NumberInput } from "@/components/NumberInput";
import { TransactionForm } from "@/components/LocalTransactionDraft";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SecHeader } from "@/components/SecHeader";
import { kirimPermintaan, setujuiPermintaan, terimaDariBackoffice, updateRequestStatus } from "../actions";
import { siapkanKirim, type BarisPermintaan } from "@/lib/permintaan-kirim";
import { loadWarehouseStock } from "@/lib/warehouse-stock";
import { StokKurangDariPesan } from "@/components/StokKurangPopup";
import { BatalKirimPermintaanForm } from "./BatalKirimPermintaanForm";

type Rel<T> = T | T[] | null;
function one<T>(r: Rel<T>): T | null {
  return Array.isArray(r) ? (r[0] ?? null) : r;
}

const BADGE: Record<string, string> = {
  "Menunggu Persetujuan": "o", Disetujui: "b", Dikirim: "b", Selesai: "g", Ditolak: "r",
};
const fmtDt = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Detail = {
  id: string;
  no_request: string | null;
  status: string;
  created_at: string;
  priority: string | null;
  catatan: string | null;
  to_warehouse_id: string | null;
  branches: Rel<{ name: string }>;
  warehouses: Rel<{ name: string }>;
  stock_request_items: ({
    qty_diterima: number | null;
    kondisi: string | null;
    catatan: string | null;
  } & BarisPermintaan)[] | null;
};

type RiwayatBatal = {
  id: string;
  reason: string;
  created_at: string;
  pelaku: Rel<{ full_name: string | null }>;
};

const qty = (v: number) => Number(v.toFixed(6)).toLocaleString("id-ID", { maximumFractionDigits: 6 });

export default async function PermintaanDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ success?: string; error?: string; trm?: string }>;
}) {
  const { id } = await params;
  const { success, error, trm } = await searchParams;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const { data } = await supabase
    .from("stock_requests")
    .select("id, no_request, status, created_at, priority, catatan, to_warehouse_id, branches(name), warehouses!stock_requests_to_warehouse_id_fkey(name), stock_request_items(id, item_id, nama, satuan, faktor, qty_diminta, qty_disetujui, qty_dikirim, qty_diterima, kondisi, catatan)")
    .eq("id", id)
    .maybeSingle();

  const req = data as unknown as Detail | null;
  if (!req) notFound();

  const items = req.stock_request_items ?? [];
  const menunggu = req.status === "Menunggu Persetujuan";
  const disetujui = req.status === "Disetujui";
  const dikirim = req.status === "Dikirim";

  // Stok gudang pengirim ditarik begitu layarnya masih bisa memutuskan jumlah.
  // Tanpa ini, kekurangan stok baru ketahuan di cabang penerima — persis keluhan
  // yang dilaporkan Andri (minta 500, gudang punya 250, tetap bisa "Dikirim").
  const butuhStok = menunggu || disetujui;
  const stok = butuhStok && req.to_warehouse_id
    ? await loadWarehouseStock(supabase, [req.to_warehouse_id])
    : [];
  const petaStok = new Map(stok.map((s) => [s.item_id, Number(s.qty)]));
  // Riwayat pembatalan pengiriman. Permintaan yang dibatalkan kembali ke "Disetujui",
  // jadi tanpa jejak ini layar kehilangan alasan kenapa kiriman sebelumnya ditarik.
  const { data: pembatalan } = await supabase
    .from("stock_request_shipment_cancellations")
    .select("id, reason, created_at, pelaku:profiles!stock_request_shipment_cancellations_actor_id_fkey(full_name)")
    .eq("request_id", id)
    .order("created_at", { ascending: false });
  const riwayatBatal = (pembatalan ?? []) as unknown as RiwayatBatal[];

  const barisStok = siapkanKirim(items, petaStok, menunggu ? "diminta" : "disetujui");
  const stokBaris = new Map(barisStok.map((b) => [b.id, b]));
  const adaKurang = barisStok.some((b) => b.kurang);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <Link href="/pos/permintaan" className="back-btn">
          <i className="ti ti-arrow-left" /> Kembali
        </Link>
        <span style={{ color: "var(--td)" }}>·</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{req.no_request ?? "Permintaan Barang"}</span>
      </div>

      {success && (
        <div className="p2ban" style={{ background: "#e8f5ee", border: ".5px solid #86efac", color: "#15803d" }}>
          <i className="ti ti-circle-check" />{" "}
          {success === "terima"
            ? `Barang diterima${trm ? ` (${trm})` : ""} — stok cabang sudah bertambah.`
            : success === "kirim"
              ? "Barang dikirim — stok gudang pengirim sudah berkurang dan menunggu diterima cabang."
              : success === "batal-kirim"
                ? "Pengiriman dibatalkan — barang sudah kembali ke stok gudang pengirim dan permintaan ini bisa dikirim ulang."
                : "Permintaan disetujui dengan jumlah yang kamu tetapkan."}
        </div>
      )}
      {error && (
        <div className="p2ban" style={{ background: "#fef2f2", border: ".5px solid #fca5a5", color: "#b91c1c" }}>
          <i className="ti ti-alert-circle" /> {error}
        </div>
      )}
      {/* Penolakan stok (persetujuan maupun pengiriman) diangkat jadi popup yang
          sama dengan proses stok lain; bilah merah di atas tetap jadi jejaknya. */}
      <StokKurangDariPesan pesan={error} gudang={one(req.warehouses)?.name ?? null} />

      {riwayatBatal.length > 0 && (
        <div role="status" className="p2ban" style={{ background: "#fff7ed", border: ".5px solid #fdba74", color: "#9a3412" }}>
          <strong>Pengiriman pernah dibatalkan.</strong> Barangnya sudah kembali ke stok gudang pengirim.
          <ul style={{ margin: "5px 0 0", paddingLeft: 16 }}>
            {riwayatBatal.map((b) => (
              <li key={b.id} style={{ fontSize: 11 }}>
                {fmtDt(b.created_at)}
                {one(b.pelaku)?.full_name ? ` — ${one(b.pelaku)!.full_name}` : ""} — {b.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="crm-sec">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", paddingBottom: 12, borderBottom: ".5px solid var(--bd)", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 800 }}>{req.no_request ?? "—"}</div>
            <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>{fmtDt(req.created_at)}</div>
          </div>
          <span className={`bge ${BADGE[req.status] ?? "x"}`} style={{ fontSize: 11, padding: "4px 12px" }}>{req.status}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <Info label="Dari (Cabang)" value={one(req.branches)?.name ?? "—"} />
          <Info label="Tujuan (Gudang)" value={one(req.warehouses)?.name ?? "—"} />
          <Info label="Prioritas" value={req.priority === "tinggi" ? "Tinggi" : "Normal"} />
          <Info label="Catatan" value={req.catatan ?? "—"} />
        </div>
      </div>

      <TransactionForm userId={user?.id ?? ""} scope={`pos:permintaan:approve:${id}`} action={setujuiPermintaan}>
        <input type="hidden" name="id" value={req.id} />
        <div className="crm-sec">
          <SecHeader
            num="01"
            title="DAFTAR BARANG"
            desc={menunggu
              ? "Sesuaikan jumlah yang benar-benar dikirim — stok gudang tidak selalu cukup."
              : "Jumlah yang disetujui gudang & yang akhirnya diterima toko."}
          />

          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>No.</th>
                  <th>Nama Barang</th>
                  <th>Satuan</th>
                  <th style={{ textAlign: "center" }}>Diminta</th>
                  {butuhStok && <th style={{ textAlign: "center" }}>Stok gudang</th>}
                  <th style={{ textAlign: "center", width: 120 }}>Disetujui</th>
                  {!menunggu && <th style={{ textAlign: "center" }}>Dikirim</th>}
                  <th style={{ textAlign: "center" }}>Diterima</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id}>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{i + 1}</td>
                    <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.nama}</td>
                    <td style={{ fontSize: 11, color: "var(--tm)" }}>{it.satuan ?? "—"}</td>
                    <td style={{ textAlign: "center", fontSize: 11.5 }}>{Number(it.qty_diminta)}</td>
                    {butuhStok && (
                      <td style={{ textAlign: "center", fontSize: 11.5, color: stokBaris.get(it.id)?.kurang ? "#b91c1c" : "var(--tm)", fontWeight: stokBaris.get(it.id)?.kurang ? 700 : 400 }}>
                        {qty(stokBaris.get(it.id)?.tersedia ?? 0)}
                      </td>
                    )}
                    <td style={{ textAlign: "center" }}>
                      {menunggu ? (
                        <NumberInput
                          className="fi" type="number" min={0} step="any"
                          name={`qty_${it.id}`}
                          data-stok-kurang={it.nama}
                          defaultValue={it.qty_disetujui ?? stokBaris.get(it.id)?.usulan ?? it.qty_diminta}
                          style={{ width: 80, textAlign: "center" }}
                        />
                      ) : (
                        <span style={{ fontSize: 11.5 }}>{it.qty_disetujui != null ? Number(it.qty_disetujui) : "—"}</span>
                      )}
                    </td>
                    {!menunggu && (
                      <td style={{ textAlign: "center", fontSize: 11.5 }}>{it.qty_dikirim != null ? qty(Number(it.qty_dikirim)) : "—"}</td>
                    )}
                    <td style={{ textAlign: "center", fontSize: 11.5 }}>{it.qty_diterima != null ? Number(it.qty_diterima) : "—"}</td>
                    <td style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.catatan ?? "—"}</td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--td)", padding: "18px 0", fontSize: 11 }}>Tidak ada barang.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {menunggu && (
            <>
              {adaKurang && (
                <div style={{ fontSize: 10.5, color: "#b91c1c", marginTop: 8 }}>
                  <i className="ti ti-alert-triangle" /> Ada barang yang stok gudangnya kurang dari yang diminta.
                  Jumlah disetujui sudah diturunkan ke stok yang ada — persetujuan di atas stok akan ditolak.
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button type="submit" className="btn-acc">
                  <i className="ti ti-check" /> Setujui dengan jumlah ini
                </button>
              </div>
            </>
          )}
        </div>
      </TransactionForm>

      {menunggu && (
        <form action={updateRequestStatus} style={{ display: "flex", justifyContent: "flex-end" }}>
          <input type="hidden" name="id" value={req.id} />
          <input type="hidden" name="status" value="Ditolak" />
          <button type="submit" className="btn-def" style={{ color: "#b91c1c" }}>
            <i className="ti ti-x" /> Tolak permintaan
          </button>
        </form>
      )}

      {/* Pengiriman: di sinilah stok gudang pengirim BENAR-BENAR keluar (ke gudang
          transit). Dulu "Tandai Dikirim" cuma mengganti label, jadi kekurangan stok
          baru ketahuan saat cabang menerima. */}
      {disetujui && (
        <TransactionForm userId={user?.id ?? ""} scope={`pos:permintaan:ship:${id}`} action={kirimPermintaan}>
          <input type="hidden" name="id" value={req.id} />
          <div className="crm-sec">
            <SecHeader
              num="02"
              title="KIRIM BARANG"
              desc="Isi jumlah yang benar-benar dikirim. Stok gudang pengirim langsung berkurang; jumlah di atas stok ditolak."
            />
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th>Nama Barang</th>
                    <th style={{ width: 90 }}>Satuan</th>
                    <th style={{ width: 90, textAlign: "center" }}>Disetujui</th>
                    <th style={{ width: 100, textAlign: "center" }}>Stok gudang</th>
                    <th style={{ width: 120, textAlign: "center" }}>Qty Dikirim</th>
                  </tr>
                </thead>
                <tbody>
                  {barisStok.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontSize: 11.5, fontWeight: 500 }}>{b.nama}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{b.satuan ?? "—"}</td>
                      <td style={{ textAlign: "center", fontSize: 11.5 }}>{qty(b.plafon)}</td>
                      <td style={{ textAlign: "center", fontSize: 11.5, color: b.kurang ? "#b91c1c" : "var(--tm)", fontWeight: b.kurang ? 700 : 400 }}>
                        {qty(b.tersedia)}
                      </td>
                      <td>
                        <NumberInput
                          className="fi" type="number" min={0} max={b.plafon} step="any"
                          name={`qty_${b.id}`}
                          data-stok-kurang={b.nama}
                          defaultValue={b.usulan}
                          style={{ textAlign: "center" }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9.5, color: adaKurang ? "#b91c1c" : "var(--td)", margin: "8px 0 0" }}>
              {adaKurang
                ? "Stok gudang kurang untuk sebagian barang. Jumlah kirim sudah diturunkan ke stok yang ada; sisanya tidak ikut terkirim dan perlu permintaan baru setelah stok masuk."
                : "Kiriman sebagian diperbolehkan: isi lebih kecil dari jumlah disetujui bila hanya sebagian yang dikirim."}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="submit" className="btn-acc">
                <i className="ti ti-truck-delivery" /> Kirim barang &amp; kurangi stok gudang
              </button>
            </div>
          </div>
        </TransactionForm>
      )}

      {/* Penerimaan: satu-satunya cara permintaan jadi "Selesai", karena di sinilah
          stok benar-benar berpindah dari gudang pengirim ke gudang cabang. */}
      {dikirim && (
        <TransactionForm userId={user?.id ?? ""} scope={`pos:permintaan:receive:${id}`} action={terimaDariBackoffice}>
          <input type="hidden" name="id" value={req.id} />
          <div className="crm-sec">
            <SecHeader
              num="03"
              title="TERIMA BARANG"
              desc="Isi jumlah yang BENAR-BENAR sampai. Stok cabang bertambah sesuai angka ini, dan selisihnya jadi dasar klaim ke gudang pengirim."
            />
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ minWidth: 620 }}>
                <thead>
                  <tr>
                    <th>Nama Barang</th>
                    <th style={{ width: 90 }}>Satuan</th>
                    <th style={{ width: 90, textAlign: "center" }}>Dikirim</th>
                    <th style={{ width: 120, textAlign: "center" }}>Qty Diterima</th>
                    <th style={{ width: 140 }}>Kondisi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td style={{ fontSize: 11.5, fontWeight: 500 }}>{it.nama}</td>
                      <td style={{ fontSize: 11, color: "var(--tm)" }}>{it.satuan ?? "—"}</td>
                      <td style={{ textAlign: "center", fontSize: 11.5 }}>
                        {qty(Number(it.qty_dikirim ?? it.qty_disetujui ?? it.qty_diminta))}
                      </td>
                      <td>
                        <NumberInput
                          className="fi" type="number" min={0} max={Number(it.qty_dikirim ?? it.qty_disetujui ?? it.qty_diminta)} step="any"
                          name={`qty_${it.id}`}
                          defaultValue={Number(it.qty_dikirim ?? it.qty_disetujui ?? it.qty_diminta)}
                          style={{ textAlign: "center" }}
                        />
                      </td>
                      <td>
                        <select className="fi" name={`kondisi_${it.id}`} defaultValue="baik">
                          <option value="baik">Baik</option>
                          <option value="rusak">Rusak</option>
                          <option value="kurang">Kurang</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 9.5, color: "var(--td)", margin: "8px 0 0" }}>
              Hanya barang berkondisi <b>Baik</b> yang masuk stok jual. Rusak &amp; kurang tetap
              tercatat penuh di dokumen penerimaan.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="submit" className="btn-acc">
                <i className="ti ti-circle-check" /> Terima barang &amp; tambah stok cabang
              </button>
            </div>
          </div>
        </TransactionForm>
      )}

      {/* Koreksi salah kirim: satu-satunya jalan mengembalikan stok yang sudah keluar ke
          gudang transit tanpa memaksa cabang menerima barang yang salah. */}
      {dikirim && <BatalKirimPermintaanForm userId={user?.id ?? ""} requestId={req.id} />}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--td)", letterSpacing: ".03em", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
