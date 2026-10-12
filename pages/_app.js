import "../styles/globals.css";
import { useRouter } from "next/router";
import { SpeedInsights } from "@vercel/speed-insights/next";
import VersionTag from "../components/VersionTag";

// The TV page fills the whole screen and shows the version in its own header line.
const NO_TAG = new Set(["/admin/tv"]);

export default function App({ Component, pageProps }) {
  const { pathname } = useRouter();
  return (
    <>
      <Component {...pageProps} />
      {!NO_TAG.has(pathname) && <VersionTag />}
      <SpeedInsights />
    </>
  );
}
