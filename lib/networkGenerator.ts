import { createSeededRandom } from './seededRandom.ts';
import { networkCode, NETWORK_VERSION, parseMapCode, networkIndex, otherEnd, type RoadNetwork, type NetworkNode } from './roadNetwork.ts';
import type { SceneId } from './gameConfig.ts';

/** Constrained layouts keep intersections explicit. Decoration has its own RNG. */
export function generateNetwork(code: string): RoadNetwork {
  const parsed = parseMapCode(code);
  if (parsed.kind !== 'valid') throw new Error(parsed.message);
  const seed = parsed.seed, random = createSeededRandom(`network-${NETWORK_VERSION}:${seed}`);
  const decor = createSeededRandom(`decor-${NETWORK_VERSION}:${seed}`);
  const network: RoadNetwork = { version: NETWORK_VERSION, seed, code: networkCode(seed), nodes: [], edges: [], towns: [], objects: [],
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 }, spawn: { edge: '', from: '', distance: 0 } };
  const addNode = (id: string, x: number, z: number): NetworkNode => { const n = { id, x, z, radius: 16 }; network.nodes.push(n); return n; };
  const addEdge = (a: NetworkNode, b: NetworkNode, biome: SceneId) => {
    const edge = { id: `e${network.edges.length}`, a: a.id, b: b.id, biome, width: biome === 'highway' ? 22 : biome === 'city' ? 16 : 12,
      length: Math.hypot(b.x - a.x, b.z - a.z) };
    network.edges.push(edge); return edge;
  };
  const separation = 1250 + Math.floor(random() * 400), block = 110 + Math.floor(random() * 35);
  const count = random() < .5 ? 2 : 3;
  const rowCount = random() < .5 ? 3 : 4;
  const centers = [{ x: -separation / 2, z: 0 }, { x: separation / 2, z: 0 }, { x: 0, z: 1050 + Math.floor(random() * 180) }].slice(0, count);
  const ports: { north: NetworkNode; south: NetworkNode; west: NetworkNode; east: NetworkNode }[] = [];
  for (let town = 0; town < count; town++) {
    const center = centers[town], rows = town === 2 ? 3 : rowCount;
    const grid: NetworkNode[][] = [];
    for (let z = 0; z < rows; z++) {
      grid[z] = [];
      for (let x = 0; x < 3; x++) grid[z][x] = addNode(`t${town}-${x}-${z}`, center.x + (x - 1) * block, center.z + (z - (rows - 1) / 2) * block);
    }
    for (let z = 0; z < rows; z++) for (let x = 0; x < 3; x++) {
      if (x < 2) addEdge(grid[z][x], grid[z][x + 1], 'city');
      // Boundary ring remains connected; one optional inner street changes routes.
      if (z < rows - 1 && (x !== 1 || random() > .28)) addEdge(grid[z][x], grid[z + 1][x], 'city');
    }
    ports.push({ north: grid[0][1], south: grid[rows - 1][1], west: grid[1][0], east: grid[1][2] });
    network.towns.push({ id: `town-${town}`, name: ['楓橋鎮', '松原鎮', '河谷鎮'][town], ...center, width: block * 2, depth: block * (rows - 1), police: { x: center.x - block / 2, z: grid[0][0].z + block / 2 } });
    for (let z = 0; z < rows - 1; z++) for (let x = 0; x < 2; x++) {
      const cx = grid[z][x].x + block / 2, cz = grid[z][x].z + block / 2;
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
        network.objects.push({ id: `building-${town}-${x}-${z}-${sideX}-${sideZ}`, kind: 'building', x: cx + sideX * block * .18, z: cz + sideZ * block * .18,
          halfX: 9 + decor() * 5, halfZ: 9 + decor() * 5, height: town === 0 ? 10 + decor() * 15 : 5 + decor() * 8, color: town === 0 ? '#53636b' : '#767164' });
      }
    }
  }
  // Country connection uses the facing mid-row ports (same Z for the first two towns).
  addEdge(ports[0].east, ports[1].west, 'country');
  const highwayZ = -650 - Math.floor(random() * 170), lowerZ = 520 + Math.floor(random() * 90);
  const highwayLeft = addNode('highway-left', centers[0].x, highwayZ);
  const highwayRight = addNode('highway-right', centers[1].x, highwayZ);
  const highwayOuterLeft = addNode('highway-outer-left', centers[0].x - 420, highwayZ);
  const highwayOuterRight = addNode('highway-outer-right', centers[1].x + 420, highwayZ);
  addEdge(highwayOuterLeft, highwayLeft, 'highway'); addEdge(highwayLeft, highwayRight, 'highway'); addEdge(highwayRight, highwayOuterRight, 'highway');
  addEdge(ports[0].north, highwayLeft, 'country'); addEdge(ports[1].north, highwayRight, 'country');
  const lowerLeft = addNode('country-left', centers[0].x, lowerZ), lowerRight = addNode('country-right', centers[1].x, lowerZ);
  const lowerCenter = addNode('country-center', 0, lowerZ);
  addEdge(ports[0].south, lowerLeft, 'country'); addEdge(ports[1].south, lowerRight, 'country');
  addEdge(lowerLeft, lowerCenter, 'country'); addEdge(lowerCenter, lowerRight, 'country');
  // Outer bypasses close the highway into the regional network without highway crossroads.
  const outerLeft = addNode('outer-left', highwayOuterLeft.x, lowerZ), outerRight = addNode('outer-right', highwayOuterRight.x, lowerZ);
  addEdge(highwayOuterLeft, outerLeft, 'country'); addEdge(outerLeft, lowerLeft, 'country');
  addEdge(highwayOuterRight, outerRight, 'country'); addEdge(outerRight, lowerRight, 'country');
  if (count === 3) {
    addEdge(lowerCenter, ports[2].north, 'country');
    const southZ = centers[2].z + block + 230;
    const south = addNode('south', 0, southZ), southEast = addNode('south-east', outerRight.x, southZ);
    addEdge(ports[2].south, south, 'country'); addEdge(south, southEast, 'country'); addEdge(southEast, outerRight, 'country');
  }
  const index = networkIndex(network);
  for(let i=0;i<network.towns.length;i++)network.objects.push({id:`sign-${i}`,kind:'sign',label:network.towns[i].name,x:ports[i].north.x+19,z:ports[i].north.z-40,halfX:1.6,halfZ:.15,height:2.4,color:'#246553'});
  for (const edge of network.edges.filter(e => e.biome === 'country')) {
    const a = index.nodes.get(edge.a)!, b = index.nodes.get(edge.b)!;
    for (let d = 65; d < edge.length - 50; d += 90) {
      if (decor() < .45) continue;
      const t = d / edge.length, side = decor() < .5 ? -1 : 1;
      network.objects.push({ id: `tree-${edge.id}-${d}`, kind: 'tree', x: a.x + (b.x - a.x) * t + (b.z - a.z) / edge.length * 23 * side,
        z: a.z + (b.z - a.z) * t - (b.x - a.x) / edge.length * 23 * side, halfX: .45, halfZ: .45, height: 6 + decor() * 3, color: '#27523a' });
    }
  }
  network.bounds = { minX: Math.min(...network.nodes.map(n => n.x)) - 100, maxX: Math.max(...network.nodes.map(n => n.x)) + 100,
    minZ: Math.min(...network.nodes.map(n => n.z)) - 100, maxZ: Math.max(...network.nodes.map(n => n.z)) + 100 };
  const start = network.edges.find(e => e.a === ports[0].east.id && e.b === ports[1].west.id)!;
  network.spawn = { edge: start.id, from: start.a, distance: 80 };
  validateNetwork(network);
  return network;
}

export function validateNetwork(network: RoadNetwork) {
  const index = networkIndex(network);
  if (index.nodes.size !== network.nodes.length || index.edges.size !== network.edges.length) throw Error('Duplicate network IDs');
  const reached = new Set([network.nodes[0]?.id]), queue = [...reached];
  for (let i = 0; i < queue.length; i++) for (const edge of index.exits.get(queue[i]) ?? []) {
    const next = otherEnd(edge, queue[i]); if (!reached.has(next)) { reached.add(next); queue.push(next); }
  }
  if (reached.size !== network.nodes.length) throw Error('Disconnected road network');
  for (const node of network.nodes) if (![node.x, node.z, node.radius].every(Number.isFinite) || (index.exits.get(node.id)?.length ?? 0) < 2) throw Error('Invalid or stranded node');
  for (const edge of network.edges) {
    const a = index.nodes.get(edge.a), b = index.nodes.get(edge.b);
    if (!a || !b || edge.length < a.radius + b.radius + 30 || !(edge.width >= 12)) throw Error('Invalid road edge');
    if (a.x !== b.x && a.z !== b.z) throw Error('Layout roads must be axis aligned');
  }
  // Crossing unrelated edges is not a junction. Reject it rather than drawing an accidental crossing.
  for (let i = 0; i < network.edges.length; i++) for (let j = i + 1; j < network.edges.length; j++) {
    const e = network.edges[i], f = network.edges[j];
    if ([e.a, e.b].some(id => id === f.a || id === f.b)) continue;
    const a = index.nodes.get(e.a)!, b = index.nodes.get(e.b)!, c = index.nodes.get(f.a)!, d = index.nodes.get(f.b)!;
    const xOverlap = Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x)) - Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x));
    const zOverlap = Math.min(Math.max(a.z,b.z),Math.max(c.z,d.z)) - Math.max(Math.min(a.z,b.z),Math.min(c.z,d.z));
    if (xOverlap >= 0 && zOverlap >= 0) throw Error('Unconnected road crossing');
  }
}
