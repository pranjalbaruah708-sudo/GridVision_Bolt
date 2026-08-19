import { useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const stations = [
  "132/33 KV Sarusajai GSS",
  "132/33 KV Sonapur GSS",
  "132/33 KV Jalukbari GSS",
  "132/33 KV Six Mile GSS",
];

const feederMap: Record<string, string[]> = {
  "132/33 KV Sarusajai GSS": [
    "33 KV Feeder-1",
    "33 KV Feeder-2",
    "33 KV Feeder-3",
  ],

  "132/33 KV Sonapur GSS": [
    "Town Feeder",
    "Industrial Feeder",
    "Airport Feeder",
  ],

  "132/33 KV Jalukbari GSS": [
    "Feeder-A",
    "Feeder-B",
  ],

  "132/33 KV Six Mile GSS": [
    "VIP Feeder",
    "GS Road Feeder",
    "Medical Feeder",
  ],
};

const periods = [
  "Last 7 Days",
  "Last 15 Days",
  "Last 30 Days",
  "Last 3 Months",
];

const utilityData = [
  { day: "24 Jul", value: 3200 },
  { day: "25 Jul", value: 3370 },
  { day: "26 Jul", value: 3410 },
  { day: "27 Jul", value: 3560 },
  { day: "28 Jul", value: 3620 },
  { day: "29 Jul", value: 3550 },
  { day: "30 Jul", value: 3700 },
];

const stationData = [
  { day: "24 Jul", value: 1180 },
  { day: "25 Jul", value: 1215 },
  { day: "26 Jul", value: 1280 },
  { day: "27 Jul", value: 1330 },
  { day: "28 Jul", value: 1410 },
  { day: "29 Jul", value: 1390 },
  { day: "30 Jul", value: 1450 },
];


const feederData = [
  { day: "24 Jul", value: 120 },
  { day: "25 Jul", value: 132 },
  { day: "26 Jul", value: 140 },
  { day: "27 Jul", value: 149 },
  { day: "28 Jul", value: 155 },
  { day: "29 Jul", value: 151 },
  { day: "30 Jul", value: 160 },
];

const stationDataMap: Record<string, typeof stationData> = {};

stations.forEach((station) => {
  stationDataMap[station] = stationData;
});

const feederDataMap: Record<string, typeof feederData> = {};

Object.values(feederMap).forEach((feeders) => {
  feeders.forEach((feeder) => {
    feederDataMap[feeder] = feederData;
  });
});

export default function LoadEnergyAnalysis() {
const [selectedStation, setSelectedStation] = useState(stations[0]);

const [selectedFeeder, setSelectedFeeder] = useState(
  feederMap[stations[0]][0]
);

  const [utilityPeriod, setUtilityPeriod] = useState(periods[0]);
  const [stationPeriod, setStationPeriod] = useState(periods[0]);
  const [feederPeriod, setFeederPeriod] = useState(periods[0]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {/* =========================
          CARD 1
      ========================== */}

      <div
        style={{
          background: "#ffffff",
          borderRadius: 18,
          padding: 18,
          boxShadow: "0 4px 12px rgba(0,0,0,.08)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: "#1E293B",
            }}
          >
            Utility Peak Demand
          </h3>

          <select
            value={utilityPeriod}
            onChange={(e) => setUtilityPeriod(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #D1D5DB",
              fontSize: 14,
              background: "#fff",
            }}
          >
            {periods.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>

        {/* Chart Placeholder */}

      <div style={{ height: 260 }}>
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={utilityData}>
      <CartesianGrid strokeDasharray="3 3" />

      <XAxis dataKey="day" />

      <YAxis />

      <Tooltip />

      <Bar
        dataKey="value"
        fill="#1565C0"
        radius={[8, 8, 0, 0]}
      />
    </BarChart>
  </ResponsiveContainer>
</div>
      </div>
            {/* =========================
          CARD 2
      ========================== */}

      <div
        style={{
          background: "#ffffff",
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
            color: "#1E293B",
          }}
        >
          Station-wise Peak Demand
        </h3>

       <div
  style={{
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  }}
>

  <select
    value={selectedStation}
    onChange={(e) => {
      const station = e.target.value;
      setSelectedStation(station);
      setSelectedFeeder(feederMap[station][0]);
    }}
    style={{
      flex: "1 1 320px",
      minWidth: 220,
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid #D1D5DB",
      background: "#fff",
      fontSize: 14,
    }}
  >
    {stations.map((station) => (
      <option key={station}>{station}</option>
    ))}
  </select>

  <select
    value={stationPeriod}
    onChange={(e) => setStationPeriod(e.target.value)}
    style={{
      flex: "0 1 170px",
      minWidth: 150,
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid #D1D5DB",
      background: "#fff",
      fontSize: 14,
    }}
  >
    {periods.map((period) => (
      <option key={period}>
        {period}
      </option>
    ))}
  </select>

</div>

        {/* Chart Placeholder */}

<div
  style={{
    height: 260,
    width: "100%",
  }}
>
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={stationDataMap[selectedStation]}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="day" />
      <YAxis />
      <Tooltip />
      <Bar
        dataKey="value"
        fill="#2E7D32"
        radius={[8, 8, 0, 0]}
      />
    </BarChart>
  </ResponsiveContainer>
</div>
      </div>

      {/* =========================
          CARD 3
      ========================== */}

      <div
        style={{
          background: "#ffffff",
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
            color: "#1E293B",
          }}
        >
          Feeder-wise Peak Demand
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
    onChange={(e) => {
      const station = e.target.value;
      setSelectedStation(station);
      setSelectedFeeder(feederMap[station][0]);
    }}
    style={{
      flex: "1 1 260px",
      minWidth: 180,
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid #D1D5DB",
      background: "#fff",
      fontSize: 14,
    }}
  >
    {stations.map((station) => (
      <option key={station}>{station}</option>
    ))}
  </select>

 <select
    value={selectedFeeder}
    onChange={(e) => setSelectedFeeder(e.target.value)}
    style={{
      flex: "1 1 220px",
      minWidth: 170,
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid #D1D5DB",
      background: "#fff",
      fontSize: 14,
    }}
  >
    {feederMap[selectedStation].map((feeder) => (
      <option
        key={feeder}
        value={feeder}
      >
        {feeder}
      </option>
    ))}
  </select>

<select
    value={feederPeriod}
    onChange={(e) => setFeederPeriod(e.target.value)}
    style={{
      flex: "0 1 170px",
      minWidth: 150,
      padding: "9px 12px",
      borderRadius: 8,
      border: "1px solid #D1D5DB",
      background: "#fff",
      fontSize: 14,
    }}
  >
    {periods.map((period) => (
      <option key={period}>
        {period}
      </option>
    ))}
  </select>
        </div>

        {/* Chart Placeholder */}

<div
  style={{
    height: 260,
    width: "100%",
  }}
>
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={feederDataMap[selectedFeeder]}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="day" />
      <YAxis />
      <Tooltip />
      <Bar
        dataKey="value"
        fill="#EF6C00"
        radius={[8, 8, 0, 0]}
      />
    </BarChart>
  </ResponsiveContainer>
</div>
      </div>
    </div>
  );
}