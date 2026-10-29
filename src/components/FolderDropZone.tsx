"use client";
import { useRef, useState, type DragEvent } from "react";
import { bacaFolderJatuh, type EntriFolderJatuh } from "@/lib/impor-rekam-medis-drop";

export function FolderDropZone({ disabled, onChoose, onBusy, onError }: {
  disabled: boolean; onChoose: (files: File[]) => void; onBusy: (value: boolean) => void; onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const reading = useRef(false);
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setHover(false);
    if (disabled || reading.current) return;
    // Capture entries before awaiting: the browser closes access to DataTransfer
    // after the synchronous event handler returns.
    const items = Array.from(event.dataTransfer.items).filter((item) => item.kind === "file");
    const entries = items.map((item) => item.webkitGetAsEntry?.() as EntriFolderJatuh | null);
    if (!entries.length || entries.some((entry) => !entry)) {
      onError("Browser belum bisa membaca folder yang diseret. Gunakan Chrome/Edge terbaru, atau pilih satu folder induk.");
      return;
    }
    reading.current = true; setBusy(true); onBusy(true);
    void (async () => {
      try {
        const files = await bacaFolderJatuh(entries as EntriFolderJatuh[]);
        if (!files.length) throw new Error("Folder tidak berisi kartu medis .xlsx.");
        onChoose(files);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Folder tidak dapat dibaca. Pilihan sebelumnya tidak diubah.");
      } finally {
        reading.current = false; setBusy(false); onBusy(false);
      }
    })();
  };
  return <div aria-label="Taruh folder rekam medis" aria-disabled={disabled || busy} aria-busy={busy}
    onDrop={drop}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = disabled || busy ? "none" : "copy"; if (!disabled && !busy) setHover(true); }}
    onDragLeave={() => setHover(false)}
    style={{ marginTop: 12, border: `2px dashed ${hover ? "#2563eb" : "#93c5fd"}`, borderRadius: 8, padding: 16,
      background: hover ? "#dbeafe" : "#eff6ff", color: "#1e40af", opacity: disabled ? 0.6 : 1 }}>
    <strong>{busy ? "Membaca daftar folder…" : "Taruh banyak folder sekaligus di sini"}</strong>
    <div style={{ fontSize: 11, marginTop: 5 }}>
      Di Windows Explorer, pilih folder-folder dengan Shift atau Ctrl, lalu seret bersama ke kotak ini.
      Semua subfolder ikut dibaca. Belum menyimpan rekam medis sampai Anda klik Mulai.
    </div>
  </div>;
}
