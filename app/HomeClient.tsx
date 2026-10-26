"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { QualityId, SceneId, TimeId, VehicleId, WeatherId } from "@/lib/gameConfig";
import { makeMissionSeed } from "@/lib/seededRandom";
import type { GameSession } from '@/lib/practiceConfig';

const PitGame = dynamic(() => import("@/components/game/PitGameV2").then((module) => module.PitGameV2), { ssr: false });
const PracticeGame = dynamic(() => import('@/components/game/PracticeGame').then(m=>m.PracticeGame), {ssr:false});

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

export function HomeClient() {
  const [scene, setScene] = useState<SceneId>("highway");
  const [weather, setWeather] = useState<WeatherId>("rain");
  const [time, setTime] = useState<TimeId>("night");
  const [vehicle, setVehicle] = useState<VehicleId>("patrol");
  const [quality, setQuality] = useState<QualityId>("high");
  const [seed, setSeed] = useState(() => makeMissionSeed());
  const [mode,setMode]=useState<'mission'|'practice'>('mission');
  const [mission, setMission] = useState<GameSession | null>(null);

  if (mission?.mode==='mission') return <PitGame config={mission.config} onExit={() => setMission(null)} />;
  if (mission?.mode==='practice') return <PracticeGame config={mission.config} onExit={()=>setMission(null)}/>;

  return (
    <main className={`briefing briefing--${scene} briefing--${mode==='practice'?'day':time} briefing--${mode==='practice'?'clear':weather}`}>
      <div className="scene-preview" aria-hidden="true">
        <div className="sky-glow" /><div className="cityline cityline--back" /><div className="cityline cityline--front" />
        {scene === "country" && <div className="countryline"><i /><i /><i /><i /><i /></div>}
        {scene === "highway" && <div className="highway-sign"><span>INTERSTATE</span><b>95</b></div>}
        <div className="road"><span className="lane lane--left" /><span className="lane lane--right" /></div>
        <div className="suspect-car"><span /></div>
        <div className="police-car"><span className="light light--red" /><span className="light light--blue" /></div>
        {mode==='mission'&&weather === "rain" && <div className="rain" />}{mode==='mission'&&weather === "snow" && <div className="snow" />}<div className="scanlines" />
      </div>
      <header className="topbar">
        <div className="brand-mark"><span>PIT</span> UNIT</div><div className="status"><i /> DISPATCH CONNECTED</div>
        <div className="case-number">CASE 24-781<br /><strong>PRIORITY ONE</strong></div>
      </header>
      <section className="hero-copy">
        <p className="eyebrow">TACTICAL INTERVENTION SIMULATOR</p><h1>終止<br /><em>追逐。</em></h1>
        <p className="lede">{mode==='mission'?'選擇你的單位與作戰環境，在限時追逐中評估 PIT 與攔停結果。':'在封閉空地反覆練習，觀察實際接觸與失控條件。沒有倒數，按開始後才會行駛。'}</p>
      </section>
      <section className="setup-panel" aria-label="追逐任務設定">
        <div className="panel-heading"><span>MISSION CONFIGURATION</span><strong>任務設定</strong></div>
        <fieldset><legend>模式</legend><div className="segmented"><button aria-pressed={mode==='mission'} className={mode==='mission'?'active':''} onClick={()=>setMode('mission')}>一般任務</button><button className={mode==='practice'?'active':''} aria-pressed={mode==='practice'} onClick={()=>setMode('practice')}>PIT 練習</button></div><small>{mode==='mission'?'V2 任務：90 秒追捕，玩家與兩台後援；PIT 與攔停分開評估。':'基本練習場：晴朗／白天，兩車 50 km/h，無後援、無倒數。'}</small></fieldset>
        {mode==='mission'&&<>
        <fieldset><legend><b>01</b> 作戰區域</legend><div className="option-grid option-grid--three">
          {scenes.map((item) => <button key={item.id} className={scene === item.id ? "option active" : "option"} onClick={() => setScene(item.id as SceneId)}><span className="option-code">{item.icon}</span><strong>{item.label}</strong><small>{item.detail}</small></button>)}
        </div></fieldset>
        <div className="split-fields">
          <fieldset><legend><b>02</b> 時段</legend><div className="segmented"><button className={time === "day" ? "active" : ""} onClick={() => setTime("day")}>白天</button><button className={time === "night" ? "active" : ""} onClick={() => setTime("night")}>黑夜</button></div></fieldset>
          <fieldset><legend><b>03</b> 天候</legend><select value={weather} onChange={(event) => setWeather(event.target.value as WeatherId)} aria-label="選擇天候">{weathers.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.detail}</option>)}</select></fieldset>
        </div>
        </>}
        <fieldset><legend><b>04</b> 選擇攔截單位</legend><div className="option-grid option-grid--vehicles">
          {vehicles.map((item) => <button key={item.id} className={vehicle === item.id ? "vehicle-option active" : "vehicle-option"} onClick={() => setVehicle(item.id as VehicleId)}><span className="vehicle-silhouette">{item.stat}</span><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>)}
        </div></fieldset>
        {mode==='mission'&&<fieldset className="seed-field"><legend><b>05</b> 任務地圖代碼</legend><div><input value={seed} maxLength={32} onChange={(event) => setSeed(event.target.value.toUpperCase())} aria-label="任務地圖代碼" /><button type="button" onClick={() => setSeed(makeMissionSeed())}>隨機</button></div><small>相同代碼會重現相同道路排列</small></fieldset>}
        <fieldset className="quality-field"><legend><b>06</b> 畫面品質</legend><div className="segmented segmented--three">{(["low", "medium", "high"] as QualityId[]).map((value) => <button key={value} className={quality === value ? "active" : ""} onClick={() => setQuality(value)}>{value === "low" ? "低" : value === "medium" ? "中" : "高"}</button>)}</div><small>低畫質會關閉側鏡與即時陰影</small></fieldset>
        <button className="deploy-button" type="button" onClick={() => setMission(mode==='mission'?{mode,config:{ scene, weather, time, vehicle, quality, seed: seed.trim() || makeMissionSeed() }}:{mode,config:{vehicle,quality}})}><span>{mode==='mission'?'部署攔截單位':'進入練習場'}</span><small>ENTER TO DEPLOY</small><b>→</b></button>
        <p className="controls-hint"><kbd>↑</kbd><kbd>↓</kbd> 油門 / 煞車 · <kbd>←</kbd><kbd>→</kbd> 轉向 · {mode==='mission'?<><kbd>C</kbd> 視角 · <kbd>Q</kbd> 無線電</>:<><kbd>F</kbd> 巡航 · <kbd>P</kbd> 暫停</>}</p>
      </section>
      <footer><span>PRECISION IMMOBILIZATION TRAINING SYSTEM</span><span>BUILD 0.2 // TRAINING USE</span></footer>
    </main>
  );
}
