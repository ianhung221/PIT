"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { MissionConfig, SceneId, TimeId, VehicleId, WeatherId } from "@/lib/gameConfig";

const PitGame = dynamic(() => import("@/components/game/PitGame").then((module) => module.PitGame), { ssr: false });

const scenes = [
  { id: "city", label: "城市街區", icon: "CITY", detail: "急彎 · 狹窄路幅" },
  { id: "country", label: "鄉間公路", icon: "RURAL", detail: "長彎 · 雙向道路" },
  { id: "highway", label: "州際高速", icon: "I-95", detail: "高速 · 寬闊車道" },
];

const weathers = [
  { id: "clear", label: "晴朗", detail: "抓地力 100%" },
  { id: "rain", label: "暴雨", detail: "抓地力 78%" },
  { id: "snow", label: "降雪", detail: "抓地力 58%" },
];

const vehicles = [
  { id: "patrol", label: "巡邏轎車", detail: "均衡操控", stat: "A" },
  { id: "interceptor", label: "攔截跑車", detail: "極速優先", stat: "S" },
  { id: "suv", label: "警用 SUV", detail: "重量穩定", stat: "B" },
];

export default function Home() {
  const [scene, setScene] = useState<SceneId>("highway");
  const [weather, setWeather] = useState<WeatherId>("rain");
  const [time, setTime] = useState<TimeId>("night");
  const [vehicle, setVehicle] = useState<VehicleId>("patrol");
  const [mission, setMission] = useState<MissionConfig | null>(null);

  if (mission) return <PitGame config={mission} onExit={() => setMission(null)} />;

  return (
    <main className={`briefing briefing--${time} briefing--${weather}`}>
      <div className="scene-preview" aria-hidden="true">
        <div className="sky-glow" /><div className="cityline cityline--back" /><div className="cityline cityline--front" />
        <div className="road"><span className="lane lane--left" /><span className="lane lane--right" /></div>
        <div className="suspect-car"><span /></div>
        <div className="police-car"><span className="light light--red" /><span className="light light--blue" /></div>
        {weather === "rain" && <div className="rain" />}{weather === "snow" && <div className="snow" />}<div className="scanlines" />
      </div>
      <header className="topbar">
        <div className="brand-mark"><span>PIT</span> UNIT</div><div className="status"><i /> DISPATCH CONNECTED</div>
        <div className="case-number">CASE 24-781<br /><strong>PRIORITY ONE</strong></div>
      </header>
      <section className="hero-copy">
        <p className="eyebrow">TACTICAL INTERVENTION SIMULATOR</p><h1>終止<br /><em>追逐。</em></h1>
        <p className="lede">高速攔截，精準出手。選擇你的單位與作戰環境，使用 PIT 技術在時間歸零前制伏嫌犯。</p>
      </section>
      <section className="setup-panel" aria-label="追逐任務設定">
        <div className="panel-heading"><span>MISSION CONFIGURATION</span><strong>任務設定</strong></div>
        <fieldset><legend><b>01</b> 作戰區域</legend><div className="option-grid option-grid--three">
          {scenes.map((item) => <button key={item.id} className={scene === item.id ? "option active" : "option"} onClick={() => setScene(item.id as SceneId)}><span className="option-code">{item.icon}</span><strong>{item.label}</strong><small>{item.detail}</small></button>)}
        </div></fieldset>
        <div className="split-fields">
          <fieldset><legend><b>02</b> 時段</legend><div className="segmented"><button className={time === "day" ? "active" : ""} onClick={() => setTime("day")}>白天</button><button className={time === "night" ? "active" : ""} onClick={() => setTime("night")}>黑夜</button></div></fieldset>
          <fieldset><legend><b>03</b> 天候</legend><select value={weather} onChange={(event) => setWeather(event.target.value as WeatherId)} aria-label="選擇天候">{weathers.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.detail}</option>)}</select></fieldset>
        </div>
        <fieldset><legend><b>04</b> 選擇攔截單位</legend><div className="option-grid option-grid--vehicles">
          {vehicles.map((item) => <button key={item.id} className={vehicle === item.id ? "vehicle-option active" : "vehicle-option"} onClick={() => setVehicle(item.id as VehicleId)}><span className="vehicle-silhouette">{item.stat}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}
        </div></fieldset>
        <button className="deploy-button" type="button" onClick={() => setMission({ scene, weather, time, vehicle })}><span>部署攔截單位</span><small>ENTER TO DEPLOY</small><b>→</b></button>
        <p className="controls-hint"><kbd>↑</kbd><kbd>↓</kbd> 油門 / 煞車 · <kbd>←</kbd><kbd>→</kbd> 轉向 · <kbd>C</kbd> 切換視角</p>
      </section>
      <footer><span>PRECISION IMMOBILIZATION TRAINING SYSTEM</span><span>BUILD 0.1 // AUTHORIZED USE ONLY</span></footer>
    </main>
  );
}
