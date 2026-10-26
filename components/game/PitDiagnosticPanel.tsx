import { diagnosticSummary, type PitDiagnostics } from '@/lib/pitDiagnostics';
export function PitDiagnosticPanel({data,details=false}:{data:PitDiagnostics;details?:boolean}) {
  const summary=diagnosticSummary(data),sample=data.latest?.sample;
  return <div className="pit-diagnostic">
    <strong className="pit-history">{summary.history}</strong>
    <span className="pit-latest">最近接觸：{summary.latest}</span>
    {data.latest?.status==='evaluating'&&<span>失控評估中 · 剩餘 {sample?.remaining.toFixed(1)??'2.5'} 秒</span>}
    {data.latest?.status==='rejected'&&<span>{data.latest.checks.find(c=>!c.pass)?.hint}</span>}
    {details&&<div className="diagnostic-details">
      <small>{data.version} · {data.mode==='practice'?'封閉練習':'一般任務'} · 本局暫存</small>
      {data.latest?.checks.map(c=><div key={c.code}>{c.pass?'✓':'×'} {c.label}：{c.value}</div>)}
      {sample&&<><div>旋轉 {sample.yaw.toFixed(1)}° / ≥55°</div><div>減速 {(sample.speedDrop*100).toFixed(1)}% / ≥35% 或側滑 {sample.lateralSpeed.toFixed(2)} / ≥4 m/s</div><div>初速 {sample.startSpeed.toFixed(2)} / &gt;4 m/s · 接觸 {sample.contactTime.toFixed(3)} / ≥0.017 s</div><div>{sample.reasons.join('；')||'失控條件成立'}</div></>}
    </div>}
  </div>;
}
