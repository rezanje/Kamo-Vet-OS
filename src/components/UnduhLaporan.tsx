"use client";

import { useState } from "react";
import { displaySections, displayFilters } from "@/lib/report-display-export";
import { reportCsv } from "@/lib/csv-report";

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

export function UnduhLaporan({ judul, selector = "#laporan-isi" }: { judul: string; selector?: string }) {
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState("");
  const nama = judul.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "laporan";

  async function simpan(format: "csv" | "xlsx") {
    const root = document.querySelector<HTMLElement>(selector);
    if (!root) { setPesan("Belum ada laporan untuk diunduh."); return; }
    const bagian = displaySections(root);
    if (bagian.length === 0) { setPesan("Belum ada data untuk diunduh."); return; }
    const context = [[judul], ["Alamat laporan", window.location.href], ...displayFilters(root.closest("[data-report-page]") ?? document)];
    setPesan("");
    setSibuk(true);
    try {
      if (format === "csv") {
        const rows = [...context, [], ...bagian.flatMap(({ name, rows }) => [[name], ...rows, []])];
        const csv = reportCsv([], rows);
        unduh(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${nama}.csv`);
      } else {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        workbook.addWorksheet("Filter laporan").addRows(context.map(row => row.map(amanSpreadsheet)));
        bagian.forEach(({ name, rows }) => {
          const sheet = workbook.addWorksheet(name);
          rows.forEach((row) => sheet.addRow(row.map(amanSpreadsheet)));
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

  function cetak() {
    const root = document.querySelector<HTMLElement>(selector);
    if (!root) { setPesan("Belum ada laporan untuk dicetak."); return; }
    const popup = window.open("", "_blank");
    if (!popup) { setPesan("Izinkan jendela cetak pada browser, lalu coba lagi."); return; }
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".no-print,button,form").forEach(node => node.remove());
    const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
    const filters = displayFilters(root.closest("[data-report-page]") ?? document);
    popup.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escape(judul)}</title><style>body{font:11px Arial;color:#172033}table{width:100%;border-collapse:collapse;min-width:0!important}th,td{border:1px solid #ccd2dc;padding:5px}thead{display:table-header-group}tr{break-inside:avoid}a{color:inherit;text-decoration:none}div{overflow:visible!important}[data-report-row]{display:flex;justify-content:space-between;gap:12px}@page{size:A3 landscape;margin:10mm}@media print{button{display:none}}</style></head><body><button id="cetak">Cetak / simpan PDF</button><h1>${escape(judul)}</h1><p>${filters.map(([key,value]) => `${escape(key)}: ${escape(value)}`).join(" · ")}</p>${clone.innerHTML}</body></html>`);
    popup.document.close();
    popup.document.getElementById("cetak")!.onclick = () => popup.print();
    popup.opener = null;
  }

  return (
    <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      <span style={{ fontSize: 11, color: "var(--tm)" }}>Unduh data yang tampil:</span>
      <button type="button" className="btn-def" disabled={sibuk} onClick={() => void simpan("csv")}>CSV</button>
      <button type="button" className="btn-def" disabled={sibuk} onClick={() => void simpan("xlsx")}>Excel</button>
      <button type="button" className="btn-def" onClick={cetak}>Cetak / PDF</button>
      {pesan && <span role="alert" style={{ fontSize: 11, color: "#b91c1c" }}>{pesan}</span>}
    </div>
  );
}
