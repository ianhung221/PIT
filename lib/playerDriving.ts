/** Fixed-step player controls. Speeds are m/s; cruise UI targets are km/h. */
import { playerVehicleStatus, pristineDamage } from './vehicleDamage.ts';
import { vehicleDragAcceleration } from './vehiclePhysics.ts';
export interface PlayerDriving {
  input: {up:boolean;down:boolean;left:boolean;right:boolean};
  lastInputEvent: string;
  vehicleStatus: ReturnType<typeof playerVehicleStatus>;
  physics?: {groundedWheels:number;tilt:number;wheelSteering:number;rolloverDisabled:boolean};
  throttle: number;
  steering: number;
  cruise: boolean;
  target: number;
  reason: string;
  integral: number;
  touching: boolean;
  commands: ("toggle" | "up" | "down")[];
}
export const makePlayerDriving = (): PlayerDriving => ({ input:{up:false,down:false,left:false,right:false}, lastInputEvent:'尚無按鍵', vehicleStatus:playerVehicleStatus(pristineDamage()), throttle:0, steering:0, cruise:false, target:0, reason:"", integral:0, touching:false, commands:[] });
export function noteDrivingKey(s:PlayerDriving,key:string,down:boolean,accepted=true) {
  const labels:Record<string,string>={arrowup:'↑',arrowdown:'↓',arrowleft:'←',arrowright:'→',w:'W',s:'S',a:'A',d:'D'};
  if(labels[key]) s.lastInputEvent=accepted?`${labels[key]} ${down?'按下已收到':'放開已收到'}`:`${labels[key]} 長按已忽略：請完全放開後重按`;
}
export function cancelCruise(s: PlayerDriving, reason: string) {
  if (s.cruise) { s.reason = reason; s.throttle = 0; }
  s.cruise = false; s.integral = 0;
}
export function resetPlayerDriving(s: PlayerDriving, reason: string) {
  cancelCruise(s, reason); s.throttle=0; s.steering=0; s.target=0; s.reason=reason; s.commands.length=0;
  s.input={up:false,down:false,left:false,right:false}; s.lastInputEvent=reason+'：請鬆開後重按';
}
const clamp = (v:number, lo:number, hi:number) => Math.max(lo, Math.min(hi,v));
const approach = (v:number, target:number, step:number) => v + clamp(target-v,-step,step);
export function stepPlayerDriving(s:PlayerDriving, input:{throttle:boolean;brake:boolean;steer:number}, speed:number, limit:number, acceleration:number, canDrive:boolean, dt:number) {
  for (const command of s.commands.splice(0)) {
    if (command === "toggle") {
      if (s.cruise) cancelCruise(s,"手動關閉");
      else if (speed*3.6 < 10 || s.touching || !canDrive || input.throttle || input.brake) s.reason="需前進達 10 km/h、鬆開踏板且未接觸障礙";
      else { s.cruise=true; s.target=clamp(speed*3.6,10,limit*3.6); s.integral=0; s.reason=""; }
    } else if (s.cruise) s.target=clamp(s.target+(command==="up"?5:-5),10,limit*3.6);
  }
  if (input.brake || input.throttle || s.touching || !canDrive || speed < 0) cancelCruise(s,input.brake?"煞車／倒車":input.throttle?"手動油門":s.touching?"碰撞／接觸障礙":"無法維持前進");
  s.steering=approach(s.steering,input.steer,dt/(input.steer===0?.15:.18));
  let target=input.throttle && !input.brake && canDrive ? 1 : 0;
  if (s.cruise) {
    s.target=clamp(s.target,10,limit*3.6);
    const error=s.target/3.6-speed;
    // Feed forward compensates the shared physical drag. Anti-windup
    // permits integration only when output can respond in the error direction.
    const feed=vehicleDragAcceleration(speed)/Math.max(.1,acceleration);
    const raw=feed+error*.30+s.integral;
    if ((raw>0 && raw<1) || (raw>=1 && error<0) || (raw<=0 && error>0)) s.integral=clamp(s.integral+error*.12*dt,-.4,.4);
    target=error<-.15?0:clamp(feed+error*.30+s.integral,0,1);
  }
  s.throttle=input.brake || !canDrive ? 0 : approach(s.throttle,target,dt/(target>s.throttle?.7:.15));
  return s;
}
export function playerTurnRate(steering:number, speed:number, authority:number) {
  // Signed speed smoothly crosses zero; no steering-generated spin at rest.
  const low=clamp(speed/13,-1,1);
  const high=1/(1+Math.max(0,Math.abs(speed)-13)/12);
  return -steering*authority*low*high;
}
