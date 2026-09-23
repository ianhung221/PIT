import type { PursuitRole, RadioCommand, RadioFeedback } from "../types/game.ts";

export const ROLE_LABELS: Record<PursuitRole, string> = { primary: "主追", secondary: "第二順位", tertiary: "第三順位", "containment-front": "車頭封鎖", "containment-rear": "車尾封鎖" };
export const COMMAND_LABELS: Record<RadioCommand, string> = { "request-pit": "請求 PIT 授權", "prepare-pit": "準備執行 PIT", "move-up": "第二單位靠近", "block-front": "封鎖嫌犯車頭", "take-primary": "接替主追單位", terminate: "終止追逐" };
export const RADIO_PHASE_LABELS = { received: "已接收", executing: "執行中", completed: "完成", unable: "暫時無法執行" };

export function nextTacticalCommand(current: RadioCommand | null, received: RadioCommand): RadioCommand | null {
  return received === "request-pit" ? current : received;
}
export function tacticalFeedback(command: RadioCommand, suspectStopped: boolean, arrived: boolean, recovering: boolean): Pick<RadioFeedback, "phase" | "message"> {
  if (command === "block-front" && !suspectStopped) return { phase: "unable", message: "條件不足，等待嫌犯減速；後援維持追蹤" };
  if (recovering) return { phase: "executing", message: "後援受阻，正在倒車脫困後繼續執行" };
  if (arrived) return { phase: "completed", message: command === "take-primary" ? "02 已到主追位置；Q2 可交回玩家主追" : "後援已到指定位置，持續維持隊形" };
  return { phase: "executing", message: "後援正沿道路前往指定位置" };
}

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
  if (input.command === "block-front" && input.suspectStopped) {
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
