import type { SceneId } from './gameConfig.ts';
import type { RoadPoint } from './roadGeometry.ts';

export const NETWORK_VERSION = 1;
export interface NetworkNode extends RoadPoint { id: string; radius: number }
export interface NetworkEdge { id: string; a: string; b: string; width: number; biome: SceneId; length: number }
export interface NetworkTown extends RoadPoint { id: string; name: string; width: number; depth: number; police: RoadPoint }
export interface NetworkObject extends RoadPoint { id: string; kind: 'building' | 'tree' | 'sign'; halfX: number; halfZ: number; height: number; color: string; label?:string }
export interface RoadNetwork {
  version: number; seed: string; code: string;
  nodes: NetworkNode[]; edges: NetworkEdge[]; towns: NetworkTown[]; objects: NetworkObject[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn: { edge: string; from: string; distance: number };
}
export const networkCode = (seed: string) => `NET${NETWORK_VERSION}:${seed}`;
export type MapCodeResult = { kind: 'valid'; seed: string; code: string } | { kind: 'legacy'; seed: string; message: string } | { kind: 'invalid'; message: string };
export function parseMapCode(value: string): MapCodeResult {
  const input = value.trim().toUpperCase();
  const legacy = /^(CITY|COUNTRY|HIGHWAY)-(.+)$/.exec(input);
  if (legacy) return { kind: 'legacy', seed: legacy[2], message: '這是舊版單一道路代碼；可用原種子建立新版地圖，但道路排列會不同。' };
  const version = /^NET(\d+):(.*)$/.exec(input);
  if (version && Number(version[1]) !== NETWORK_VERSION) return { kind: 'invalid', message: '目前不支援這個地圖版本。' };
  const seed = version ? version[2] : input;
  if (!/^[A-Z0-9_-]{1,48}$/.test(seed)) return { kind: 'invalid', message: '請輸入 1～48 個英文字母、數字、連字號或底線。' };
  return { kind: 'valid', seed, code: networkCode(seed) };
}
type NetworkIndex={nodes:Map<string,NetworkNode>;edges:Map<string,NetworkEdge>;exits:Map<string,NetworkEdge[]>;edgeNumbers:Map<string,number>;cells:Map<string,NetworkEdge[]>};
const indexes=new WeakMap<RoadNetwork,NetworkIndex>();
export function networkIndex(network: RoadNetwork):NetworkIndex {
  const cached=indexes.get(network);if(cached&&cached.nodes.size===network.nodes.length&&cached.edges.size===network.edges.length)return cached;
  const nodes = new Map(network.nodes.map(n => [n.id, n]));
  const edges = new Map(network.edges.map(e => [e.id, e]));
  const exits = new Map(network.nodes.map(n => [n.id, [] as NetworkEdge[]]));
  for (const edge of network.edges) { exits.get(edge.a)!.push(edge); exits.get(edge.b)!.push(edge); }
  const edgeNumbers=new Map(network.edges.map((e,i)=>[e.id,i])),cells=new Map<string,NetworkEdge[]>();
  for(const edge of network.edges){
    const a=nodes.get(edge.a)!,b=nodes.get(edge.b)!;
    // Every edge within 32 m is included, even at a cell boundary.
    for(let x=Math.floor((Math.min(a.x,b.x)-32)/128);x<=Math.floor((Math.max(a.x,b.x)+32)/128);x++)
      for(let z=Math.floor((Math.min(a.z,b.z)-32)/128);z<=Math.floor((Math.max(a.z,b.z)+32)/128);z++){
        const key=`${x},${z}`,list=cells.get(key)??[];list.push(edge);cells.set(key,list);
      }
  }
  const result={ nodes, edges, exits,edgeNumbers,cells };indexes.set(network,result);return result;
}
export function nearbyNetworkEdges(network:RoadNetwork,x:number,z:number){return networkIndex(network).cells.get(`${Math.floor(x/128)},${Math.floor(z/128)}`)??[];}
export const otherEnd = (edge: NetworkEdge, node: string) => edge.a === node ? edge.b : edge.a;
