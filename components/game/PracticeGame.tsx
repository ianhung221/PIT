"use client";
/* eslint-disable react/no-unknown-property -- R3F scene. */
import { Canvas, useFrame } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { PracticeVehicleSimulation } from './PracticeVehicleSimulation';
import { makePracticeRuntime, type PracticeRuntime } from './practiceRuntime';
import { PitDiagnosticPanel } from './PitDiagnosticPanel';
import { PRACTICE, type PracticeConfig } from '@/lib/practiceConfig';
import { QUALITY_SETTINGS } from '@/lib/gameConfig';
import { resetPlayerDriving, noteDrivingKey } from '@/lib/playerDriving';
import { PlayerStatus } from './PlayerStatus';

function PracticeCamera({runtime}:{runtime:MutableRefObject<PracticeRuntime>}) {
  const initialized=useRef(false);
  useFrame(({camera},dt)=>{
    const p=runtime.current.player;
    const target=new THREE.Vector3(p.x+Math.sin(p.yaw)*12,6.4,p.z+Math.cos(p.yaw)*12);
    camera.position.lerp(target,initialized.current?1-Math.exp(-dt*6):1);
    camera.lookAt(p.x-Math.sin(p.yaw)*5,1,p.z-Math.cos(p.yaw)*5);
    initialized.current=true;
  });
  return null;
}
export function PracticeGame({config,onExit}:{config:PracticeConfig;onExit:()=>void}) {
  const runtime=useRef(makePracticeRuntime(config)),keys=useRef(new Set<string>());
  const [hud,setHud]=useState(()=>makePracticeRuntime(config));
  const [run,setRun]=useState(0),[details,setDetails]=useState(false),[zones,setZones]=useState(false);
  const update=useCallback(()=>setHud(structuredClone(runtime.current)),[]);
  const setPhase=useCallback((phase:PracticeRuntime['phase'])=>{
    keys.current.clear();resetPlayerDriving(runtime.current.driving,'練習階段切換');
    runtime.current.phase=phase;update();
  },[update]);
  const togglePause=useCallback(()=>{
    if(runtime.current.phase==='playing') setPhase('paused');
    else if(runtime.current.phase==='paused') setPhase('playing');
  },[setPhase]);
  useEffect(()=>{
    const clear=()=>{keys.current.clear();resetPlayerDriving(runtime.current.driving,'視窗失去焦點');};
    const visibility=()=>{if(document.hidden)clear();};
    const down=(e:KeyboardEvent)=>{
      const key=e.key.toLowerCase();
      if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key))e.preventDefault();
      if(!e.repeat&&(key==='p'||key==='escape')){togglePause();return;}
      if(runtime.current.phase!=='playing')return;
      if(['f','[',']'].includes(key)){
        e.preventDefault();
        if(!e.repeat) runtime.current.driving.commands.push(key==='f'?'toggle':key==='['?'down':'up');
        return;
      }
      if(e.repeat&&!keys.current.has(key)){noteDrivingKey(runtime.current.driving,key,true,false);return;}
      noteDrivingKey(runtime.current.driving,key,true);
      keys.current.add(key);
    };
    const up=(e:KeyboardEvent)=>{const key=e.key.toLowerCase();keys.current.delete(key);noteDrivingKey(runtime.current.driving,key,false);};
    window.addEventListener('keydown',down,{passive:false});window.addEventListener('keyup',up);
    window.addEventListener('blur',clear);document.addEventListener('visibilitychange',visibility);
    return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',clear);document.removeEventListener('visibilitychange',visibility);};
  },[togglePause]);
  const reset=()=>{keys.current.clear();runtime.current=makePracticeRuntime(config);setRun(n=>n+1);update();};
  const paused=hud.phase!=='playing';
  return <main className="game-shell practice-shell">
    <Canvas shadows={config.quality!=='low'} camera={{fov:56,near:.1,far:2200}} dpr={QUALITY_SETTINGS[config.quality].dpr} gl={{antialias:config.quality!=='low'}}>
      <color attach="background" args={['#aabec6']}/><fog attach="fog" args={['#aabec6',220,1700]}/>
      <ambientLight intensity={1.3}/><directionalLight position={[15,28,10]} intensity={2} castShadow={config.quality!=='low'}/>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.49,0]} receiveShadow><planeGeometry args={[2000,2000]}/><meshStandardMaterial color="#454c4d"/></mesh>
      <gridHelper args={[PRACTICE.halfSize*2,200,'#829591','#626d6b']} position={[0,-.48,0]}/>
      <Physics gravity={[0,0,0]} timeStep={1/60} maxCcdSubsteps={4} numSolverIterations={8} paused={paused}>
        <PracticeVehicleSimulation key={run} runtime={runtime} keys={keys} config={config} zones={zones} onUpdate={update}/>
      </Physics>
      <PracticeCamera key={run} runtime={runtime}/>
    </Canvas>
    <header className="game-top"><div className="game-logo"><b>PIT</b> 練習場</div><button onClick={togglePause} aria-label="暫停練習">Ⅱ</button></header>
    <section className="practice-diagnostics">
      <small>封閉練習許可 · 晴朗／白天 · 不需 Q1</small>
      <PitDiagnosticPanel data={hud.diagnostics} details={details}/>
      <PlayerStatus driving={hud.driving} details={details}/>
      <div className="diagnostic-toggles"><label><input type="checkbox" checked={details} onChange={e=>setDetails(e.target.checked)}/> 詳細量測</label><label><input type="checkbox" checked={zones} onChange={e=>setZones(e.target.checked)}/> 接觸區域提示</label></div>
    </section>
    <div className="practice-driving"><strong>{Math.round(hud.player.speed*3.6)} km/h</strong><span>經過 {hud.elapsed.toFixed(1)}s · 無倒數</span><span>油門 {Math.round(hud.driving.throttle*100)}% · {hud.driving.cruise?`巡航 ${Math.round(hud.driving.target)} km/h`:'巡航關閉'}</span><small>{hud.driving.reason}</small>
      <div><button disabled={paused} onClick={()=>runtime.current.driving.commands.push('toggle')}>F 巡航</button><button disabled={paused||!hud.driving.cruise} onClick={()=>runtime.current.driving.commands.push('down')}>[ −5</button><button disabled={paused||!hud.driving.cruise} onClick={()=>runtime.current.driving.commands.push('up')}>] +5</button><button onClick={reset}>重設練習</button></div>
    </div>
    <div className="game-controls">↑ 漸進油門 · ↓ 煞車／倒車 · ← → 轉向 · P 暫停 · 後方追蹤視角</div>
    {paused&&<div className="result-overlay"><section className="result-card practice-modal">
      <span>CONTROLLED PRACTICE</span>
      <h2>{hud.phase==='ready'?'準備練習':hud.phase==='qualified'?'有效 PIT 已確認':hud.phase==='outside'?'已離開練習範圍':'練習暫停'}</h2>
      <p>{hud.phase==='ready'?'兩車同向 50 km/h，目標在前方約 10 公尺。按開始後才會行駛；沒有後援、倒數或包圍要求。':hud.phase==='qualified'?'本次失控符合遊戲判定，紀錄已保留。可以立即再練，或繼續觀察目標恢復行駛。':hud.phase==='outside'?'任一車輛超出 2 × 2 公里範圍，模擬已暫停。請重設練習；邊界沒有隱形牆。':'準備好後可繼續，或回到設定。'}</p>
      {hud.phase!=='ready'&&<PitDiagnosticPanel data={hud.diagnostics} details={details}/>}
      {hud.phase!=='ready'&&<details><summary>本局接觸紀錄（最多 60 筆）</summary><ol className="debrief-log">{hud.diagnostics.events.map((e,i)=><li key={i}>#{e.attempt} · {e.at.toFixed(1)}s · {e.message}</li>)}</ol></details>}
      <div className="debrief-actions">
        {hud.phase==='ready'&&<button className="practice-start" onClick={()=>setPhase('playing')}>開始練習</button>}
        {hud.phase==='qualified'&&<><button onClick={reset}>立即再練</button><button onClick={()=>setPhase('playing')}>繼續觀察</button></>}
        {hud.phase==='paused'&&<button onClick={()=>setPhase('playing')}>繼續練習</button>}
        {hud.phase==='outside'&&<button onClick={reset}>重設練習</button>}
        <button className="secondary" onClick={onExit}>返回設定</button>
      </div>
    </section></div>}
  </main>;
}
