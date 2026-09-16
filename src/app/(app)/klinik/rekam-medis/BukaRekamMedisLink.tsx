"use client";

import Link from "next/link";
import { useState } from "react";

export function BukaRekamMedisLink({ href }: { href: string }) {
  const [opening, setOpening] = useState(false);

  return (
    <>
      <Link
        href={href}
        className="btn-def"
        aria-busy={opening}
        onClick={(event) => {
          if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) setOpening(true);
        }}
        style={{ textDecoration: "none", padding: "5px 10px", minWidth: 76, justifyContent: "center" }}
      >
        <i className={`ti ${opening ? "ti-loader-2" : "ti-eye"}`} style={opening ? { animation: "spin .8s linear infinite" } : undefined} />
        {opening ? " Membuka…" : " Buka"}
      </Link>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </>
  );
}
