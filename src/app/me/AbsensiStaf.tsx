"use client";
import { useState } from "react";
import { AbsenTombol } from "./AbsenTombol";
import { clockIn, clockOut } from "./actions";
export function AbsensiStaf({
  action,
  sessionBranch,
  branches,
}: {
  action: "clockIn" | "clockOut" | null;
  sessionBranch?: string;
  branches: { id: string; name: string }[];
}) {
  const [branch, setBranch] = useState(branches[0]?.id ?? "");
  if (action === null) return <span className="bge g">Sesi selesai</span>;
  const id = action === "clockOut" ? sessionBranch : branch;
  if (!id)
    return (
      <p role="alert">
        Cabang sesi atau penugasan aktif belum tersedia. Hubungi HR.
      </p>
    );
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      {action === "clockIn" && (
        <>
          <label htmlFor="attendance-branch">Cabang masuk</label>
          <select
            id="attendance-branch"
            className="fi"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            style={{ width: 220 }}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </>
      )}
      {action === "clockOut" && (
        <span>
          Checkout cabang sesi masuk:{" "}
          {branches.find((b) => b.id === id)?.name ?? "Cabang tercatat"}
        </span>
      )}
      <AbsenTombol
        branchId={id}
        aksi={action === "clockIn" ? clockIn : clockOut}
        label={action === "clockIn" ? "Clock In" : "Clock Out"}
        icon={action === "clockIn" ? "ti-login-2" : "ti-logout-2"}
      />
    </div>
  );
}
