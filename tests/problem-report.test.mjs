import test from 'node:test';
import assert from 'node:assert/strict';
import {createProblemReport} from '../components/game/problemReport.ts';

test('report captures readable values without serializing internal path searches',()=>{
 const runtime={
  road:{code:'NET1:TEST',network:{unwanted:'large map'}},elapsed:12.5,
  player:{x:1},playerDamage:{engine:.7},driving:{cruise:true},
  suspect:{x:2},suspectDamage:{engine:1},supports:[{x:3},{x:4}],supportDamage:[{},{}],
  supportControl:[{at:12.5,source:'封鎖控制',speed:0,reason:'未知'},null],
  networkDrivers:[{},...Array.from({length:2},()=>({blocked:false,local:{mode:'waiting',reason:''}}))],
  blockade:{phase:'approaching',frontUnit:1,stages:[0,0],settled:[0,0],blockedFor:[0,0],available:[true,true],playerCovered:[false,false],search:()=>{}},
  eventLog:['[12.0s] 等待','[8.0s] 開始'],control:{status:'uncertain'},pitQualified:false,
 };
 const config={weather:'rain'};
 const raw=createProblemReport(runtime,config,'版本 abc1234');
 const report=JSON.parse(raw);
 assert.equal(report.version,'版本 abc1234');
 assert.equal(report.settings.weather,'rain');
 assert.equal(report.vehicles.player.driving.cruise,true);
 assert.equal(report.vehicles.supports[0].control.source,'封鎖控制');
 assert.equal(report.vehicles.supports[1].control,null);
 assert.deepEqual(report.events,runtime.eventLog);
 assert.equal(raw.includes('large map'),false);
 runtime.player.x=99;
 assert.equal(report.vehicles.player.state.x,1);
});
