export type SceneId = "city" | "country" | "highway";
export type WeatherId = "clear" | "rain" | "snow";
export type TimeId = "day" | "night";
export type VehicleId = "patrol" | "interceptor" | "suv";
export type CameraMode = "chase" | "driver" | "auto";

export interface MissionConfig {
  scene: SceneId;
  weather: WeatherId;
  time: TimeId;
  vehicle: VehicleId;
}

export const WEATHER = {
  clear: { grip: 1, label: "晴朗", visibility: 1 },
  rain: { grip: 0.78, label: "暴雨", visibility: 0.82 },
  snow: { grip: 0.58, label: "降雪", visibility: 0.68 },
} as const;

export const VEHICLES = {
  patrol: { label: "巡邏轎車", acceleration: 16, maxSpeed: 43, steering: 1.8, mass: 1.05, width: 2.05, height: .65, length: 4.45, color: "#e8ecee" },
  interceptor: { label: "攔截跑車", acceleration: 20, maxSpeed: 52, steering: 2.05, mass: .9, width: 1.95, height: .55, length: 4.5, color: "#f1f2ed" },
  suv: { label: "警用 SUV", acceleration: 13, maxSpeed: 39, steering: 1.45, mass: 1.35, width: 2.15, height: .78, length: 4.6, color: "#d9dfe0" },
} as const;

export const SUSPECT = { mass: 1, width: 2, height: .62, length: 4.4, color: "#8d261b" } as const;

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
  auto: "自動跟車",
};
