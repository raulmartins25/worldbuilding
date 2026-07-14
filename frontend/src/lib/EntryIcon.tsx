import type { CSSProperties, ReactElement } from "react";
import type { EntryType } from "./types";

// silhuetas SVG por tipo (viewBox 24x24, herdam a cor via currentColor)
const ICONS: Record<EntryType, ReactElement> = {
  character: (
    <><circle cx="12" cy="7" r="4" /><path d="M12 13c-4.4 0-8 2.6-8 7h16c0-4.4-3.6-7-8-7z" /></>
  ),
  location: (
    // torre com ameias
    <path d="M7 22V8h1V5h2V3h1v2h2V3h1v2h2v3h1v14z" />
  ),
  region: (
    // castelo / muralha com ameias
    <path d="M2 22V9h2V6h2v3h2V6h2v3h4V6h2v3h2V6h2v3h2v13z" />
  ),
  faction: (
    // escudo
    <path d="M12 2l8 3v6c0 5.2-3.4 9.4-8 11-4.6-1.6-8-5.8-8-11V5z" />
  ),
  item: (
    // gema
    <path d="M5 3h14l3 6-10 12L2 9z" />
  ),
  magic_system: (
    // brilho de 4 pontas
    <path d="M12 2c.6 4.8 2.2 6.4 7 7-4.8.6-6.4 2.2-7 7-.6-4.8-2.2-6.4-7-7 4.8-.6 6.4-2.2 7-7z" />
  ),
  species: (
    // pata
    <><circle cx="6" cy="11" r="1.9" /><circle cx="9.7" cy="7" r="1.9" /><circle cx="14.3" cy="7" r="1.9" /><circle cx="18" cy="11" r="1.9" /><path d="M12 12.5c-2.9 0-5 1.9-5 4.2 0 1.9 1.7 2.8 5 2.8s5-.9 5-2.8c0-2.3-2.1-4.2-5-4.2z" /></>
  ),
  creature: (
    // garras (marcas de fera)
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M7 3c.6 5 1.1 9 1.5 16" /><path d="M12 2.5c0 5.5 0 10.5 0 16.5" /><path d="M17 3c-.6 5-1.1 9-1.5 16" />
    </g>
  ),
  deity: (
    // sol radiante
    <>
      <circle cx="12" cy="12" r="4.5" />
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
      </g>
    </>
  ),
  religion: (
    // templo
    <path d="M12 2 2 7.5h20zM4 9h2v8H4zm5 0h2v8H9zm4 0h2v8h-2zm5 0h2v8h-2zM3 18h18v2.5H3z" />
  ),
  event: (
    // raio
    <path d="M13 2 4 13h5l-2 9 10-12h-6z" />
  ),
  lore: (
    // livro aberto
    <path d="M12 6C9.5 4.3 6.5 3.5 3 3.5v14c3.5 0 6.5.8 9 2.5 2.5-1.7 5.5-2.5 9-2.5v-14c-3.5 0-6.5.8-9 2.5z" />
  ),
  language: (
    // balão de fala
    <path d="M4 4h16a1 1 0 011 1v9a1 1 0 01-1 1H9l-4 4v-4H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
  ),
  scene: (
    // claquete
    <>
      <path d="M3 9h18v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
      <path d="M3.5 8.5 4.6 4l3 1 .9-2.2 3 1 .9-2.2 3 1 .9-2.2 3 1-1.1 4.4z" />
    </>
  ),
  chapter: (
    // pergaminho
    <>
      <rect x="6" y="5" width="12" height="14" rx="1" />
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M6 5a2 2 0 00-2 2 2 2 0 002 2" /><path d="M18 19a2 2 0 002-2 2 2 0 00-2-2" />
      </g>
    </>
  ),
  note: (
    // página com dobra
    <>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
};

export function EntryIcon({ type, size = 24, color, style }: { type: string; size?: number; color?: string; style?: CSSProperties }) {
  const inner = ICONS[type as EntryType] ?? <circle cx="12" cy="12" r="7" />;
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size}
      fill="currentColor" xmlns="http://www.w3.org/2000/svg"
      style={{ color, display: "block", flexShrink: 0, ...style }}
      aria-hidden
    >
      {inner}
    </svg>
  );
}
