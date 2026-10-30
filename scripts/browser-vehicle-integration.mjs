import assert from 'node:assert/strict';

/** Exercise the shipped React scenes and their real keyboard/controller lifecycle.
 * Instrumentation observes Rapier; it never changes positions, velocities or PIT results. */
export async function verifyVehicleIntegration({evaluate,command,delay,capture,waitFor,practice=false}) {
  await evaluate(`(() => {
    const records=[];
    const locate=()=>{
      let context=null;const visited=new Set();
      function walk(f){if(!f||visited.has(f))return;visited.add(f);
        const value=f.memoizedProps?.value;
        if(value?.world?.step&&value?.beforeStepCallbacks&&value?.afterStepCallbacks)context=value;
        walk(f.child);walk(f.sibling);
      }for(const root of window.__pitRoots)walk(root.current);
      return context;
    };
    const cars=world=>{const result=[];world.vehicleControllers.forEach(c=>{
      const body=c.chassis(),position=body.translation(),velocity=body.linvel(),rotation=body.rotation();
      result.push({handle:body.handle,position:{...position},velocity:{...velocity},rotation:{...rotation},
        grounded:[0,1,2,3].filter(i=>c.wheelIsInContact(i)).length,steering:c.wheelSteering(0),colliders:body.numColliders()});
    });return result;};
    window.__pitVehicleIntegration={records,probe(){
      const context=locate();if(!context)return null;
      const world=context.world;
      let record=records.find(r=>r.world===world);
      if(!record){
        record={world,removed:0,freed:false,controllersAtFree:null,sampling:false,samples:[]};records.push(record);
        const remove=world.removeVehicleController,free=world.free;
        world.removeVehicleController=function(...args){record.removed++;return remove.apply(this,args);};
        const after={current:()=>{if(record.sampling)record.samples.push(cars(world));}};
        context.afterStepCallbacks.add(after);
        world.free=function(...args){record.controllersAtFree=world.vehicleControllers.size;record.freed=true;context.afterStepCallbacks.delete(after);return free.apply(this,args);};
      }
      const runtime=window.__pitInspect().runtime;let dynamic=0;
      world.bodies.forEach(body=>{if(body.isDynamic())dynamic++;});
      return {record:records.indexOf(record),controllers:world.vehicleControllers.size,dynamic,bodies:world.bodies.len(),colliders:world.colliders.len(),
        removed:record.removed,version:context.rapier.version(),cars:cars(world),elapsed:runtime.elapsed,
        phase:runtime.phase??runtime.result,player:runtime.player,suspect:runtime.suspect,supports:runtime.supports??[],driving:runtime.driving};
    }};
  })()`);
  const probe=()=>evaluate(`window.__pitVehicleIntegration.probe()`);
  const key=(value,type='keyDown')=>command('Input.dispatchKeyEvent',{type,key:value,code:value.length===1?'Key'+value.toUpperCase():value});
  const tap=async value=>{await key(value);await key(value,'keyUp');};
  const click=async label=>evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});if(!b)throw Error('Missing button: '+${JSON.stringify(label)});b.click();})()`);
  const advance=async seconds=>{
    const current=await probe();
    const deadline=Date.now()+45000;
    while((await evaluate(`window.__pitInspect().runtime?.elapsed??0`))<current.elapsed+seconds){
      if(Date.now()>deadline)throw Error('Actual scene stopped advancing during vehicle controls');
      await delay(25);
    }
  };
  const expected=practice?2:4;
  const verifyResources=state=>{
    assert.equal(state.version,'0.19.2');assert.equal(state.controllers,expected);assert.equal(state.dynamic,expected);
    assert.equal(state.cars.length,expected);assert.ok(state.cars.every(car=>car.colliders===4));
    if(practice){assert.equal(state.bodies,3);assert.equal(state.colliders,9);}
  };
  await waitFor(`window.__pitVehicleIntegration.probe()?.controllers===${expected}`,'vehicle-controllers');
  verifyResources(await probe());
  if(practice)await click('開始練習');
  await advance(.8);

  try {
    const begin=await probe();
    await evaluate(`(() => {const r=window.__pitVehicleIntegration.records[${begin.record}];r.samples=[];r.sampling=true;})()`);
    await advance(1.2);
    const observations=await evaluate(`(() => {const r=window.__pitVehicleIntegration.records[${begin.record}];r.sampling=false;return r.samples;})()`);
    assert.ok(observations.length>=30,'the real scene must advance enough fixed steps');
    for(const frame of observations)for(const car of frame){
      assert.ok([...Object.values(car.position),...Object.values(car.velocity),...Object.values(car.rotation)].every(Number.isFinite),'NaN in actual vehicle body');
      assert.ok(car.position.y>-.65&&car.position.y<.25,'vehicle fell through or bounced off the ground');
      assert.equal(car.grounded,4,'a vehicle lost a wheel on an ordinary straight road');
    }
    const spans=begin.cars.map(car=>{
      const heights=observations.flat().filter(sample=>sample.handle===car.handle).map(sample=>sample.position.y);
      return Math.max(...heights)-Math.min(...heights);
    });
    assert.ok(spans.every(span=>span<.06),'persistent vertical suspension bounce: '+JSON.stringify(spans));
    const aiBefore=(await probe());
    await key('ArrowUp');await advance(.65);
    const accelerating=await probe();
    assert.ok(accelerating.driving.input.up&&accelerating.driving.throttle>.25,'up key must reach the shared throttle');
    assert.ok(accelerating.player.speed>aiBefore.player.speed+.3,'up key must accelerate the actual chassis');
    await key('ArrowUp','keyUp');await advance(.2);
    await tap('f');await advance(.2);
    const cruise=await probe();assert.equal(cruise.driving.cruise,true,'ground support must not cancel cruise: '+JSON.stringify({player:cruise.player,driving:cruise.driving}));
    await advance(1);
    const beforeBrake=await probe();assert.equal(beforeBrake.driving.cruise,true,'cruise must remain active on the straight road: '+JSON.stringify(beforeBrake.driving));
    // Direction checks use forward low-speed driving. Full steering after a
    // long CDP poll at chase speed can induce a genuine spin/reverse slip.
    await key('ArrowDown');
    const brakeDeadline=Date.now()+30000;
    const steeringSpeed=Math.min(6,beforeBrake.player.speed-.8);
    while((await probe()).player.speed>steeringSpeed){
      if(Date.now()>brakeDeadline)throw Error('Could not brake to forward steering-test speed');
      await delay(25);
    }
    const braking=await probe();
    assert.ok(braking.driving.input.down&&!braking.driving.cruise,'down key must brake and cancel cruise');
    assert.ok(braking.player.speed<beforeBrake.player.speed-.3,'down key must slow the actual chassis');
    await key('ArrowDown','keyUp');await advance(.1);
    const turnBefore=await probe();
    assert.ok(turnBefore.player.speed>3&&turnBefore.player.speed<7,'steering fixture must start in forward low-speed motion');
    await key('ArrowLeft');await advance(.12);const left=await probe();await key('ArrowLeft','keyUp');
    assert.ok(left.driving.input.left&&left.driving.steering<-.3,'left key must steer left');
    assert.ok(left.player.yaw>turnBefore.player.yaw+.002,'left key must turn the actual chassis');
    await advance(.25);
    const rightBefore=await probe();assert.ok(rightBefore.player.speed>0,'right-turn fixture must still be driving forward');
    await key('ArrowRight');await advance(.3);const right=await probe();await key('ArrowRight','keyUp');
    assert.ok(right.driving.input.right&&right.driving.steering>.3,'right key must steer right');
    assert.ok(right.player.yaw<rightBefore.player.yaw-.002,'right key must turn the actual chassis: '+JSON.stringify({before:rightBefore.player,after:right.player,driving:right.driving}));
    const afterControls=await probe();
    assert.ok(Math.hypot(afterControls.suspect.x-aiBefore.suspect.x,afterControls.suspect.z-aiBefore.suspect.z)>10,'AI target must really drive');
    if(!practice)afterControls.supports.forEach((car,index)=>assert.ok(Math.hypot(car.x-aiBefore.supports[index].x,car.z-aiBefore.supports[index].z)>1,'support AI must drive'));
    verifyResources(afterControls);
    console.log('vehicle integration: actual scene controls', {mode:practice?'practice':'mission',fixedSamples:observations.length,heightSpans:spans,controllers:afterControls.controllers,
      steeringSpeed:turnBefore.player.speed,leftYawDelta:left.player.yaw-turnBefore.player.yaw,rightYawDelta:right.player.yaw-rightBefore.player.yaw});
    await capture(`vehicle-integration-${practice?'practice':'mission'}`);

    if(practice){
      const baseline=await probe();
      for(let cycle=0;cycle<20;cycle++){
        await click('重設練習');
        await waitFor(`(() => {const s=window.__pitVehicleIntegration.probe();return s?.phase==='ready'&&s.controllers===2&&s.removed>=${baseline.removed+(cycle+1)*2};})()`,'vehicle-reset');
        const state=await probe();verifyResources(state);assert.equal(state.elapsed,0);assert.equal(state.driving.cruise,false);
        assert.equal(state.removed,baseline.removed+(cycle+1)*2,'each reset disposes exactly two controllers');
      }
      for(let cycle=0;cycle<20;cycle++){
        const prior=await probe();await click('返回設定');
        await waitFor(`!!document.querySelector('.deploy-button')`,'vehicle-return-settings');
        const disposed=await evaluate(`(() => {const r=window.__pitVehicleIntegration.records[${prior.record}];return {freed:r.freed,controllersAtFree:r.controllersAtFree};})()`);
        assert.equal(disposed.freed,true,'scene exit must release the old Rapier world');assert.equal(disposed.controllersAtFree,0,'controllers must be removed before world.free');
        await click('PIT 練習');await delay(100);await evaluate(`document.querySelector('.deploy-button').click()`);
        await waitFor(`!!document.querySelector('.practice-start')&&window.__pitVehicleIntegration.probe()?.controllers===2`,'vehicle-reenter-practice');
        const state=await probe();verifyResources(state);assert.equal(state.phase,'ready');assert.ok(state.record>prior.record);
      }
      await capture('vehicle-integration-practice-restarted');
      console.log('vehicle integration: 20 resets and 20 full scene reentries passed without controller/body/collider leaks');
    }
  }finally{
    for(const value of ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','f'])await key(value,'keyUp');
  }
}
