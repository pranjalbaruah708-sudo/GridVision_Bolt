import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
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

const interruptionDuration = [
  { day: "24 Jul", value: 38 },
  { day: "25 Jul", value: 42 },
  { day: "26 Jul", value: 27 },
  { day: "27 Jul", value: 61 },
  { day: "28 Jul", value: 55 },
  { day: "29 Jul", value: 34 },
  { day: "30 Jul", value: 29 },
];

const interruptionCount = [
  { day: "24 Jul", value: 8 },
  { day: "25 Jul", value: 10 },
  { day: "26 Jul", value: 6 },
  { day: "27 Jul", value: 12 },
  { day: "28 Jul", value: 9 },
  { day: "29 Jul", value: 5 },
  { day: "30 Jul", value: 7 },
];

const causeData = [
  { name: "Equipment Failure", value: 38 },
  { name: "Maintenance", value: 22 },
  { name: "Weather", value: 18 },
  { name: "Tree Fault", value: 12 },
  { name: "Others", value: 10 },
];

const COLORS = [
  "#1976D2",
  "#43A047",
  "#FB8C00",
  "#E53935",
  "#8E24AA",
];

export default function InterruptionAnalysis() {
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
          CARD 1
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
          Interruption Duration (Minutes)
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
            <BarChart data={interruptionDuration}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="value"
                fill="#1976D2"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* =========================
          CARD 2
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
          Number of Interruptions
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
            <BarChart data={interruptionCount}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Bar
                dataKey="value"
                fill="#F57C00"
                radius={[8, 8, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* =========================
          CARD 3
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
          Cause-wise Interruptions
        </h3>

        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={causeData}
                dataKey="value"
                nameKey="name"
                outerRadius={95}
                label
              >
                {causeData.map((entry, index) => (
                  <Cell
                    key={entry.name}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>

              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}