import test from 'node:test';
import assert from 'node:assert/strict';
import { RAPIER,physicalWorld,physicsSnapshot,stepVehiclePhysics } from './helpers/vehicle-world.mjs';
import { driveVehicleTarget,vehicleTargetPedals } from '../lib/vehicleDriver.ts';
import { maximumWheelSteering } from '../lib/vehiclePhysics.ts';
import { readVehicleFrame } from '../lib/vehiclePose.ts';
import { normalizeAngle } from '../lib/gameRules.ts';
import { pristineDamage } from '../lib/vehicleDamage.ts';

await RAPIER.init();
const kinds=['patrol','interceptor','suv'];
const neutral={throttle:0,brake:0,steer:0,gear:1};
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const rounded=n=>+n.toFixed(4);
function settle(sim){for(let i=0;i<120;i++)sim.step();}
function commandWheelAngle(vehicle,angle,base=neutral){
  const speed=readVehicleFrame(vehicle.body,vehicle.lastYaw).bodyForwardSpeed;
  const authority=maximumWheelSteering(vehicle.config.kind,speed);
  assert.ok(Math.abs(angle)<=authority,'test wheel request exceeds current steering authority');
  return {...base,steer:angle/authority};
}
function bodyBoundary(car,config){
  const points=[];
  // Sample each rectangle edge at <=25cm; the measured compound body fits
  // inside this conservative envelope. Physical guardrail contacts are also
  // checked, so an unsampled corner cannot be corrected by a wall unnoticed.
  for(const side of [-1,1]){
    const count=Math.ceil(config.length/.25);
    for(let i=0;i<=count;i++)points.push([side*config.width/2,-config.length/2+i*config.length/count]);
    const across=Math.ceil(config.width/.25);
    for(let i=0;i<=across;i++)points.push([-config.width/2+i*config.width/across,side*config.length/2]);
  }
  return points.map(([x,z])=>({x:car.x+Math.cos(car.yaw)*x+Math.sin(car.yaw)*z,z:car.z-Math.sin(car.yaw)*x+Math.cos(car.yaw)*z}));
}
function bendPoint(distance,radius=8){
  const arc=radius*Math.PI/2;
  if(distance<0)return {x:0,z:-distance};
  if(distance>arc)return {x:radius+distance-arc,z:-radius};
  return {x:radius-radius*Math.cos(distance/radius),z:-radius*Math.sin(distance/radius)};
}
function bendDistance(point,radius=8){
  const angle=clamp(Math.atan2(-point.z,radius-point.x),0,Math.PI/2),arc=bendPoint(angle*radius,radius);
  return Math.min(Math.hypot(point.x,Math.min(point.z,0)),Math.hypot(Math.min(point.x-radius,0),point.z+radius),Math.hypot(point.x-arc.x,point.z-arc.z));
}
function bendBarriers(world,radius=8,width=4.5){
  const barriers=new Set();
  const add=(a,b)=>{
    const dx=b.x-a.x,dz=b.z-a.z,yaw=Math.atan2(-dx,-dz);
    const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(.025,.55,Math.hypot(dx,dz)/2+.002)
      .setTranslation((a.x+b.x)/2,0,(a.z+b.z)/2)
      .setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)})
      .setCollisionGroups((4<<16)|0xffff));
    barriers.add(collider.handle);
  };
  for(const side of [-1,1]){
    const r=radius+side*width/2;
    add({x:radius-r,z:12},{x:radius-r,z:0});
    for(let i=0;i<32;i++){
      const a=i*Math.PI/64,b=(i+1)*Math.PI/64;
      add({x:radius-r*Math.cos(a),z:-r*Math.sin(a)},{x:radius-r*Math.cos(b),z:-r*Math.sin(b)});
    }
    add({x:radius,z:-r},{x:28,z:-r});
  }
  return barriers;
}

test('three models physically negotiate a 20 km/h, R8m, 4.5m-wide right-angle bend without touching its boundaries',t=>{
  const results=[];
  for(const kind of kinds){
    const sim=physicalWorld(kind),vehicle=sim.vehicle;
    try{
      const barriers=bendBarriers(sim.world);settle(sim);
      // Initial condition only. Every subsequent change is produced by tyres.
      vehicle.body.setLinvel({x:0,y:0,z:-20/3.6},true);
      let maxDistance=0,minSpeed=20,maxTilt=0,contacts=0,completed=false,elapsed=0;
      for(let i=0;i<600;i++){
        const car=physicsSnapshot(vehicle);
        const progress=car.x>=8?8*Math.PI/2+car.x-8:8*clamp(Math.atan2(-car.z,8-car.x),0,Math.PI/2);
        // A common ~one-second (6m) geometric preview is test guidance only;
        // it does not alter the production AI or enforce vehicle position.
        const aim=bendPoint(progress+6);
        const desired=Math.atan2(-(aim.x-car.x),-(aim.z-car.z));
        driveVehicleTarget(vehicle,{speed:20/3.6,yawError:normalizeAngle(desired-car.yaw)});
        sim.world.step();elapsed=(i+1)/60;
        const after=physicsSnapshot(vehicle);
        for(const p of bodyBoundary(after,vehicle.config))maxDistance=Math.max(maxDistance,bendDistance(p));
        minSpeed=Math.min(minSpeed,after.speed*3.6);maxTilt=Math.max(maxTilt,after.pose.tilt);
        for(let c=0;c<vehicle.body.numColliders();c++)sim.world.contactPairsWith(vehicle.body.collider(c),other=>{
          if(barriers.has(other.handle))sim.world.contactPair(vehicle.body.collider(c),other,m=>{if(m.numSolverContacts())contacts++;});
        });
        if(after.x>=20&&Math.abs(normalizeAngle(after.yaw+Math.PI/2))<.06){completed=true;break;}
      }
      const evidence={kind,elapsed:rounded(elapsed),maxBodyOffset:rounded(maxDistance),minKph:rounded(minSpeed),maxTiltDeg:rounded(maxTilt*180/Math.PI),contacts};
      assert.ok(completed,JSON.stringify(evidence));assert.equal(contacts,0,JSON.stringify(evidence));
      assert.ok(maxDistance<2.25,JSON.stringify(evidence));assert.ok(minSpeed>=17,JSON.stringify(evidence));
      assert.ok(maxTilt<20*Math.PI/180,JSON.stringify(evidence));results.push(evidence);
    }finally{sim.dispose();}
  }
  t.diagnostic(JSON.stringify(results));
});

test('smooth moderate steering remains upright and grounded at 60 and 90 km/h for all models',t=>{
  const results=[];
  for(const kind of kinds)for(const kph of [60,90])for(const direction of [-1,1]){
    const sim=physicalWorld(kind),vehicle=sim.vehicle;
    try{
      settle(sim);vehicle.body.setLinvel({x:0,y:0,z:-kph/3.6},true);
      let maxTilt=0,minWheels=4;
      for(let i=0;i<180;i++){
        const pedals=vehicleTargetPedals(vehicle,{speed:kph/3.6,yawError:0});
        const angle=direction*.035*Math.min(1,i/60);
        stepVehiclePhysics(vehicle,commandWheelAngle(vehicle,angle,pedals));sim.world.step();
        const p=physicsSnapshot(vehicle);maxTilt=Math.max(maxTilt,p.pose.tilt);minWheels=Math.min(minWheels,p.pose.groundedWheels);
        assert.ok([p.x,p.z,p.speed,p.pose.y].every(Number.isFinite));
      }
      const final=physicsSnapshot(vehicle),evidence={kind,kph,direction,maxTiltDeg:rounded(maxTilt*180/Math.PI),minWheels,yaw:rounded(final.yaw)};
      assert.ok(maxTilt<20*Math.PI/180,JSON.stringify(evidence));assert.equal(minWheels,4,JSON.stringify(evidence));
      assert.ok(final.yaw*direction<-.15,JSON.stringify(evidence));results.push(evidence);
    }finally{sim.dispose();}
  }
  t.diagnostic(JSON.stringify(results));
});

test('identical initial speed and physical wheel angle expose lower rain/snow lateral capacity',t=>{
  const results=[];
  for(const kind of kinds){
    const capacities=[];
    for(const grip of [1,.78,.58]){
      const sim=physicalWorld(kind),vehicle=sim.vehicle;
      try{
        settle(sim);vehicle.body.setLinvel({x:0,y:0,z:-25},true);
        let sum=0,peak=0;
        for(let i=0;i<90;i++){
          const before=vehicle.body.linvel(),angle=.12*Math.min(1,i/30);
          stepVehiclePhysics(vehicle,commandWheelAngle(vehicle,angle),grip);sim.world.step();
          assert.ok(Math.abs(Math.abs(vehicle.controller.wheelSteering(0))-angle)<1e-6,'same actual wheel angle, not only the same key');
          const after=vehicle.body.linvel();
          // Acceleration perpendicular to the prior velocity: measures how
          // much the trajectory can actually turn, independently of body yaw.
          const lateral=Math.abs(before.x*(after.z-before.z)-before.z*(after.x-before.x))/Math.hypot(before.x,before.z)*60;
          if(i>=30)sum+=lateral;peak=Math.max(peak,lateral);
        }
        const car=physicsSnapshot(vehicle),average=sum/60;
        assert.ok(average>2&&average<12,'finite, plausible game tyre capacity');
        capacities.push({grip,average,peak,yaw:Math.abs(car.yaw)});
      }finally{sim.dispose();}
    }
    assert.ok(capacities[0].average>capacities[1].average*1.1&&capacities[1].average>capacities[2].average*1.1,JSON.stringify(capacities));
    assert.ok(capacities[0].yaw>capacities[1].yaw&&capacities[1].yaw>capacities[2].yaw,'less grip widens the same requested turn');
    results.push({kind,capacities:capacities.map(c=>Object.fromEntries(Object.entries(c).map(([k,v])=>[k,rounded(v)])))});
  }
  t.diagnostic(JSON.stringify(results));
});

test('a single damaged tyre reduces its real traction impulse while leaving the other tyre demands intact',t=>{
  const fields=['frontLeftGrip','frontRightGrip','rearLeftGrip','rearRightGrip'],results=[];
  const trial=field=>{
    const sim=physicalWorld(),vehicle=sim.vehicle;
    try{
      settle(sim);const damage=pristineDamage();if(field)damage[field]=0;
      stepVehiclePhysics(vehicle,{...neutral,throttle:1},1,damage);sim.world.step();
      return {impulses:Array.from({length:4},(_,i)=>Math.abs(vehicle.controller.wheelForwardImpulse(i))),speed:physicsSnapshot(vehicle).speed};
    }finally{sim.dispose();}
  };
  const healthy=trial(null);
  for(const [index,field] of fields.entries()){
    const damaged=trial(field);
    assert.ok(damaged.impulses[index]<healthy.impulses[index]*.6,field);
    for(let other=0;other<4;other++)if(other!==index)assert.ok(Math.abs(damaged.impulses[other]-healthy.impulses[other])<.02,`${field}: unrelated tyre changed`);
    assert.ok(damaged.speed<healthy.speed*.95&&damaged.speed>0,'damage reduces actual acceleration without immobilizing a healthy engine');
    results.push({field,impulses:damaged.impulses.map(rounded),speed:rounded(damaged.speed)});
  }
  t.diagnostic(JSON.stringify({healthy,damaged:results}));
});
