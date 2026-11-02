import type { VehicleDamage } from "../types/game.ts";

export const pristineDamage = (): VehicleDamage => ({
  engine: 1, cooling: 1, steering: 1,
  frontLeftGrip: 1, frontRightGrip: 1, rearLeftGrip: 1, rearRightGrip: 1,
  alignment: 1, body: 1,
});

export interface ImpactInput { impulse: number; localX: number; localZ: number; halfWidth: number; halfLength: number }
const clampHealth = (value: number) => Math.max(0, Math.min(1, value));

export function applyImpactDamage(current: VehicleDamage, impact: ImpactInput): VehicleDamage {
  const severity = Math.max(0, Math.min(.72, (impact.impulse - 2) / 26));
  return applySeverityDamage(current,impact,severity);
}
export function applySeverityDamage(current:VehicleDamage,impact:ImpactInput,severity:number):VehicleDamage {
  if (severity <= 0) return { ...current };
  const front = impact.localZ < -impact.halfLength * .3;
  const rear = impact.localZ > impact.halfLength * .3;
  const left = impact.localX < 0;
  const wheelHit = Math.abs(impact.localX) > impact.halfWidth * .45;
  // A front corner primarily loads the bumper and wheel area, whereas a
  // central frontal impact reaches the engine bay more directly. Interpolate
  // continuously to avoid a damage cliff at a collider-strip boundary.
  const centrality = Math.max(0, Math.min(1, (1 - Math.abs(impact.localX) / Math.max(impact.halfWidth, 1e-6)) / .55));
  const frontWeight = .22 + .78 * centrality;
  const cornerWheelWeight = front ? .35 + .65 * centrality : 1;
  const next = { ...current };
  next.body = clampHealth(next.body - severity * .5);
  next.alignment = clampHealth(next.alignment - severity * (wheelHit ? .72 * cornerWheelWeight : .28));
  if (front) {
    next.engine = clampHealth(next.engine - severity * .62 * frontWeight);
    next.cooling = clampHealth(next.cooling - severity * .8 * frontWeight);
    next.steering = clampHealth(next.steering - severity * .64 * frontWeight);
  }
  if (rear) {
    if (left) next.rearLeftGrip = clampHealth(next.rearLeftGrip - severity * .86);
    else next.rearRightGrip = clampHealth(next.rearRightGrip - severity * .86);
  }
  if (wheelHit && !rear) {
    if (left) next.frontLeftGrip = clampHealth(next.frontLeftGrip - severity * .78 * cornerWheelWeight);
    else next.frontRightGrip = clampHealth(next.frontRightGrip - severity * .78 * cornerWheelWeight);
  }
  return next;
}

export function vehicleDriveability(damage: VehicleDamage): number {
  const grip = (damage.frontLeftGrip + damage.frontRightGrip + damage.rearLeftGrip + damage.rearRightGrip) / 4;
  return Math.max(0, Math.min(1, damage.engine * .36 + damage.steering * .25 + grip * .25 + damage.alignment * .14));
}

export function vehicleCanContinue(damage: VehicleDamage): boolean {
  return damage.engine > .16;
}

export function playerVehicleStatus(damage: VehicleDamage) {
  const driveable=vehicleCanContinue(damage), steeringAuthority=damage.steering*damage.alignment;
  const faults:string[]=[];
  if(damage.engine<=.16) faults.push('引擎失能');
  if(damage.steering<=.2) faults.push('轉向系統嚴重受損');
  else if(steeringAuthority<.5) faults.push('轉向能力受損');
  if(damage.alignment<=.001) faults.push('車輪定位失效，無法轉向');
  if(!driveable&&!faults.length) faults.push('整體車況不足');
  return {driveable,steeringAuthority,health:vehicleDriveability(damage),
    reason:driveable?(faults.join('；')||'自車可正常駕駛'):`動力不可用：${faults.join('；')}；可煞車，P 暫停後可返回設定`};
}

export function vehicleCanPerformDriving(damage:VehicleDamage):boolean {
  return vehicleCanContinue(damage)&&damage.steering*damage.alignment>.2;
}
export function vehicleFaultSummary(damage:VehicleDamage,rolloverDisabled=false):string {
  if(rolloverDisabled)return '穩定翻覆，動力不可用';
  if(!vehicleCanContinue(damage))return '動力失能';
  if(!vehicleCanPerformDriving(damage))return '轉向嚴重受損，動力可用';
  if(damage.steering*damage.alignment<.5)return '轉向受損';
  return '動力及轉向可用';
}
