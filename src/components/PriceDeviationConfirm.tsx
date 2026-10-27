/**
 * P04: tampil setelah server menolak simpan karena harga menyimpang jauh dari harga pokok acuan.
 * Pengguna memperbaiki harga lalu simpan lagi (dicek ulang), atau mencentang konfirmasi
 * untuk tetap menyimpan apa adanya. Penegakannya di server action, bukan di sini.
 */
export function PriceDeviationConfirm({ warning }: { warning?: string | null }) {
  if (!warning) return null;
  return <div role="alert" className="p2ban" style={{ background: "#fffbeb", border: ".5px solid #fcd34d", color: "#92400e", marginTop: 10 }}>
    <div style={{ marginBottom: 6 }}><i className="ti ti-alert-triangle" /> {warning}</div>
    <label style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: "pointer" }}>
      <input type="checkbox" name="konfirmasi_harga" /* = PRICE_CONFIRM_FIELD di lib/purchase-price-check */ value="1" />
      <span>Saya sudah memeriksa satuan dan harganya. Simpan apa adanya.</span>
    </label>
  </div>;
}
