import test from 'node:test';
import assert from 'node:assert/strict';
import {generateNetwork} from '../lib/networkGenerator.ts';
import {networkControlGeometry} from '../lib/networkGeometry.ts';
import {assessVehicleControl} from '../lib/vehicleControlAssessment.ts';
const car=(x,z,yaw=0,model='patrol')=>({x,z,yaw,speed:0,lateralSpeed:0,angularSpeed:0,model});
test('open intersections and offroad ground are not enclosed by imaginary road edges',()=>{
 const n=generateNetwork('CONTROL-NET');
 for(const p of [n.nodes[4],{x:n.bounds.minX+35,z:n.bounds.minZ+35}]){
  const suspect=car(p.x,p.z,0,'suspect'),g=networkControlGeometry(n,suspect);
  const result=assessVehicleControl(suspect,[car(p.x,p.z-5),car(p.x,p.z+5)],g);
  assert.notEqual(result.status,'blocked',JSON.stringify(result));
  assert.equal(assessVehicleControl(suspect,[],g).status,'open');
 }
});
test('actual fixed objects still form a physical enclosure on the network ground',()=>{
 const n=generateNetwork('CONTROL-NET'),p={x:n.bounds.minX+35,z:n.bounds.minZ+35};
 for(const o of [{x:p.x-4,z:p.z,halfX:.5,halfZ:5},{x:p.x+4,z:p.z,halfX:.5,halfZ:5},{x:p.x,z:p.z-5,halfX:4,halfZ:.5},{x:p.x,z:p.z+5,halfX:4,halfZ:.5}])n.objects.push({...o,id:`test-${n.objects.length}`,kind:'building',height:3,color:'#000'});
 const suspect=car(p.x,p.z,0,'suspect');
 assert.equal(assessVehicleControl(suspect,[],networkControlGeometry(n,suspect)).status,'blocked');
});
