"use client";
import {useSyncExternalStore,type ReactNode} from 'react';
import dynamic from 'next/dynamic';
import {HomeClient} from '@/app/HomeClient';
const Preview=dynamic(()=>import('./NetworkPreview').then(m=>m.NetworkPreview),{ssr:false});
const Mission=dynamic(()=>import('./PitGameV2').then(m=>m.PitGameV2),{ssr:false});
const subscribe=()=>()=>{};
/** Temporary local validation entry; production visitors see the normal game. */
export function LocalNetworkPreview({children}:{children:ReactNode}){
 const enabled=useSyncExternalStore(subscribe,()=>['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('network-preview')==='1',()=>false);
 if(!enabled)return children;
 const options=new URLSearchParams(location.search);
 if(options.get('setup')==='1')return <HomeClient networkEnabled/>;
 return options.get('mission')==='1'?<Mission config={{mapMode:'network',navigation:true,seed:options.get('seed')??'4B-PREVIEW',scene:'country',weather:options.get('weather')==='snow'?'snow':options.get('weather')==='rain'?'rain':'clear',vehicle:'patrol',time:'day',quality:'medium',difficulty:'normal'}} onExit={()=>{location.href=location.pathname;}}/>:<Preview/>;
}
