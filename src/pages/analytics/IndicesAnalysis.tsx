import { useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const stations = [
  "All Stations",
  "Guwahati GSS",
  "Jorhat GSS",
  "Tezpur GSS",
  "Silchar GSS",
];

const periods = [
  "7 Days",
  "15 Days",
  "30 Days",
  "3 Months",
];

const saidiData = [
  { day: "24 Jul", value: 0.72 },
  { day: "25 Jul", value: 0.81 },
  { day: "26 Jul", value: 0.66 },
  { day: "27 Jul", value: 0.93 },
  { day: "28 Jul", value: 0.84 },
  { day: "29 Jul", value: 0.62 },
  { day: "30 Jul", value: 0.58 },
];

const saifiData = [
  { day: "24 Jul", value: 0.31 },
  { day: "25 Jul", value: 0.42 },
  { day: "26 Jul", value: 0.28 },
  { day: "27 Jul", value: 0.47 },
  { day: "28 Jul", value: 0.39 },
  { day: "29 Jul", value: 0.30 },
  { day: "30 Jul", value: 0.24 },
];

export default function IndicesAnalysis() {
  const [selectedStation, setSelectedStation] = useState(stations[0]);
  const [selectedPeriod, setSelectedPeriod] = useState(periods[0]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      {/* =========================
          CARD 1 : SAIDI
      ========================= */}

      <div
        style={{
          background: "#fff",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 4px 12px rgba(0,0,0,.08)",
        }}
      >
        <h3
          style={{
            margin: "0 0 18px 0",
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          SAIDI (System Average Interruption Duration Index)
        </h3>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 18,
            flexWrap: "wrap",
          }}
        >
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            {stations.map((station) => (
              <option key={station}>{station}</option>
            ))}
          </select>

          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            style={{
              width: 150,
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            {periods.map((period) => (
              <option key={period}>{period}</option>
            ))}
          </select>
        </div>

        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={saidiData}>
              <defs>
                <linearGradient id="saidiFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1976D2" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#1976D2" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" />

              <XAxis dataKey="day" />

              <YAxis />

              <Tooltip />

              <Area
                type="monotone"
                dataKey="value"
                stroke="#1976D2"
                fill="url(#saidiFill)"
                strokeWidth={3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* =========================
          CARD 2 : SAIFI
      ========================= */}

      <div
        style={{
          background: "#fff",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 4px 12px rgba(0,0,0,.08)",
        }}
      >
        <h3
          style={{
            margin: "0 0 18px 0",
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          SAIFI (System Average Interruption Frequency Index)
        </h3>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 18,
            flexWrap: "wrap",
          }}
        >
          <select
            value={selectedStation}
            onChange={(e) => setSelectedStation(e.target.value)}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            {stations.map((station) => (
              <option key={station}>{station}</option>
            ))}
          </select>

          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            style={{
              width: 150,
              padding: "8px 12px",
              borderRadius: 8,
            }}
          >
            {periods.map((period) => (
              <option key={period}>{period}</option>
            ))}
          </select>
        </div>

        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={saifiData}>
              <defs>
                <linearGradient id="saifiFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#43A047" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#43A047" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" />

              <XAxis dataKey="day" />

              <YAxis />

              <Tooltip />

              <Area
                type="monotone"
                dataKey="value"
                stroke="#43A047"
                fill="url(#saifiFill)"
                strokeWidth={3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}