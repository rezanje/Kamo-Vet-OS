import { createClient } from "@/lib/supabase/server";
import { hapusDokumen } from "./actions";
import { DokumenTambah } from "./DokumenTambah";

// Panel lampiran satu dokumen (PO, penjualan, pengeluaran, ...). Bucket `dokumen`
// privat, jadi link dibuat sebagai signed URL berumur 1 jam saat halaman dirender.
export async function DokumenPanel({
  modul, refId, kembali, judul = "DOKUMEN & LAMPIRAN",
}: { modul: string; refId: string; kembali: string; judul?: string }) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("document_attachments")
    .select("id, nama, path, mime, ukuran, created_at, pengunggah:uploaded_by(full_name)")
    .eq("modul", modul).eq("ref_id", refId)
    .order("created_at", { ascending: false });

  type Row = {
    id: string; nama: string; path: string; mime: string | null; ukuran: number | null;
    created_at: string; pengunggah: { full_name: string | null } | { full_name: string | null }[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  const linkOf: Record<string, string> = {};
  if (rows.length) {
    const { data: signed } = await supabase.storage.from("dokumen").createSignedUrls(rows.map((r) => r.path), 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) linkOf[s.path] = s.signedUrl;
  }

  return (
    <div className="crm-sec">
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".03em", marginBottom: 2 }}>{judul}</div>
      <div style={{ fontSize: 10.5, color: "var(--td)", marginBottom: 10 }}>
        Nota, bukti transfer, surat jalan — supaya tim tidak perlu saling kirim file lewat chat.
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--td)" }}>Belum ada dokumen dilampirkan.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((r) => {
            const oleh = Array.isArray(r.pengunggah) ? r.pengunggah[0] : r.pengunggah;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", border: ".5px solid var(--bd)", borderRadius: 6 }}>
                <i className={`ti ${r.mime?.startsWith("image/") ? "ti-photo" : "ti-file-text"}`} style={{ color: "var(--tm)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <a href={linkOf[r.path] ?? "#"} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ac)", textDecoration: "none" }}>
                    {r.nama}
                  </a>
                  <div style={{ fontSize: 9.5, color: "var(--td)" }}>
                    {new Date(r.created_at).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {oleh?.full_name ? ` · ${oleh.full_name}` : ""}
                    {r.ukuran ? ` · ${Math.max(1, Math.round(Number(r.ukuran) / 1024))} KB` : ""}
                  </div>
                </div>
                <form action={hapusDokumen}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="kembali" value={kembali} />
                  <button type="submit" className="btn-def" style={{ padding: "2px 8px", fontSize: 10, color: "#b91c1c" }} title="Hapus dokumen">
                    <i className="ti ti-trash" />
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <DokumenTambah modul={modul} refId={refId} kembali={kembali} folder={`${modul}/${refId}`} />
    </div>
  );
}
