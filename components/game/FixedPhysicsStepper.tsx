"use client";
import {useFrame} from '@react-three/fiber';
import {useRapier} from '@react-three/rapier';
import {useRef} from 'react';

/** Step exactly once per fixed interval, checking session state between steps. */
export function FixedPhysicsStepper({running}:{running:()=>boolean}) {
  const {step}=useRapier();
  const accumulator=useRef(0);
  useFrame((_,delta)=>{
    if(!running()){accumulator.current=0;return;}
    accumulator.current+=Math.min(.5,Math.max(0,delta));
    while(accumulator.current>=1/60&&running()){
      step(1/60);accumulator.current-=1/60;
    }
    if(!running())accumulator.current=0;
  });
  return null;
}
