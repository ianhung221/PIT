"use client";

import { useEffect, useState } from "react";
import type { RadioCommand } from "@/types/game";

const COMMANDS: { id: RadioCommand; label: string; key: string }[] = [
  { id: "request-pit", label: "請求 PIT 授權", key: "1" },
  { id: "prepare-pit", label: "準備執行 PIT", key: "2" },
  { id: "move-up", label: "第二單位靠近", key: "3" },
  { id: "block-front", label: "封鎖嫌犯車頭", key: "4" },
  { id: "take-primary", label: "接替主追單位", key: "5" },
  { id: "terminate", label: "終止追逐", key: "6" },
];

export function RadioCommandWheel({ disabled, onCommand }: { disabled?: boolean; onCommand: (command: RadioCommand) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (disabled) return;
      if (event.key.toLowerCase() === "q") { event.preventDefault(); setOpen(true); }
      if (event.key >= "1" && event.key <= "6") { setSelected(Number(event.key) - 1); if (open) onCommand(COMMANDS[Number(event.key) - 1].id); }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "q") setOpen(false);
    };
    window.addEventListener("keydown", down, { passive: false });
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [disabled, onCommand, open]);
  return <>
    <button className="radio-trigger" type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen((value) => !value)}><kbd>Q</kbd><span>無線電指令</span></button>
    {open && !disabled && <section className="radio-wheel" aria-label="無線電指令圓盤"><div className="radio-wheel__center"><small>DISPATCH</small><strong>選擇指令</strong></div>{COMMANDS.map((command, index) => <button key={command.id} className={selected === index ? "active" : ""} style={{ "--index": index } as React.CSSProperties} onMouseEnter={() => setSelected(index)} onClick={() => { onCommand(command.id); setOpen(false); }}><kbd>{command.key}</kbd><span>{command.label}</span></button>)}</section>}
  </>;
}
