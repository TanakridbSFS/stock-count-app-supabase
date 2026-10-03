import { useEffect } from "react";
import { useRouter } from "next/router";

// Old Run Setup — replaced by Stocktake Events (REQUIREMENTS_v2).
export default function RunsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/events");
  }, [router]);
  return null;
}
