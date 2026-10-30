import {RAPIER,physicalWorld,physicsSnapshot} from '../tests/helpers/vehicle-world.mjs';
await RAPIER.init();
for(const kind of ['patrol','interceptor','suv','suspect']) {
 const s=physicalWorld(kind);
 for(let i=0;i<1800;i++)s.step();
 console.log(kind,'rest',JSON.stringify(physicsSnapshot(s.vehicle)), 'mass',s.vehicle.body.mass());
 for(let i=0;i<120;i++)s.step({throttle:.3,brake:0,steer:0,gear:1});
 console.log('forward',JSON.stringify(physicsSnapshot(s.vehicle)));
 for(let i=0;i<120;i++)s.step({throttle:.1,brake:0,steer:1,gear:1});
 console.log('right',JSON.stringify(physicsSnapshot(s.vehicle)));
 s.dispose();
}
