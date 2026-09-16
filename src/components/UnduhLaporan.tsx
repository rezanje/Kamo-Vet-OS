"use client";

import { useState } from "react";

type Bagian = string[][];

function dataTampilan(): Bagian[] {
  return [...document.querySelectorAll<HTMLTableElement>("#laporan-isi table")]
    .map((table) => [...table.rows].map((row) => [...row.cells].map((cell) => cell.innerText.trim())))
    .filter((rows) => rows.length > 0);
}

function amanSpreadsheet(nilai: string): string {
  return /^[\s]*[=+\-@]/.test(nilai) ? `'${nilai}` : nilai;
}

function unduh(blob: Blob, nama: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nama;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function UnduhLaporan({ judul }: { judul: string }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState("");
  const nama = judul.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "laporan";

  async function simpan(format: "csv" | "xlsx") {
    const bagian = dataTampilan();
    if (bagian.length === 0) { setPesan("Belum ada tabel untuk diunduh."); return; }
    setPesan("");
    setSibuk(true);
    try {
      if (format === "csv") {
        const rows = bagian.flatMap((isi, index) => [
          [`Bagian ${index + 1}`],
          ...isi,
          [],
        ]);
        const csv = "\uFEFF" + rows.map((row) => row.map((cell) =>
          `"${amanSpreadsheet(cell).replaceAll('"', '""')}\"`).join(",")).join("\r\n");
        unduh(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${nama}.csv`);
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        bagian.forEach((isi, index) => {
          const sheet = workbook.addWorksheet(`Bagian ${index + 1}`);
          isi.forEach((row) => sheet.addRow(row.map(amanSpreadsheet)));
          if (sheet.rowCount > 0) sheet.getRow(1).font = { bold: true };
        });
        const buffer = await workbook.xlsx.writeBuffer();
        unduh(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${nama}.xlsx`);
      }
    } catch {
      setPesan("Unduhan gagal. Coba lagi.");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ fontSize: 11, color: "var(--tm)" }}>Unduh data yang tampil:</span>
      <button type="button" className="btn-def" disabled={sibuk} onClick={() => void simpan("csv")}>CSV</button>
      <button type="button" className="btn-def" disabled={sibuk} onClick={() => void simpan("xlsx")}>Excel</button>
      <button type="button" className="btn-def" onClick={() => window.print()}>Cetak / PDF</button>
      {pesan && <span role="alert" style={{ fontSize: 11, color: "#b91c1c" }}>{pesan}</span>}
    </div>
  );
}
