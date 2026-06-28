"use client";

import { usePathname } from "next/navigation";
import { MODULE_LABEL } from "@/lib/nav";

export function Breadcrumb() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const moduleId = parts[0] ?? "";
  const moduleLabel = pathname === "/" ? "Dashboard" : MODULE_LABEL[moduleId] ?? moduleId;
  const sub = parts[1];

  return (
    <div className="bc">
      <i className="ti ti-home" style={{ fontSize: 14 }} />
      <span>/</span>
      <span style={{ color: "var(--tx)", fontWeight: 500 }}>{moduleLabel}</span>
      {sub && (
        <>
          <span>/</span>
          <span style={{ color: "var(--acc)" }}>{sub}</span>
        </>
      )}
    </div>
  );
}
