import test from 'node:test';
import assert from 'node:assert/strict';
import {suspectRoadCruise,maxPitSpeed,evaluatePitRisk} from '../lib/pitPolicy.ts';

test('straight rain and snow pursuit speeds are independent of PIT authorization limits',()=>{
 for(const biome of ['city','country','highway'])for(const [grip,minimum] of [[.78,80],[.58,65]]){
  const straight={biome,kind:'straight',turn:0,risk:biome==='city'?.72:.3};
  const speed=suspectRoadCruise(straight,straight,grip)*3.6;
  assert.ok(speed>=minimum,`${biome} ${grip}: ${speed}`);
  const decision=evaluatePitRisk({speedKph:speed,weatherGrip:grip,visibility:1,roadRisk:.1,trafficDensity:0,obstacleRisk:0,offenseSeverity:.86,supportUnits:2});
  if(speed>maxPitSpeed(grip))assert.notEqual(decision.authorization,'authorized');
 }
});
test('real bends and upcoming junctions reduce target speed with less grip',()=>{
 const straight={biome:'country',kind:'straight',turn:0,risk:.3},curve={...straight,kind:'curve',turn:.045},junction={...straight,kind:'junction'};
 for(const grip of [1,.78,.58]){
  const base=suspectRoadCruise(straight,straight,grip);
  assert.ok(suspectRoadCruise(straight,curve,grip)<base);
  assert.ok(suspectRoadCruise(straight,junction,grip)<base);
  assert.ok(suspectRoadCruise(straight,junction,grip,0,40)>suspectRoadCruise(straight,junction,grip,0,0));
 }
 assert.ok(suspectRoadCruise(curve,curve,.58)<suspectRoadCruise(curve,curve,.78));
 assert.equal(suspectRoadCruise(straight,{...curve,turn:0},.78),suspectRoadCruise(straight,straight,.78));
});
test('a snow highway junction can provide a safe authorization opportunity without changing policy',()=>{
 const junction={biome:'highway',kind:'junction',turn:.012,risk:.504};
 const speedKph=suspectRoadCruise(junction,junction,.58)*3.6;
 const decision=evaluatePitRisk({speedKph,weatherGrip:.58,visibility:.68,roadRisk:junction.risk,trafficDensity:.38,obstacleRisk:.2,offenseSeverity:.86,supportUnits:2});
 assert.equal(decision.authorization,'authorized');
});
