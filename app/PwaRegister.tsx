"use client";

import { useEffect } from "react";
import { publicPath } from "@/lib/publicPath";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      navigator.serviceWorker.register(publicPath("/sw.js")).catch(() => undefined);
    }
  }, []);
  return null;
}
