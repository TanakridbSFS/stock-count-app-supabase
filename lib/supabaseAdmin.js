import { createClient } from "@supabase/supabase-js";

// Server-side only — uses the secret key (full read/write, bypasses RLS).
// Never import this from a page component or expose SUPABASE_SECRET_KEY
// to the browser.
let cached = null;

export function getSupabaseAdmin() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars. See .env.example."
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}
