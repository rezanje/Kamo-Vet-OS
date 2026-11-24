"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { Pesan } from "../KartuMasuk";
import { mintaLinkReset } from "./actions";

export function LupaPasswordForm() {
  const [hasil, aksi] = useActionState(mintaLinkReset, null);
  return (
    <form action={aksi} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {hasil && <Pesan ok={hasil.ok}>{hasil.message}</Pesan>}
      <div className="fg">
        <label className="flab" htmlFor="lupa-email">Email login</label>
        <input id="lupa-email" className="fi" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="nama@email.com" />
      </div>
      <SubmitButton className="btn-acc" style={{ width: "100%", justifyContent: "center", background: "var(--posb)", padding: "10px 0", fontSize: 13 }} pendingText="Mengirim…">
        {hasil?.ok ? "Kirim ulang link" : "Kirim link reset password"}
      </SubmitButton>
    </form>
  );
}
