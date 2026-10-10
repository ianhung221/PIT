import { readFileSync } from "node:fs";
import { Matrix4, Quaternion, Vector3 } from "three";
import { VEHICLE_VISUALS } from "../lib/gameConfig.ts";

export function measureVehicle(kind) {
  const asset = { patrol: "police", interceptor: "race", suv: "suv", suspect: "sedan-sports" }[kind];
  const data = readFileSync(`public/assets/kenney-car-kit/${asset}.glb`);
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength));
  const binary = data.subarray(28 + jsonLength);
  const visual = VEHICLE_VISUALS[kind];
  const outer = new Matrix4().compose(new Vector3(), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), visual.rotationY), new Vector3(...visual.scale));
  const points = [];
  const visit = (i, parent) => {
    const node = gltf.nodes[i];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation ?? [0, 0, 0])), new Quaternion(...(node.rotation ?? [0, 0, 0, 1])), new Vector3(...(node.scale ?? [1, 1, 1])));
    const transform = parent.clone().multiply(local);
    if (node.mesh !== undefined && !["spoiler", "wheel-back"].includes(node.name)) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION], view = gltf.bufferViews[accessor.bufferView];
        for (let v = 0; v < accessor.count; v++) {
          const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + v * (view.byteStride ?? 12);
          points.push(new Vector3(binary.readFloatLE(offset), binary.readFloatLE(offset + 4), binary.readFloatLE(offset + 8)).applyMatrix4(transform));
        }
      }
    }
    node.children?.forEach(child => visit(child, transform));
  };
  gltf.scenes[gltf.scene ?? 0].nodes.forEach(i => visit(i, outer));
  const front = Math.min(...points.map(p => p.z)), rear = Math.max(...points.map(p => p.z));
  const center = (front + rear) / 2, length = rear - front;
  const widths = [0, 1, 2].map(i => Math.max(...points.filter(p => p.z >= front + length * i / 3 - .001 && p.z <= front + length * (i + 1) / 3 + .001).map(p => Math.abs(p.x))) * 2);
  return { kind, length, width: Math.max(...widths), center, widths };
}
if (process.argv[1]?.endsWith("measure-vehicle-profile.mjs")) {
  for (const kind of ["patrol", "interceptor", "suv", "suspect"]) console.log(measureVehicle(kind));
}
