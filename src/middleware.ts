import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Session and module checks read Supabase in Seoul on every navigation.
  // `regions` alone is ignored by Edge middleware (it always runs at the
  // nearest edge, e.g. Singapore). Node.js middleware (stable since Next 15.5)
  // runs as a Vercel Function, so it honors icn1. Rollback: delete this line.
  runtime: "nodejs",
  regions: ["icn1"],
  matcher: [
    // `api/cron` sengaja dikecualikan: cron Vercel memanggilnya TANPA sesi login,
    // jadi kalau ikut disaring di sini permintaannya dibelokkan ke /login dan
    // pekerjaan bulanannya tidak pernah jalan — gagal diam-diam, tanpa error.
    // Route-nya menjaga dirinya sendiri dengan CRON_SECRET.
    "/((?!api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
