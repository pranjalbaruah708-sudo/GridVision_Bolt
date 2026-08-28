import { useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import LoadEnergyAnalysis from "./analytics/LoadEnergyAnalysis";
import InterruptionAnalysis from "./analytics/InterruptionAnalysis";
import IndicesAnalysis from "./analytics/IndicesAnalysis";
import ScreenExportMenu from "@/components/ScreenExportMenu";

  const tabs = [
    "Load / Energy Analysis",
    "Interruption Analysis",
    "Indices",
  ];


 export default function AnalysisLogbook1({
  onBack,
}: {
  onBack: () => void;
}) {
  const exportContentRef = useRef<HTMLDivElement>(null);

  console.log("******** AnalysisLogbook2 Loaded ********");

  const [activeTab, setActiveTab] = useState(
    "Load / Energy Analysis"
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#EEF3F8",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ---------- HEADER ---------- */}

      <div
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

          <h2
            style={{
              margin: 0,
              fontSize: 24,
              fontWeight: 700,
            }}
          >
            Analytics
          </h2>

          <ScreenExportMenu
            contentRef={exportContentRef}
            title={`GridVision ${activeTab}`}
          />
        </div>

        {/* ---------- Tabs ---------- */}

        <div
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
              onClick={() => setActiveTab(tab)}
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
      </div>

      {/* ---------- BODY ---------- */}

      <div
        ref={exportContentRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 16,
        }}
      >
        {activeTab === "Load / Energy Analysis" && (
          <LoadEnergyAnalysis />
        )}

        {activeTab === "Interruption Analysis" && (
          <InterruptionAnalysis />
        )}

        {activeTab === "Indices" && (
          <IndicesAnalysis />
        )}
      </div>
    </div>
  );
}
