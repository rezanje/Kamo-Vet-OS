"use client";
import { useEffect } from "react";

/** Capture before the browser's default stepping; never cancel page scrolling. */
export function NumericInputSafety() {
  useEffect(() => {
    const protect = (event: WheelEvent) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.type === "number" && document.activeElement === input) input.blur();
    };
    document.addEventListener("wheel", protect, { capture: true, passive: true });
    return () => document.removeEventListener("wheel", protect, true);
  }, []);
  return null;
}
