// Chart SVG minimal — no dependency. Buat dashboard keuangan.

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const rpShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return "Rp " + (n / 1e9).toFixed(1).replace(".0", "") + "M";
  if (a >= 1e6) return "Rp " + (n / 1e6).toFixed(1).replace(".0", "") + "jt";
  if (a >= 1e3) return "Rp " + Math.round(n / 1e3) + "rb";
  return "Rp " + Math.round(n);
};

// Donut dengan angka tengah. segments: [{value, color}].
export function Donut({ segments, centerLabel, centerSub, size = 120 }: {
  segments: { value: number; color: string }[];
  centerLabel: string; centerSub?: string; size?: number;
}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  // Precompute dash + offset (React compiler tak izinkan mutasi var saat render).
  const segs = segments.reduce<{ color: string; dash: number; offset: number }[]>((acc, s) => {
    const prev = acc.length ? acc[acc.length - 1] : null;
    const offset = prev ? prev.offset + prev.dash : 0;
    acc.push({ color: s.color, dash: (Math.max(0, s.value) / total) * c, offset });
    return acc;
  }, []);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bd)" strokeWidth={11} />
      {segs.map((s, i) => (
        <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={11}
          strokeDasharray={`${s.dash} ${c - s.dash}`} strokeDashoffset={-s.offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="butt" />
      ))}
      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: size * 0.17, fontWeight: 800, fill: "var(--tx)" }}>{centerLabel}</text>
      {centerSub && <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: size * 0.09, fill: "var(--tm)" }}>{centerSub}</text>}
    </svg>
  );
}

// Line chart sederhana (tren). points: nilai; labels: sumbu-x.
export function LineChart({ points, labels, w = 460, h = 180, color = "#2563eb" }: {
  points: number[]; labels: string[]; w?: number; h?: number; color?: string;
}) {
  const pad = { t: 12, r: 10, b: 22, l: 44 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(...points, 1);
  const n = points.length;
  const x = (i: number) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const path = points.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L ${x(n - 1).toFixed(1)} ${pad.t + ih} L ${x(0).toFixed(1)} ${pad.t + ih} Z`;
  const grid = [0, 0.5, 1];
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      {grid.map((g) => {
        const gy = pad.t + ih - g * ih;
        return (
          <g key={g}>
            <line x1={pad.l} y1={gy} x2={w - pad.r} y2={gy} stroke="var(--bd)" strokeWidth={0.5} />
            <text x={pad.l - 6} y={gy + 3} textAnchor="end" style={{ fontSize: 8.5, fill: "var(--td)" }}>{rpShort(g * max)}</text>
          </g>
        );
      })}
      <path d={area} fill={color} opacity={0.08} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={color} />)}
      {labels.map((l, i) => <text key={i} x={x(i)} y={h - 6} textAnchor="middle" style={{ fontSize: 8.5, fill: "var(--td)" }}>{l}</text>)}
    </svg>
  );
}

// Bar chart arus kas: masuk (hijau) & keluar (merah) per hari, saldo net garis.
export function CashFlowChart({ data, w = 460, h = 190 }: {
  data: { tanggal: string; masuk: number; keluar: number }[]; w?: number; h?: number;
}) {
  const pad = { t: 12, r: 10, b: 22, l: 48 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const maxV = Math.max(...data.map((d) => Math.max(d.masuk, d.keluar)), 1);
  const n = data.length;
  const slot = iw / n;
  const bw = Math.min(18, slot * 0.34);
  const zeroY = pad.t + ih / 2;
  const scale = (v: number) => (v / maxV) * (ih / 2);
  const lbl = (t: string) => { const d = new Date(t + "T00:00:00"); return `${d.getDate()}/${d.getMonth() + 1}`; };
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <line x1={pad.l} y1={zeroY} x2={w - pad.r} y2={zeroY} stroke="var(--bd)" strokeWidth={0.5} />
      <text x={pad.l - 6} y={pad.t + 4} textAnchor="end" style={{ fontSize: 8.5, fill: "var(--td)" }}>{rpShort(maxV)}</text>
      <text x={pad.l - 6} y={pad.t + ih + 2} textAnchor="end" style={{ fontSize: 8.5, fill: "var(--td)" }}>-{rpShort(maxV)}</text>
      {data.map((d, i) => {
        const cx = pad.l + slot * i + slot / 2;
        const hIn = scale(d.masuk), hOut = scale(d.keluar);
        return (
          <g key={i}>
            <rect x={cx - bw - 1} y={zeroY - hIn} width={bw} height={hIn} rx={2} fill="#16a34a" opacity={0.85}>
              <title>{`${lbl(d.tanggal)} masuk ${rp(d.masuk)}`}</title>
            </rect>
            <rect x={cx + 1} y={zeroY} width={bw} height={hOut} rx={2} fill="#dc2626" opacity={0.8}>
              <title>{`${lbl(d.tanggal)} keluar ${rp(d.keluar)}`}</title>
            </rect>
            <text x={cx} y={h - 6} textAnchor="middle" style={{ fontSize: 8.5, fill: "var(--td)" }}>{lbl(d.tanggal)}</text>
          </g>
        );
      })}
    </svg>
  );
}
