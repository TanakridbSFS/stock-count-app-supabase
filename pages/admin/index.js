import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import AdminGate from "../../components/AdminGate";

const TABS = [
  { key: "system", label: "System Setting" },
  { key: "round", label: "Count Round Setting" },
  { key: "monitor", label: "Monitor & Report" },
];

function Item({ href, title, children }) {
  return (
    <Link href={href} className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      <div className="card-title">{title} →</div>
      <div className="card-subtext" style={{ marginBottom: 0 }}>
        {children}
      </div>
    </Link>
  );
}

function AdminConsole() {
  const router = useRouter();
  const [tab, setTab] = useState("round");

  // Remember the tab in the URL (?tab=system) so Back returns to the same tab.
  useEffect(() => {
    if (router.isReady && TABS.some((t) => t.key === router.query.tab)) setTab(router.query.tab);
  }, [router.isReady, router.query.tab]);

  function pick(key) {
    setTab(key);
    router.replace({ pathname: "/admin", query: { tab: key } }, undefined, { shallow: true });
  }

  return (
    <div className="page page-admin">
      <div className="admin-header">
        <div className="title">Admin Console</div>
        <nav className="admin-nav">
          <Link href="/">Go to counting app →</Link>
        </nav>
      </div>

      <div className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`admin-tab ${tab === t.key ? "active" : ""}`} onClick={() => pick(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "system" && (
        <>
          <div className="card-subtext">
            One-time setup. Set these once; they are reused by every Stocktake Event.
          </div>
          <div className="admin-grid">
            <Item href="/admin/teams" title="Teams & capabilities">
              Create Team01–Team58, set which Storage Locations and Picking/Reserve each team may count (Count rounds
              only), and print the Team QR codes used to log in on the PDA.
            </Item>
            <Item href="/admin/area-defaults" title="Warehouse Area default tags">
              The standing COUNT / PRECOUNT / EXCLUDED tag of each Warehouse Area. New events start from these.
            </Item>
          </div>
        </>
      )}

      {tab === "round" && (
        <>
          <div className="card-subtext">Done for every stocktake — follow the steps in order.</div>
          <div className="admin-grid">
            <Item href="/admin/events" title="1 · Stocktake Event & area tags">
              Create the event from the Stock export and the Bin Location Master, then check the tag of each Warehouse
              Area (pre-filled from the defaults).
            </Item>
            <Item href="/admin/control" title="2 · Rounds (Pre-Count / Count)">
              Create Pre-Count and Count rounds (Count#1 from the PI Doc file, Count#2+ from SKUs) and make one round per
              lane Active.
            </Item>
            <Item href="/admin/control" title="3 · Assign PI Docs to teams">
              Open a round's PI Docs, see the Warehouse Area of each, and assign them to teams allowed to count that
              area.
            </Item>
          </div>
        </>
      )}

      {tab === "monitor" && (
        <>
          <div className="card-subtext">Watch the count while it runs and export the result.</div>
          <div className="admin-grid">
            <Item href="/admin/progress" title="Progress">
              Team × PI Doc completion for a round. Refreshes every minute.
            </Item>
            <Item href="/admin/tv" title="TV Progress">
              One screen for a TV, no scrolling: who is working on which PI Doc and what is left, plus the Top 5 fastest
              and Top 10 slowest teams by time per bin. Tabs per Storage Location, Light / Dark, refreshes every 30
              seconds.
            </Item>
            <Item href="/admin/timing" title="Timing">
              How long counting takes: time per bin, per PI Doc, per team and per area, bins per hour, for a day or a
              round (for UAT and planning).
            </Item>
            <Item href="/dashboard" title="Live 3D warehouse dashboard (Frozen room)">
              3D view of the Frozen room (racks FA–FJ) coloured by count status for the round you pick. Hover a bin to
              see its Warehouse Area, PI Doc and team.
            </Item>
            <Item href="/admin/report" title="Consolidated report">
              Latest round wins per Bin + Mat + Batch + Inventory Status. Choose Count, Pre-Count or both; CSV and SAP file download.
            </Item>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminConsolePage() {
  return (
    <AdminGate>
      <AdminConsole />
    </AdminGate>
  );
}
