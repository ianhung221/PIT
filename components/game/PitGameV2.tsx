"use client";
/* eslint-disable react/no-unknown-property -- React Three Fiber uses Three.js JSX properties. */

import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useCallback, useEffect, useRef, useState } from "react";
import { CameraRig } from "@/components/game/CameraRig";
import { CockpitView } from "@/components/game/CockpitView";
import { ProceduralWorld } from "@/components/game/ProceduralWorld";
import { RadioCommandWheel } from "@/components/game/RadioCommandWheel";
import { V2VehicleSimulation, type V2HudData } from "@/components/game/V2VehicleSimulation";
import { V2Weather } from "@/components/game/V2Weather";
import { VehicleMirrors } from "@/components/game/VehicleMirrors";
import { logRuntimeEvent, makeV2Runtime, type V2Result, type V2Runtime } from "@/components/game/v2Runtime";
import { CAMERA_LABELS, CAMERA_SETTINGS, QUALITY_SETTINGS, SCENES, VEHICLES, WEATHER, type CameraMode, type MissionConfig } from "@/lib/gameConfig";
import { evaluatePitRisk } from "@/lib/pitPolicy";
import { coordinatePursuit } from "@/lib/pursuitCoordinator";
import { vehicleDriveability } from "@/lib/vehicleDamage";
import type { MissionOutcome, RadioCommand } from "@/types/game";

const CAMERA_ORDER: CameraMode[] = ["chase", "driver", "auto"];
const OUTCOME_COPY: Record<MissionOutcome, { eyebrow: string; title: string; detail: string }> = {
  playing: { eyebrow: "PURSUIT ACTIVE", title: "追捕進行中", detail: "維持主追位置並等待安全 PIT 條件。" },
  contained: { eyebrow: "VEHICLE CONTAINED", title: "包圍成功", detail: "後援單位已封鎖嫌犯車頭與後方，嫌犯無法繼續逃逸。" },
  disabled: { eyebrow: "VEHICLE DISABLED", title: "車輛失能", detail: "有效 PIT 與碰撞損傷使嫌犯車失去安全行駛能力。" },
  "stopped-mobile": { eyebrow: "TEMPORARY STOP", title: "暫時停車", detail: "嫌犯車仍可駕駛，後援必須完成包圍。" },
  recovered: { eyebrow: "RECOVERED", title: "恢復追捕", detail: "嫌犯已從碰撞中恢復並繼續逃逸。" },
  "escaped-containment": { eyebrow: "CONTAINMENT FAILED", title: "包圍失敗", detail: "嫌犯車仍可行駛並突破封鎖。" },
  "unsafe-pit": { eyebrow: "POLICY VIOLATION", title: "未授權接觸", detail: "本次接觸不符合授權或安全條件，不列入有效 PIT。" },
  failed: { eyebrow: "TARGET ESCAPED", title: "攔截失敗", detail: "任務時限已結束，請檢視決策紀錄後再試一次。" },
  paused: { eyebrow: "OPERATION PAUSED", title: "任務暫停", detail: "準備好後繼續追逐。" },
};

function useControls(onCamera: () => void, onPause: () => void) {
  const keys = useRef(new Set<string>());
  useEffect(() => {
    const clear = () => keys.current.clear();
    const down = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
      const key = event.key.toLowerCase();
      if (!event.repeat && key === "c") onCamera();
      if (!event.repeat && (key === "escape" || key === "p")) onPause();
      keys.current.add(key);
    };
    const up = (event: KeyboardEvent) => keys.current.delete(event.key.toLowerCase());
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [onCamera, onPause]);
  return keys;
}

function ChaseScene({ config, runtime, keys, cameraMode, paused, roadIndex, onUpdate, onFinish }: {
  config: MissionConfig;
  runtime: React.MutableRefObject<V2Runtime>;
  keys: React.MutableRefObject<Set<string>>;
  cameraMode: CameraMode;
  paused: boolean;
  roadIndex: number;
  onUpdate: (data: V2HudData) => void;
  onFinish: (data: { result: "success" | "failed"; outcome: MissionOutcome }) => void;
}) {
  const fogColor = config.time === "night" ? SCENES[config.scene].fogNight : SCENES[config.scene].fogDay;
  return <>
    <color attach="background" args={[fogColor]} />
    <fog attach="fog" args={[fogColor, 35 * WEATHER[config.weather].visibility, 230 * WEATHER[config.weather].visibility]} />
    <ambientLight intensity={config.time === "night" ? .3 : 1.2} />
    <directionalLight castShadow position={[15, 28, 10]} intensity={config.time === "night" ? .42 : 2.1} color={config.time === "night" ? "#85a7d9" : "#fff1cc"} />
    <Physics gravity={[0, 0, 0]} timeStep={1 / 60} maxCcdSubsteps={4} numSolverIterations={8} paused={paused}>
      <ProceduralWorld road={runtime.current.road} config={config} activeIndex={roadIndex} />
      <V2VehicleSimulation config={config} cameraMode={cameraMode} runtime={runtime} keys={keys} onUpdate={onUpdate} onFinish={onFinish} />
    </Physics>
    <V2Weather config={config} runtime={runtime} />
    <CameraRig runtime={runtime} mode={cameraMode} keys={keys} />
    <CockpitView mode={cameraMode} steering={keys} />
    <VehicleMirrors runtime={runtime} mode={cameraMode} quality={config.quality} />
  </>;
}

export function PitGameV2({ config, onExit }: { config: MissionConfig; onExit: () => void }) {
  const runtime = useRef<V2Runtime>(makeV2Runtime(config));
  const [runId, setRunId] = useState(0);
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");
  const [result, setResult] = useState<V2Result>("playing");
  const [outcome, setOutcome] = useState<MissionOutcome>("playing");
  const [hud, setHud] = useState<V2HudData>(() => ({
    speed: 0,
    distance: 32,
    targetBearing: 0,
    pit: 0,
    suspectDriveability: 1,
    playerDriveability: 1,
    biome: config.scene,
    roadIndex: 0,
    authorization: "unknown",
    authorizationReason: "按住 Q，選擇「請求 PIT 授權」",
    assignments: coordinatePursuit({ pitQualified: false, suspectStopped: false, suspectDriveable: true, playerDriveability: 1 }),
  }));
  const [time, setTime] = useState(90);
  const [policy, setPolicy] = useState<{ authorization: V2Runtime["authorization"]; reason: string }>({ authorization: "unknown", reason: "按住 Q，選擇「請求 PIT 授權」" });
  const [debrief, setDebrief] = useState({ attempts: 0, successfulContacts: 0, unsafeContacts: 0, suspectDriveability: 1, events: [] as string[] });
  const cycleCamera = useCallback(() => setCameraMode((current) => CAMERA_ORDER[(CAMERA_ORDER.indexOf(current) + 1) % CAMERA_ORDER.length]), []);
  const togglePause = useCallback(() => setResult((current) => {
    if (current === "success" || current === "failed") return current;
    const next = current === "paused" ? "playing" : "paused";
    runtime.current.result = next;
    runtime.current.outcome = next === "paused" ? "paused" : "playing";
    return next;
  }), []);
  const keys = useControls(cycleCamera, togglePause);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(Math.max(0, 90 - runtime.current.elapsed)), 100);
    return () => window.clearInterval(timer);
  }, []);

  const handleRadio = useCallback((command: RadioCommand) => {
    const state = runtime.current;
    state.command = command;
    if (command === "request-pit") {
      const segment = state.road.segments[state.suspectRoadIndex];
      const trafficDensity = segment.biome === "city" ? .58 : segment.biome === "highway" ? .38 : .16;
      const decision = evaluatePitRisk({
        speedKph: Math.abs(state.suspect.speed) * 3.6,
        weatherGrip: WEATHER[config.weather].grip,
        visibility: WEATHER[config.weather].visibility,
        roadRisk: segment.risk,
        trafficDensity,
        obstacleRisk: segment.biome === "city" ? .5 : .2,
        offenseSeverity: .86,
        supportUnits: 2,
        targetClass: "car",
      });
      state.authorization = decision.authorization;
      state.authorizationReason = decision.reasons.join("、");
      logRuntimeEvent(state, "指揮中心：" + decision.authorization.toUpperCase() + " — " + state.authorizationReason);
      setPolicy({ authorization: state.authorization, reason: state.authorizationReason });
    } else if (command === "terminate") {
      state.authorization = "terminate";
      state.authorizationReason = "玩家依公共安全風險主動終止追逐";
      state.result = "failed";
      state.outcome = "failed";
      logRuntimeEvent(state, "玩家下令終止追逐");
      setPolicy({ authorization: state.authorization, reason: state.authorizationReason });
      setDebrief({
        attempts: state.attempts,
        successfulContacts: state.successfulContacts,
        unsafeContacts: state.unsafeContacts,
        suspectDriveability: vehicleDriveability(state.suspectDamage),
        events: [...state.eventLog],
      });
      setOutcome("failed");
      setResult("failed");
    } else {
      const labels: Record<Exclude<RadioCommand, "request-pit" | "terminate">, string> = {
        "prepare-pit": "後援保持距離，準備 PIT",
        "move-up": "第二單位正在靠近",
        "block-front": "後援準備封鎖嫌犯車頭",
        "take-primary": "第二單位接替主追位置",
      };
      logRuntimeEvent(state, labels[command]);
    }
  }, [config.weather]);

  const restart = () => {
    keys.current.clear();
    runtime.current = makeV2Runtime(config);
    setHud({
      speed: 0,
      distance: 32,
      targetBearing: 0,
      pit: 0,
      suspectDriveability: 1,
      playerDriveability: 1,
      biome: config.scene,
      roadIndex: 0,
      authorization: "unknown",
      authorizationReason: "按住 Q，選擇「請求 PIT 授權」",
      assignments: coordinatePursuit({ pitQualified: false, suspectStopped: false, suspectDriveable: true, playerDriveability: 1 }),
    });
    setTime(90);
    setCameraMode("chase");
    setOutcome("playing");
    setResult("playing");
    setPolicy({ authorization: "unknown", reason: "按住 Q，選擇「請求 PIT 授權」" });
    setDebrief({ attempts: 0, successfulContacts: 0, unsafeContacts: 0, suspectDriveability: 1, events: [] });
    setRunId((value) => value + 1);
  };

  const authorization = policy.authorization;
  const quality = QUALITY_SETTINGS[config.quality ?? "high"];
  const resultCopy = OUTCOME_COPY[result === "paused" ? "paused" : outcome];
  const policyClass = authorization === "authorized" ? "authorized" : authorization === "unknown" ? "unknown" : "restricted";
  const mapCode = config.scene.toUpperCase() + "-" + (config.seed?.trim() || "PIT-TRAINING");

  return <main className="game-shell">
    <Canvas shadows={config.quality !== "low"} camera={{ fov: 56, near: .1, far: 430 }} dpr={quality.dpr} gl={{ antialias: config.quality !== "low" }}>
      <ChaseScene
        key={runId}
        config={config}
        runtime={runtime}
        keys={keys}
        cameraMode={cameraMode}
        paused={result !== "playing"}
        roadIndex={hud.roadIndex}
        onUpdate={(data) => {
          setHud(data);
          setPolicy({ authorization: data.authorization, reason: data.authorizationReason });
        }}
        onFinish={(data) => {
          const state = runtime.current;
          setDebrief({
            attempts: state.attempts,
            successfulContacts: state.successfulContacts,
            unsafeContacts: state.unsafeContacts,
            suspectDriveability: vehicleDriveability(state.suspectDamage),
            events: [...state.eventLog],
          });
          setOutcome(data.outcome);
          setResult(data.result);
        }}
      />
    </Canvas>
    <div className="game-vignette" />
    <header className="game-top">
      <div className="game-logo"><b>PIT</b> UNIT V2</div>
      <div className="objective"><small>TRAINING OBJECTIVE</small><strong>取得授權、執行有效 PIT、完成包圍</strong></div>
      <button onClick={togglePause} aria-label="暫停遊戲">Ⅱ</button>
    </header>
    <section className="hud-speed">
      <span>{Math.round(hud.speed * 3.6)}</span><small>KM/H</small>
      <i style={{ "--speed": Math.min(100, hud.speed / VEHICLES[config.vehicle].maxSpeed * 100) + "%" } as React.CSSProperties} />
    </section>
    <section className="hud-timer"><small>TIME REMAINING</small><strong>{Math.floor(time / 60).toString().padStart(2, "0")}:{Math.floor(time % 60).toString().padStart(2, "0")}</strong></section>
    <section className="hud-target">
      <small>TARGET / {hud.biome.toUpperCase()}</small><strong>{hud.distance.toFixed(1)} M</strong>
      <div><i style={{ width: hud.pit + "%" }} /></div><span>PIT EFFECTIVENESS {Math.round(hud.pit)}%</span>
    </section>
    <section className={"hud-policy " + policyClass}>
      <small>PIT AUTHORIZATION</small><strong>{authorization.toUpperCase()}</strong><span>{policy.reason}</span>
    </section>
    <section className="hud-units">
      <small>UNIT COORDINATION</small><strong>01 {hud.assignments.player}</strong>
      <span>02 {hud.assignments.unit2} · 03 {hud.assignments.unit3}</span>
      <i>嫌犯可駕駛度 {Math.round(hud.suspectDriveability * 100)}%</i>
    </section>
    <section className="hud-camera"><small>CAMERA</small><strong>{CAMERA_LABELS[cameraMode]}</strong><span>C 切換 · R 快速後看</span></section>
    {cameraMode === "auto" && hud.distance > CAMERA_SETTINGS.helicopterFocusDistance && <div
      className="target-direction"
      style={{ "--target-bearing": `${hud.targetBearing}rad` } as React.CSSProperties}
      aria-label="嫌犯位於直升機畫面外"
    ><i>↑</i><span>嫌犯在畫面外</span></div>}
    <div className="map-code">MAP {mapCode}</div>
    <div className="game-controls"><kbd>↑</kbd> 加速 · <kbd>↓</kbd> 煞車 · <kbd>←</kbd><kbd>→</kbd> 轉向 · <kbd>C</kbd> 視角 · <kbd>Q</kbd> 無線電 · <kbd>P</kbd> 暫停</div>
    <RadioCommandWheel disabled={result !== "playing"} onCommand={handleRadio} />
    {result !== "playing" && <div className="result-overlay"><div className={"result-card result-card--" + result}>
      <span>{resultCopy.eyebrow}</span><h2>{resultCopy.title}</h2><p>{resultCopy.detail}</p>
      {result !== "paused" && <div className="debrief-grid">
        <span>PIT 嘗試 <b>{debrief.attempts}</b></span><span>有效接觸 <b>{debrief.successfulContacts}</b></span>
        <span>未授權 <b>{debrief.unsafeContacts}</b></span><span>嫌犯車況 <b>{Math.round(debrief.suspectDriveability * 100)}%</b></span>
      </div>}
      {result !== "paused" && <ol className="debrief-log">{debrief.events.map((event, index) => <li key={event + "-" + index}>{event}</li>)}</ol>}
      <div>
        {result === "paused" ? <button onClick={togglePause}>繼續任務</button> : <button onClick={restart}>相同地圖再試一次</button>}
        <button className="secondary" onClick={onExit}>返回設定</button>
      </div>
    </div></div>}
  </main>;
}
