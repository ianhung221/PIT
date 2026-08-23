import type { PursuitRole, RadioCommand } from "../types/game.ts";

export interface PursuitCoordinationInput {
  command?: RadioCommand | null; pitQualified: boolean; suspectStopped: boolean;
  suspectDriveable: boolean; playerDriveability: number;
}

export interface PursuitAssignments {
  player: PursuitRole; unit2: PursuitRole; unit3: PursuitRole;
  phase: "pursuit" | "pit-ready" | "containment" | "terminated";
}

export function coordinatePursuit(input: PursuitCoordinationInput): PursuitAssignments {
  if (input.command === "terminate") return { player: "primary", unit2: "secondary", unit3: "tertiary", phase: "terminated" };
  if (input.pitQualified && (input.suspectStopped || !input.suspectDriveable)) {
    return { player: "primary", unit2: "containment-front", unit3: "containment-rear", phase: "containment" };
  }
  if (input.playerDriveability < .36 || input.command === "take-primary") {
    return { player: "secondary", unit2: "primary", unit3: "tertiary", phase: "pursuit" };
  }
  if (input.command === "prepare-pit" || input.command === "move-up") {
    return { player: "primary", unit2: "secondary", unit3: "tertiary", phase: "pit-ready" };
  }
  return { player: "primary", unit2: "secondary", unit3: "tertiary", phase: "pursuit" };
}
