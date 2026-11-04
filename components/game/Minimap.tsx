"use client";
import {useEffect,useRef,useState,type MutableRefObject} from 'react';
import {navigationRoute,type NavigationFix} from '@/lib/navigation';
import {networkIndex,type RoadNetwork} from '@/lib/roadNetwork';
import type {V2Runtime} from './v2Runtime';

export function Minimap({network,runtime,enabled}:{network:RoadNetwork;runtime:MutableRefObject<V2Runtime>;enabled:boolean}){
 const location=useRef<ReturnType<typeof navigationRoute>['location']|undefined>(undefined);
 const [view,setView]=useState(()=>({player:{...runtime.current.player},supports:runtime.current.supports.map(c=>({...c})),fix:null as NavigationFix|null,route:navigationRoute(network,runtime.current.player,null)}));
 const [expanded,setExpanded]=useState(true);
 useEffect(()=>{const update=()=>{
  const s=runtime.current,fix:NavigationFix={position:{x:s.suspect.x,z:s.suspect.z,yaw:s.suspect.yaw},observedAt:s.elapsed,source:'live-assistance'};
  const route=navigationRoute(network,s.player,enabled?fix:null,location.current);location.current=route.location;
  setView({player:{...s.player},supports:s.supports.map(c=>({...c})),fix:enabled?fix:null,route});
 };const timer=setInterval(update,300);return()=>clearInterval(timer);},[network,runtime,enabled]);
 const index=networkIndex(network),scale=2.6,point=(p:{x:number;z:number})=>({x:100+(p.x-view.player.x)/scale,y:100+(p.z-view.player.z)/scale});
 const arrow={left:'↰',right:'↱',straight:'↑',target:'◎'}[view.route.direction];
 return <aside className="network-minimap" aria-label="道路迷你地圖">
  <button onClick={()=>setExpanded(v=>!v)} aria-expanded={expanded}>地圖 <span>北 ↑</span></button>
  {expanded&&<svg viewBox="0 0 200 200" role="img" aria-label="附近道路、自車方向與導航路線">
   <rect width="200" height="200" fill="#0d1b20"/>
   {network.edges.map(e=>{const a=point(index.nodes.get(e.a)!),b=point(index.nodes.get(e.b)!);return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={e.biome==='highway'?'#788c9b':'#475b65'} strokeWidth={e.biome==='highway'?5:3}/>;})}
   {view.route.status==='route'&&<polyline points={view.route.points.map(p=>{const q=point(p);return `${q.x},${q.y}`;}).join(' ')} fill="none" stroke="#57d9ef" strokeWidth="2.5"/>}
   {network.towns.map(t=>{const p=point(t);return <text key={t.id} x={p.x} y={p.y} textAnchor="middle" fill="#cad7d9" fontSize="9" stroke="#0d1b20" strokeWidth="2" paintOrder="stroke">{t.name}</text>;})}
   {view.supports.map((c,i)=>{const p=point(c);return <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#73a9ff"/>;})}
   {view.fix&&(()=>{const p=point(view.fix.position);return <rect x={p.x-3} y={p.y-3} width="6" height="6" fill="#ff7765"/>;})()}
   <path d="M100 92 L94 107 L100 104 L106 107 Z" transform={`rotate(${-view.player.yaw*180/Math.PI} 100 100)`} fill="#fff" stroke="#0b1b22" strokeWidth="1.5"/>
  </svg>}
  {enabled&&<div className="navigation-turn" aria-live="off"><b aria-label={view.route.direction==='left'?'左轉':view.route.direction==='right'?'右轉':'前進'}>{view.route.status==='route'?arrow:'!'}</b><span>{view.route.status==='route'?`${Math.round(view.route.distance/5)*5} m`:view.route.status==='blocked'?'路線受阻':'等待位置'}<small>即時路線輔助</small></span></div>}
 </aside>;
}
