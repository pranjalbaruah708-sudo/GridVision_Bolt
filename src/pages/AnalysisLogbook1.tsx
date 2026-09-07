import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import LoadEnergyAnalysis from "./analytics/LoadEnergyAnalysis";
import InterruptionAnalysis from "./analytics/InterruptionAnalysis";
import IndicesAnalysis from "./analytics/IndicesAnalysis";
import ScreenExportMenu from "@/components/ScreenExportMenu";
import { DesktopPageContainer } from "@/components/layout/DesktopPageContainer";

export type AnalyticsView = "Load / Energy Analysis" | "Interruption Analysis" | "Indices";

  const tabs: AnalyticsView[] = [
    "Load / Energy Analysis",
    "Interruption Analysis",
    "Indices",
  ];


 export default function AnalysisLogbook1({
  onBack,
  initialTab = "Load / Energy Analysis",
  onTabChange,
}: {
  onBack: () => void;
  initialTab?: AnalyticsView;
  onTabChange?: (tab: AnalyticsView) => void;
}) {
  const exportContentRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<AnalyticsView>(initialTab);
  useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

  return (
    <div
      className="gv-analytics-page"
      style={{
        minHeight: "100vh",
        background: "#EEF3F8",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        .gv-analytics-desktop-subtitle { display: none; }

        @media (min-width: 1024px) {
          .gv-analytics-header {
            padding-left: 0 !important;
            padding-right: 0 !important;
            border-bottom-left-radius: 0 !important;
            border-bottom-right-radius: 0 !important;
            background: #ffffff !important;
            color: #0f172a !important;
            box-shadow: none !important;
            border-bottom: 1px solid #e2e8f0;
          }

          .gv-analytics-header > div > div:first-of-type > button:first-child { display: none; }
          .gv-analytics-header [data-export-exclude] { background: #1d4ed8; color: #ffffff; border-color: #1d4ed8; }

          .gv-analytics-desktop-subtitle {
            display: block;
            color: #64748b !important;
          }

          .gv-analytics-tabs {
            margin-top: 16px !important;
            gap: 8px !important;
            overflow-x: visible !important;
          }

          .gv-analytics-tabs button {
            background: #eff6ff !important;
            color: #1d4ed8 !important;
            border: 1px solid #bfdbfe !important;
            box-shadow: none !important;
          }

          .gv-analytics-tabs button:hover {
            background: #dbeafe !important;
            border-color: #93c5fd !important;
          }

          .gv-analytics-tabs button[aria-pressed="true"] {
            background: #1d4ed8 !important;
            color: #ffffff !important;
            border-color: #1d4ed8 !important;
            box-shadow: 0 2px 5px rgba(30, 64, 175, .2) !important;
          }

          .gv-analytics-body {
            overflow-y: visible !important;
            padding: 24px 0 0 !important;
          }

          .gv-load-energy-root,
          .gv-ia-root,
          .gv-indices-grid {
            padding-bottom: 40px !important;
          }
        }
      `}</style>
      {/* ---------- HEADER ---------- */}

      <div
        className="gv-analytics-header"
        style={{
          background:
            "linear-gradient(135deg,#0D47A1,#1565C0)",
          color: "white",
          padding: "16px",
          paddingTop: "22px",
          borderBottomLeftRadius: "22px",
          borderBottomRightRadius: "22px",
          boxShadow: "0 4px 12px rgba(0,0,0,.18)",
        }}
      >
        <DesktopPageContainer width="wide">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
  
        <button
        onClick={onBack}
  className="rounded-full p-1 transition hover:bg-white/10 active:scale-95"
  aria-label="Back to Module Selection"
>
  <ArrowLeft size={24} />
</button>

          <div style={{ minWidth: 0, textAlign: "center" }}>
            <h2
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              Analytics
            </h2>
            <p className="gv-analytics-desktop-subtitle" style={{ margin: "4px 0 0", fontSize: 12, fontWeight: 500, color: "#DBEAFE" }}>
              Operational performance and reliability insights
            </p>
          </div>

          <ScreenExportMenu
            contentRef={exportContentRef}
            title={`GridVision ${activeTab}`}
          />
        </div>

        {/* ---------- Tabs ---------- */}

        <div
          className="gv-analytics-tabs"
          style={{
            marginTop: 22,
            display: "flex",
            gap: 12,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              aria-pressed={activeTab === tab}
              onClick={() => { setActiveTab(tab); onTabChange?.(tab); }}
              style={{
                border: "none",
                outline: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
                padding: "10px 18px",
                borderRadius: 25,
                fontWeight: 600,
                fontSize: 14,
                transition: ".25s",
                background:
                  activeTab === tab
                    ? "#ffffff"
                    : "rgba(255,255,255,.20)",
                color:
                  activeTab === tab
                    ? "#1565C0"
                    : "#ffffff",
                boxShadow:
                  activeTab === tab
                    ? "0 3px 8px rgba(0,0,0,.15)"
                    : "none",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        </DesktopPageContainer>
      </div>

      {/* ---------- BODY ---------- */}

      <div
        ref={exportContentRef}
        className="gv-analytics-body"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
        }}
      >
        <DesktopPageContainer width="wide">
        {activeTab === "Load / Energy Analysis" && (
          <LoadEnergyAnalysis />
        )}

        {activeTab === "Interruption Analysis" && (
          <InterruptionAnalysis />
        )}

        {activeTab === "Indices" && (
          <IndicesAnalysis />
        )}
        </DesktopPageContainer>
      </div>
    </div>
  );
}
