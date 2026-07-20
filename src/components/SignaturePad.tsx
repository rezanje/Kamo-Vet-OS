"use client";

import { useEffect, useRef, useState } from "react";

// Canvas tanda tangan — pointer events, tanpa library. Hasilnya data URL PNG yang
// disimpan langsung di kolom consents.signature_data (tidak masuk storage).
export function SignaturePad({ name, width = 420, height = 150 }: {
  name: string; width?: number; height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [kosong, setKosong] = useState(true);
  const [data, setData] = useState("");

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Skala DPR biar garis tidak pecah di layar retina.
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#141413";
  }, [width, height]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // Pointer capture bisa gagal (pointer sudah lepas / bukan pointer aktif). Kalau
    // dibiarkan melempar, seluruh handler batal dan tanda tangan tidak pernah mulai.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // lanjut menggambar tanpa capture — cukup untuk kasus normal.
    }
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const url = ref.current?.toDataURL("image/png") ?? "";
    setData(url);
    setKosong(false);
  };

  const clear = () => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setData("");
    setKosong(true);
  };

  return (
    <div>
      <input type="hidden" name={name} value={data} />
      <div style={{ border: ".5px solid var(--bd)", borderRadius: 8, background: "#fff", position: "relative", width, maxWidth: "100%" }}>
        <canvas
          ref={ref}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          style={{ width, height, maxWidth: "100%", touchAction: "none", cursor: "crosshair", display: "block" }}
        />
        {kosong && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", fontSize: 11, color: "var(--td)" }}>
            Tanda tangan di sini
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 5 }}>
        <span style={{ fontSize: 9.5, color: "var(--td)" }}>Gunakan jari atau mouse.</span>
        <button type="button" onClick={clear} className="back-btn" style={{ fontSize: 10.5, color: "#b91c1c" }}>
          <i className="ti ti-eraser" /> Hapus
        </button>
      </div>
    </div>
  );
}
