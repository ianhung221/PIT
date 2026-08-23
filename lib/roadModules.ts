import type { SceneId } from "./gameConfig.ts";

export const ROAD_MODULES = {
  city: [
    { kind: "straight", turn: 0, risk: .72 },
    { kind: "curve", turn: .045, risk: .82 },
    { kind: "curve", turn: -.045, risk: .82 },
    { kind: "junction", turn: .025, risk: .9 },
  ],
  country: [
    { kind: "straight", turn: 0, risk: .3 },
    { kind: "curve", turn: .035, risk: .46 },
    { kind: "curve", turn: -.035, risk: .46 },
    { kind: "curve", turn: .06, risk: .58 },
  ],
  highway: [
    { kind: "straight", turn: 0, risk: .24 },
    { kind: "curve", turn: .018, risk: .32 },
    { kind: "curve", turn: -.018, risk: .32 },
    { kind: "junction", turn: .012, risk: .48 },
  ],
} as const satisfies Record<SceneId, readonly { kind: "straight" | "curve" | "junction"; turn: number; risk: number }[]>;

export const BIOME_ORDER: SceneId[] = ["city", "country", "highway"];
