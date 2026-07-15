import { createContext, useContext } from "react";

export const THEMES = {
  default: { label: "Padrão", canvas: "#d7dbe2" },
  parchment: { label: "Pergaminho", canvas: "#d8c49a" },
  stone: { label: "Pedra", canvas: "#c3c9d2" },
  night: { label: "Céu noturno", canvas: "#232a3d" },
} as const;

export type ThemeName = keyof typeof THEMES;

export const ThemeCtx = createContext<ThemeName>("default");
export const useTheme = () => useContext(ThemeCtx);
export const canvasDot = (t: ThemeName) => THEMES[t]?.canvas ?? THEMES.default.canvas;
