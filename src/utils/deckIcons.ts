// Curated icon set for QBR callout panels and KPI tiles.
// SVG inner markup is hardcoded (lucide 0.x paths) so no react-dom/server needed at runtime.
// The data URL approach lets us embed icons directly in PptxGenJS addImage calls.

export interface DeckIcon {
  name: string;
  label: string;
  svg: string; // inner SVG elements (no <svg> wrapper)
}

export const CALLOUT_ICONS: DeckIcon[] = [
  // ── Trends ────────────────────────────────────────────────────────────────
  { name: 'TrendingUp',     label: 'Trending Up',   svg: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>' },
  { name: 'TrendingDown',   label: 'Trending Down', svg: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>' },
  { name: 'BarChart2',      label: 'Bar Chart',     svg: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
  { name: 'Activity',       label: 'Activity',      svg: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
  { name: 'ArrowUp',        label: 'Arrow Up',      svg: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>' },
  { name: 'ArrowDown',      label: 'Arrow Down',    svg: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>' },

  // ── Logistics ─────────────────────────────────────────────────────────────
  { name: 'Package',        label: 'Package',       svg: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>' },
  { name: 'Truck',          label: 'Truck',         svg: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>' },
  { name: 'MapPin',         label: 'Location',      svg: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>' },
  { name: 'Globe',          label: 'Globe',         svg: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>' },
  { name: 'Navigation',     label: 'Navigate',      svg: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>' },
  { name: 'Box',            label: 'Box',           svg: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' },

  // ── Finance ───────────────────────────────────────────────────────────────
  { name: 'DollarSign',     label: 'Dollar',        svg: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
  { name: 'CreditCard',     label: 'Credit Card',   svg: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>' },
  { name: 'Wallet',         label: 'Wallet',        svg: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>' },
  { name: 'ArrowUpRight',   label: 'Increase',      svg: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>' },
  { name: 'ArrowDownRight', label: 'Decrease',      svg: '<line x1="7" y1="7" x2="17" y2="17"/><polyline points="17 7 17 17 7 17"/>' },

  // ── Alerts / Status ───────────────────────────────────────────────────────
  { name: 'AlertCircle',    label: 'Alert',         svg: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' },
  { name: 'AlertTriangle',  label: 'Warning',       svg: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>' },
  { name: 'CheckCircle',    label: 'Success',       svg: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' },
  { name: 'Zap',            label: 'Urgent',        svg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
  { name: 'Bell',           label: 'Alert Bell',    svg: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>' },
  { name: 'Flag',           label: 'Flag',          svg: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>' },

  // ── Achievement ───────────────────────────────────────────────────────────
  { name: 'Award',          label: 'Award',         svg: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>' },
  { name: 'Star',           label: 'Star',          svg: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
  { name: 'Target',         label: 'Target',        svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
];

const ICON_MAP = new Map(CALLOUT_ICONS.map(i => [i.name, i]));

export function getCalloutIcon(name: string): DeckIcon | undefined {
  return ICON_MAP.get(name);
}

/** Returns a data URL (SVG) for embedding in PptxGenJS addImage or as an <img> src. */
export function getIconDataUrl(iconName: string, color = '#ffffff', size = 40): string {
  const icon = ICON_MAP.get(iconName);
  if (!icon) return '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon.svg}</svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
