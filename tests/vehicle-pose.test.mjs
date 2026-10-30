import test from 'node:test';
import assert from 'node:assert/strict';
import { readVehicleFrame, vehicleSnapshot, snapshotFromFrame, rotateVehicleVector, inverseRotateVehicleVector, vehicleWorldPoint, vehicleLocalPoint, snapshotQuaternion } from '../lib/vehiclePose.ts';

const near=(actual,expected,epsilon=1e-9)=>assert.ok(Math.abs(actual-expected)<epsilon,`${actual} != ${expected}`);
const vectorNear=(actual,expected)=>{for(const axis of ['x','y','z'])near(actual[axis],expected[axis]);};
const axisQuat=(axis,angle)=>({...{x:0,y:0,z:0},[axis]:Math.sin(angle/2),w:Math.cos(angle/2)});
const multiply=(a,b)=>({
  x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
  y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
  z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
  w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z,
});
const body=({q={x:0,y:0,z:0,w:1},p={x:2,y:3,z:4},v={x:0,y:0,z:0},w={x:0,y:0,z:0}}={})=>({
  rotation:()=>q,translation:()=>p,linvel:()=>v,angvel:()=>w,
});

test('physical minus-Z forward and plus-X right preserve signed forward and reverse speeds',()=>{
  for(const yaw of [0,.4,Math.PI/2,-Math.PI/2,Math.PI-1e-5])for(const speed of [-14,0,14]) {
    const q=axisQuat('y',yaw),v=rotateVehicleVector({x:3,y:0,z:-speed},q);
    const frame=readVehicleFrame(body({q,v}));
    near(frame.yaw,yaw);near(frame.forwardSpeed,speed);near(frame.lateralSpeed,3);
    near(frame.bodyForwardSpeed,speed);near(frame.bodyLateralSpeed,3);
    assert.equal(frame.headingValid,true);near(frame.upDot,1);
    vectorNear(frame.forward,{x:-Math.sin(yaw),y:0,z:-Math.cos(yaw)});
    vectorNear(frame.right,{x:Math.cos(yaw),y:0,z:-Math.sin(yaw)});
  }
});

test('pitch through vertical retains last reliable road heading without a false half turn',()=>{
  const yaw=.7;
  for(const pitch of [80,89,90,91,100,180]) {
    const q=multiply(axisQuat('y',yaw),axisQuat('x',pitch*Math.PI/180));
    const frame=readVehicleFrame(body({q}),yaw);
    assert.equal(frame.headingValid,false);near(frame.yaw,yaw);
    vectorNear(frame.forward,rotateVehicleVector({x:0,y:0,z:-1},q));
  }
  const upright=readVehicleFrame(body({q:axisQuat('y',yaw)}),-2);
  assert.equal(upright.headingValid,true);near(upright.yaw,yaw);
});

test('half roll is fully represented by quaternion without inventing road yaw',()=>{
  const yaw=-1.1,q=multiply(axisQuat('y',yaw),axisQuat('z',Math.PI));
  const frame=readVehicleFrame(body({q}),yaw);
  near(frame.upDot,-1);near(frame.tilt,Math.PI);near(frame.yaw,yaw);
  assert.equal(frame.headingValid,false);
  vectorNear(frame.up,{x:0,y:-1,z:0});
  vectorNear(frame.forward,{x:-Math.sin(yaw),y:0,z:-Math.cos(yaw)});
  const snapshot=snapshotFromFrame(frame);
  vectorNear(vehicleWorldPoint(snapshot,{x:0,y:1,z:0}),{x:2,y:2,z:4});
});

test('planar speed excludes falling velocity and angular speed includes pitch and roll',()=>{
  const frame=readVehicleFrame(body({q:axisQuat('x',Math.PI/2),v:{x:0,y:-8,z:0},w:{x:3,y:4,z:12}}),.8);
  near(frame.planarSpeed,0);near(frame.forwardSpeed,0);near(frame.lateralSpeed,0);
  near(frame.bodyForwardSpeed,-8);near(frame.angularSpeed,13);
  vectorNear(frame.angularVelocity,{x:3,y:4,z:12});
});

test('world/local contact points round trip through yaw, pitch, roll and height',()=>{
  const q=multiply(multiply(axisQuat('y',.8),axisQuat('x',.5)),axisQuat('z',-.3));
  const car=vehicleSnapshot(body({q,p:{x:102,y:8,z:-47}}));
  for(const local of [{x:0,y:0,z:0},{x:.9,y:.6,z:1.4},{x:-.9,y:-.45,z:-2.1}]) {
    vectorNear(vehicleLocalPoint(car,vehicleWorldPoint(car,local)),local);
    vectorNear(inverseRotateVehicleVector(rotateVehicleVector(local,q),q),local);
  }
  // Legacy snapshots still mean the same planar frame at the old body height.
  const legacy={x:1,z:2,yaw:Math.PI/2,speed:0,lateralSpeed:0};
  vectorNear(vehicleWorldPoint(legacy,{x:0,y:1,z:-2}),{x:-1,y:1.02,z:2});
  near(snapshotQuaternion(legacy).y,Math.SQRT1_2);
});

test('snapshot carries independent pose copies and allows wheel/rollover samples',()=>{
  const q=axisQuat('y',.4),lengths=[.3,.4,.5,.6];
  const car=vehicleSnapshot(body({q}),0,{groundedWheels:3,rolloverDisabled:true,wheelSteering:.2,suspensionLengths:lengths});
  assert.equal(car.pose.groundedWheels,3);assert.equal(car.pose.rolloverDisabled,true);near(car.pose.wheelSteering,.2);
  lengths[0]=9;q.w=0;
  near(car.pose.suspensionLengths[0],.3);near(car.pose.quaternion.w,Math.cos(.2));
  const defaults=vehicleSnapshot(body());
  assert.equal(defaults.pose.groundedWheels,0);assert.equal(defaults.pose.rolloverDisabled,false);
});

test('quaternion sign and magnitude do not change pose; corrupt orientation is marked unreliable',()=>{
  const q=multiply(axisQuat('y',1.2),axisQuat('x',.2));
  const normal=readVehicleFrame(body({q}));
  const scaled=readVehicleFrame(body({q:Object.fromEntries(Object.entries(q).map(([k,v])=>[k,-3*v]))}));
  vectorNear(normal.forward,scaled.forward);vectorNear(normal.up,scaled.up);near(normal.yaw,scaled.yaw);
  for(const invalid of [{x:0,y:0,z:0,w:0},{x:NaN,y:0,z:0,w:1}]) {
    const frame=readVehicleFrame(body({q:invalid}),.4);
    assert.equal(frame.headingValid,false);near(frame.yaw,.4);
    assert.ok(Object.values(frame.quaternion).every(Number.isFinite));
  }
});
