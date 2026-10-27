import type { PlayerDriving } from '@/lib/playerDriving';
export function PlayerStatus({driving,details=false}:{driving:PlayerDriving;details?:boolean}) {
  const status=driving.vehicleStatus;
  return <div className={'player-status'+(!status.driveable?' player-status--disabled':'')}>
    <span>自車車況 {Math.round(status.health*100)}% · {status.reason}</span>
    {details&&<div className="player-input-details">
      <div>有效按鍵：↑ {driving.input.up?'有':'無'} · ↓ {driving.input.down?'有':'無'} · ← {driving.input.left?'有':'無'} · → {driving.input.right?'有':'無'}</div>
      <div>油門命令 {Math.round(driving.throttle*100)}% · 轉向命令 {driving.steering.toFixed(2)} · 轉向能力 {Math.round(status.steeringAuthority*100)}%</div>
      <div>{driving.lastInputEvent}</div>
      <div>{driving.touching?'車身正在接觸物體':'未偵測車身接觸'} · 按鍵收到不代表車身一定能移動</div>
    </div>}
  </div>;
}
