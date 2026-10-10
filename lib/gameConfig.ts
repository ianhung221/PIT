export type SceneId = "city" | "country" | "highway";
export type WeatherId = "clear" | "rain" | "snow";
export type TimeId = "day" | "night";
export type VehicleId = "patrol" | "interceptor" | "suv";
export type CameraMode = "chase" | "driver" | "auto";
export type QualityId = "low" | "medium" | "high";

export interface MissionConfig {
  scene: SceneId;
  weather: WeatherId;
  time: TimeId;
  vehicle: VehicleId;
  seed?: string;
  quality?: QualityId;
}

export const WEATHER = {
  clear: { grip: 1, label: "晴朗", visibility: 1 },
  rain: { grip: 0.78, label: "暴雨", visibility: 0.82 },
  snow: { grip: 0.58, label: "降雪", visibility: 0.68 },
} as const;

export const VEHICLES = {
  patrol: { label: "巡邏轎車", acceleration: 16, maxSpeed: 43, steering: 1.8, mass: 1.05, width: 2.025, height: .65, length: 4.712, color: "#e8ecee" },
  interceptor: { label: "攔截跑車", acceleration: 20, maxSpeed: 52, steering: 2.05, mass: .9, width: 2.106, height: .55, length: 4.5052, color: "#f1f2ed" },
  suv: { label: "警用 SUV", acceleration: 13, maxSpeed: 39, steering: 1.45, mass: 1.35, width: 2.145, height: .78, length: 4.59, color: "#d9dfe0" },
} as const;

export const SUSPECT = { mass: 1, width: 1.95, height: .62, length: 4.386, color: "#8d261b" } as const;

// Measured transformed GLB body/wheels; tiny roof accessories are not colliders.
// Equal strip masses keep the original total mass and planar center of mass.
export const VEHICLE_PROFILES = {
  patrol: { positionZ: 0, widths: [2.025, 1.755, 1.755] },
  interceptor: { positionZ: 0, widths: [2.106, 2.106, 2.106] },
  suv: { positionZ: .135, widths: [2.145, 2.145, 1.859] },
  suspect: { positionZ: -.043, widths: [1.95, 1.95, 1.95] },
} as const;

export function vehicleColliderStrips(kind: VehicleId | "suspect") {
  const spec = kind === "suspect" ? SUSPECT : VEHICLES[kind];
  return VEHICLE_PROFILES[kind].widths.map((width, i) => ({
    halfWidth: width / 2, halfLength: spec.length / 6,
    z: (i - 1) * spec.length / 3, mass: spec.mass / 3,
  }));
}

export const VEHICLE_VISUALS = {
  patrol: { scale: [1.35, 1, 1.52] as [number, number, number], rotationY: Math.PI, positionY: -.18 },
  interceptor: { scale: [1.62, 1.2, 1.76] as [number, number, number], rotationY: Math.PI, positionY: -.18 },
  suv: { scale: [1.43, 1.12, 1.8] as [number, number, number], rotationY: Math.PI, positionY: -.18 },
  suspect: { scale: [1.5, 1.08, 1.72] as [number, number, number], rotationY: Math.PI, positionY: -.18 },
} as const satisfies Record<VehicleId | "suspect", {
  scale: [number, number, number];
  rotationY: number;
  positionY: number;
}>;

export const PIT_RULES = {
  rearZoneStart: .28,
  sideZoneStart: .52,
  minClosingSpeed: 1.5,
  maxClosingSpeed: 18,
  maxHeadingDelta: Math.PI * 35 / 180,
  requiredYawChange: Math.PI * 55 / 180,
  requiredSpeedDrop: .35,
  evaluationWindow: 2.5,
} as const;

export const SCENES = {
  city: { label: "城市街區", roadWidth: 15, aiSpeed: 31, ground: "#202427", fogDay: "#87919a", fogNight: "#071018" },
  country: { label: "鄉間公路", roadWidth: 11, aiSpeed: 34, ground: "#18251c", fogDay: "#9aa58d", fogNight: "#08110b" },
  highway: { label: "州際高速", roadWidth: 19, aiSpeed: 39, ground: "#242829", fogDay: "#9ba8ad", fogNight: "#081118" },
} as const;

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: "後方追蹤",
  driver: "駕駛視角",
  auto: "直升機視角",
};

export const CAMERA_SETTINGS = {
  mirrorFrameSkip: 2,
  mirrorFar: 95,
  helicopterMinHeight: 14,
  helicopterMaxHeight: 72,
  helicopterFocusDistance: 90,
  helicopterSupportRadius: 70,
} as const;

export const QUALITY_SETTINGS = {
  low: { label: "低", dpr: [1, 1] as [number, number], mirrorScale: .5, mirrorFrameSkip: 5, sideMirrors: false },
  medium: { label: "中", dpr: [1, 1.25] as [number, number], mirrorScale: .72, mirrorFrameSkip: 3, sideMirrors: true },
  high: { label: "高", dpr: [1, 1.45] as [number, number], mirrorScale: 1, mirrorFrameSkip: 2, sideMirrors: true },
} as const;
