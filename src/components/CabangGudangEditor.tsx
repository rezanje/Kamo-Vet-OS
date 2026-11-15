"use client";
import { useState } from "react";
import { aturStatusCabang, ubahCabang } from "@/app/(app)/perusahaan/cabang/actions";
import { aturStatusGudang, hapusGudang, ubahGudang } from "@/app/(app)/perusahaan/gudang/actions";
import {
  ALASAN_MAX, ALASAN_MIN, NAMA_CABANG_MAX, NAMA_GUDANG_MAX, keputusanHapusGudang, namaKembar, rapikanNama,
} from "@/lib/cabang-gudang-edit";

const JENIS_GUDANG: Record<string, string> = {
  VET: "Klinik", RETAIL: "Retail", DC: "Distribusi", EXPIRED: "Kedaluwarsa", TRANSIT: "Transit", ONLINE: "Online",
};
const JENIS_CABANG: Record<string, string> = {
  BOTH: "Klinik & petshop", KLINIK: "Klinik", PETSHOP: "Petshop", DC: "Gudang distribusi", ONLINE: "Online", OFFICE: "Kantor",
};
const CATATAN: React.CSSProperties = { fontSize: 10.5, color: "var(--tm)", margin: "2px 0 0" };
const PANEL: React.CSSProperties = { marginTop: 8, padding: 10, border: ".5px solid var(--bd, #e5e7eb)", borderRadius: 8, maxWidth: 420, whiteSpace: "normal" };
const GALAT: React.CSSProperties = { color: "#b91c1c", fontSize: 11, margin: "4px 0 0" };

type Mode = null | "ubah" | "status" | "hapus";

export function CabangEditor({ branch, kodeTerkunci, namaLain }: {
  branch: { id: string; code: string; name: string; type: string; is_active: boolean };
  kodeTerkunci: boolean;
  namaLain: string[];
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [nama, setNama] = useState(branch.name);
  const kembar = namaKembar(nama, namaLain);
  const toggle = (next: Exclude<Mode, null>) => setMode(mode === next ? null : next);
  const aktifBaru = branch.is_active ? "0" : "1";
  return (
    <div style={{ margin: "2px 0 8px" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn-def" aria-expanded={mode === "ubah"} onClick={() => toggle("ubah")}><i className="ti ti-pencil" /> Ubah</button>
        <button type="button" className="btn-def" aria-expanded={mode === "status"} onClick={() => toggle("status")}>{branch.is_active ? "Nonaktifkan" : "Aktifkan"}</button>
        {!branch.is_active && <span className="badge bo">Nonaktif</span>}
      </div>
      {mode === "ubah" && (
        <form action={ubahCabang} aria-label={`Ubah cabang ${branch.name}`} style={PANEL}>
          <input type="hidden" name="id" value={branch.id} />
          <label style={{ display: "block" }}><span className="flab">Nama cabang *</span>
            <input className="fi" name="name" required minLength={2} maxLength={NAMA_CABANG_MAX} value={nama} onChange={event => setNama(event.target.value)} />
          </label>
          {kembar && rapikanNama(nama) !== rapikanNama(branch.name) && <p role="alert" style={GALAT}>Nama ini sudah dipakai cabang lain.</p>}
          <label style={{ display: "block", marginTop: 6 }}><span className="flab">Kode cabang</span>
            {kodeTerkunci
              ? <input className="fi" value={branch.code} readOnly aria-readonly="true" />
              : <input className="fi" name="code" defaultValue={branch.code} maxLength={15} pattern="[A-Za-z0-9][A-Za-z0-9 ._\-]{0,14}" />}
          </label>
          <p style={CATATAN}>{kodeTerkunci
            ? "Kode tidak bisa diubah: cabang ini sudah punya transaksi atau riwayat, dan kode bisa dipakai di laporan. Ubah namanya saja."
            : "Kode belum dipakai transaksi, jadi masih boleh diubah. Setelah ada transaksi kode terkunci."}</p>
          <div style={{ marginTop: 6 }}><span className="flab">Jenis</span> <strong style={{ fontSize: 12 }}>{JENIS_CABANG[branch.type] ?? branch.type}</strong>
            <p style={CATATAN}>Jenis cabang tidak bisa diubah.</p></div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="submit" className="btn-acc" disabled={kembar && rapikanNama(nama) !== rapikanNama(branch.name)}>Simpan</button>
            <button type="button" className="btn-def" onClick={() => setMode(null)}>Batal</button>
          </div>
        </form>
      )}
      {mode === "status" && (
        <form action={aturStatusCabang} aria-label={`${branch.is_active ? "Nonaktifkan" : "Aktifkan"} cabang ${branch.name}`} style={PANEL}>
          <input type="hidden" name="id" value={branch.id} />
          <input type="hidden" name="is_active" value={aktifBaru} />
          <strong style={{ fontSize: 12 }}>{branch.is_active ? "Nonaktifkan" : "Aktifkan"} {branch.name}?</strong>
          <p style={CATATAN}>{branch.is_active
            ? "Cabang nonaktif tidak muncul di pilihan cabang. Ditolak bila masih ada shift kasir terbuka atau kunjungan klinik yang belum selesai. Riwayat tidak dihapus."
            : "Cabang akan muncul lagi di pilihan cabang."}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="submit" className="btn-acc">Ya, {branch.is_active ? "nonaktifkan" : "aktifkan"}</button>
            <button type="button" className="btn-def" onClick={() => setMode(null)}>Batal</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function GudangEditor({ warehouse, role, dipakai, namaLain }: {
  warehouse: { id: string; code: string; name: string; type: string; is_active: boolean };
  role: string | null;
  dipakai: boolean;
  namaLain: string[];
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [nama, setNama] = useState(warehouse.name);
  const [alasan, setAlasan] = useState("");
  const kembar = namaKembar(nama, namaLain) && rapikanNama(nama) !== rapikanNama(warehouse.name);
  const hapus = keputusanHapusGudang(role, dipakai);
  const toggle = (next: Exclude<Mode, null>) => setMode(mode === next ? null : next);
  return (
    <div style={{ minWidth: 180, whiteSpace: "normal" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn-def" aria-expanded={mode === "ubah"} onClick={() => toggle("ubah")}>Ubah</button>
        <button type="button" className="btn-def" aria-expanded={mode === "status"} onClick={() => toggle("status")}>{warehouse.is_active ? "Nonaktifkan" : "Aktifkan"}</button>
        <button type="button" className="btn-def" disabled={!hapus.boleh} aria-expanded={mode === "hapus"} title={hapus.alasan ?? undefined}
          style={hapus.boleh ? { color: "#b91c1c" } : undefined} onClick={() => hapus.boleh && toggle("hapus")}>Hapus</button>
      </div>
      {!hapus.boleh && <p style={CATATAN}>{hapus.alasan}</p>}
      {mode === "ubah" && (
        <form action={ubahGudang} aria-label={`Ubah gudang ${warehouse.name}`} style={PANEL}>
          <input type="hidden" name="id" value={warehouse.id} />
          <label style={{ display: "block" }}><span className="flab">Nama gudang *</span>
            <input className="fi" name="name" required minLength={2} maxLength={NAMA_GUDANG_MAX} value={nama} onChange={event => setNama(event.target.value)} />
          </label>
          {kembar && <p role="alert" style={GALAT}>Nama ini sudah dipakai gudang lain di cabang ini.</p>}
          <label style={{ display: "block", marginTop: 6 }}><span className="flab">Kode gudang</span>
            {dipakai
              ? <input className="fi" value={warehouse.code} readOnly aria-readonly="true" />
              : <input className="fi" name="code" defaultValue={warehouse.code} maxLength={20} pattern="[A-Za-z0-9][A-Za-z0-9 ._\-]{0,19}" />}
          </label>
          <label style={{ display: "block", marginTop: 6 }}><span className="flab">Jenis</span>
            {dipakai
              ? <input className="fi" value={JENIS_GUDANG[warehouse.type] ?? warehouse.type} readOnly aria-readonly="true" />
              : <select className="fi" name="type" defaultValue={warehouse.type}>{Object.entries(JENIS_GUDANG).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
          </label>
          <p style={CATATAN}>{dipakai
            ? "Kode dan jenis tidak bisa diubah: gudang ini sudah dipakai stok atau dokumen. Ubah namanya saja."
            : "Gudang belum dipakai, jadi kode dan jenis masih boleh diubah."}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="submit" className="btn-acc" disabled={kembar}>Simpan</button>
            <button type="button" className="btn-def" onClick={() => setMode(null)}>Batal</button>
          </div>
        </form>
      )}
      {mode === "status" && (
        <form action={aturStatusGudang} aria-label={`${warehouse.is_active ? "Nonaktifkan" : "Aktifkan"} gudang ${warehouse.name}`} style={PANEL}>
          <input type="hidden" name="id" value={warehouse.id} />
          <input type="hidden" name="is_active" value={warehouse.is_active ? "0" : "1"} />
          <strong style={{ fontSize: 12 }}>{warehouse.is_active ? "Nonaktifkan" : "Aktifkan"} {warehouse.name}?</strong>
          <p style={CATATAN}>{warehouse.is_active
            ? "Ditolak bila gudang masih berstok, masih dipakai transfer/permintaan/opname yang belum selesai, atau satu-satunya gudang klinik/retail aktif di cabangnya."
            : "Gudang akan dipakai lagi untuk stok masuk dan keluar."}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="submit" className="btn-acc">Ya, {warehouse.is_active ? "nonaktifkan" : "aktifkan"}</button>
            <button type="button" className="btn-def" onClick={() => setMode(null)}>Batal</button>
          </div>
        </form>
      )}
      {mode === "hapus" && hapus.boleh && (
        <form action={hapusGudang} role="alertdialog" aria-label={`Hapus gudang ${warehouse.name}`} style={{ ...PANEL, borderColor: "#fca5a5" }}>
          <input type="hidden" name="id" value={warehouse.id} />
          <strong style={{ fontSize: 12, color: "#b91c1c" }}>Hapus gudang {warehouse.name} ({warehouse.code})?</strong>
          <p style={CATATAN}>Gudang dihapus permanen dan tidak bisa dikembalikan. Hanya bisa bila belum pernah dipakai; kalau ragu, pakai Nonaktifkan.</p>
          <label style={{ display: "block", marginTop: 6 }}><span className="flab">Alasan hapus *</span>
            <textarea className="fi" name="reason" required minLength={ALASAN_MIN} maxLength={ALASAN_MAX} value={alasan} onChange={event => setAlasan(event.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="submit" className="btn-acc" style={{ background: "#b91c1c" }} disabled={alasan.trim().length < ALASAN_MIN}>Ya, hapus gudang</button>
            <button type="button" className="btn-def" onClick={() => setMode(null)}>Batal</button>
          </div>
        </form>
      )}
    </div>
  );
}
