import PptxGenJS from 'pptxgenjs';
import type { QBRDeckDocumentProps, DeckSectionKey, DeckSectionToggle, CustomDeckSlide, DataInstanceSlide } from '../components/pdf/QBRDeckDocument';
import type { MonthlyStatRow } from './statsParser';
import { dedupeWarehouseRows, formatMonth } from './statsParser';
import shipheroWhiteUrl from '../assets/logos/shiphero-white.png';
import { getIconDataUrl } from './deckIcons';
import { COVER_COLOR_SCHEMES } from '../components/QBRDeckBuilder';
import { applyKpiFilter } from './kpiSlideStats';

// ── Brand palette (no '#') ─────────────────────────────────────────────────────
const C = {
  NAVY:     '252F3E',
  ORANGE:   'EF5252',
  BLUE:     '4472E8',
  DARK:     '1C1C2E',
  GRAY:     '6B7280',
  WHITE:    'FFFFFF',
  LIGHT_BG: 'EDEEF2',
  LIGHT:    'F0F1F3',
  GREEN:    '22C55E',
  RED:      'EF4444',
};

// ── Slide dimensions ───────────────────────────────────────────────────────────
const W = 10;      // inches
const H = 5.625;   // inches

// Set by generateQBRDeck before calling builders; controls section label font size
let _sectionLabelFontSize = 8;

// Body content starts here on most slides (title ends ~0.88", then 1" gap to center body)
const BODY_Y      = 1.95;  // standard body start Y — vertically centered after title
const BODY_Y_WIDE = 1.35;  // for dense slides (Rate Card with 8 zones)

// ── Image helpers ─────────────────────────────────────────────────────────────
/** Parse natural pixel dimensions from a PNG or JPEG base64 data-URL. */
function readImageSize(dataUrl: string): { w: number; h: number } | null {
  try {
    const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    const bin = atob(b64);
    const byte = (i: number) => bin.charCodeAt(i) & 0xFF;
    // PNG: signature 0x89 'P''N''G', IHDR width/height at bytes 16-23
    if (byte(0) === 137 && bin[1] === 'P' && bin[2] === 'N' && bin[3] === 'G') {
      const pw = (byte(16) << 24) | (byte(17) << 16) | (byte(18) << 8) | byte(19);
      const ph = (byte(20) << 24) | (byte(21) << 16) | (byte(22) << 8) | byte(23);
      return { w: pw >>> 0, h: ph >>> 0 };
    }
    // JPEG: scan for SOF0-SOF3 markers (0xFF 0xC0-0xC3)
    let i = 2;
    while (i < bin.length - 8) {
      if (byte(i) !== 0xFF) break;
      const m = byte(i + 1);
      if (m >= 0xC0 && m <= 0xC3) {
        return { w: (byte(i + 7) << 8) | byte(i + 8), h: (byte(i + 5) << 8) | byte(i + 6) };
      }
      i += 2 + ((byte(i + 2) << 8) | byte(i + 3));
    }
  } catch { /* ignore malformed data */ }
  return null;
}

/** Fit an image inside a bounding box preserving aspect ratio, centered. */
function fitImage(
  imgW: number, imgH: number,
  bx: number, by: number, bw: number, bh: number,
): { x: number; y: number; w: number; h: number } {
  const ir = imgW / imgH, br = bw / bh;
  const w = ir >= br ? bw : bh * ir;
  const h = ir >= br ? bw / ir : bh;
  return { x: bx + (bw - w) / 2, y: by + (bh - h) / 2, w, h };
}

// ── Snapshot validation ────────────────────────────────────────────────────────
/**
 * Returns true when a base64 PNG snapshot is suspiciously small — almost certainly
 * a blank canvas from a failed html2canvas render.
 *
 * A valid 1920×1080 slide PNG (2× scale) with any real content is at minimum
 * ~50 KB after compression (≈ 68 000 base64 chars). An all-background-color
 * blank canvas compresses to 5–15 KB (< 20 000 chars). We use 25 000 chars as
 * a conservative threshold with plenty of headroom.
 */
export function isBlankSnapshot(dataUrl: string): boolean {
  // Strip the data-URL prefix to measure just the base64 payload
  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  return b64.length < 25_000;
}

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmt$  = (n: number) => '$' + n.toFixed(2);
const fmtK  = (n: number) => '$' + (n / 1000).toFixed(1) + 'K';
const fmtN  = (n: number) => n.toLocaleString();
const pct   = (n: number) => n.toFixed(1) + '%';
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + '\u2026' : s;

// ── Callout panel overlay ──────────────────────────────────────────────────────
/** Overlays a navy right-side callout panel with an optional icon, large stat, headline, and optional body. */
function addCalloutPanel(slide: PptxGenJS.Slide, callout: { stat: string; headline: string; body?: string; icon?: string }) {
  const PX = 6.3;            // panel left edge (inches)
  const PW = W - PX;         // panel width: 3.7in
  // Navy background
  slide.addShape('rect', { x: PX, y: 0, w: PW, h: H, fill: { color: C.NAVY }, line: { color: C.NAVY } });
  // Orange accent divider on left edge of panel
  slide.addShape('rect', { x: PX, y: 0, w: 0.05, h: H, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });

  // Shift content down when icon is present
  const hasIcon = !!callout.icon;
  const iconH   = 0.6;   // inches
  const iconY   = 0.7;
  const yShift  = hasIcon ? iconH + 0.15 : 0;

  // Icon
  if (hasIcon) {
    const dataUrl = getIconDataUrl(callout.icon!, '#ffffff', 80);
    if (dataUrl) {
      const iconW = iconH * (PW / H) * 1.8;
      slide.addImage({ data: dataUrl, x: PX + (PW - iconW) / 2, y: iconY, w: iconW, h: iconH });
    }
  }

  // Large stat
  if (callout.stat) {
    slide.addText(callout.stat, {
      x: PX + 0.1, y: 1.1 + yShift, w: PW - 0.2, h: 1.1,
      fontSize: 52, bold: true, color: C.WHITE, align: 'center',
    });
  }
  // Headline
  if (callout.headline) {
    slide.addText(callout.headline, {
      x: PX + 0.15, y: 2.3 + yShift, w: PW - 0.3, h: 1.0,
      fontSize: 15, bold: false, color: C.WHITE, align: 'center',
      wrap: true, lineSpacingMultiple: 1.35,
    });
  }
  // Supporting body text
  if (callout.body) {
    slide.addText(callout.body, {
      x: PX + 0.15, y: 3.45 + yShift, w: PW - 0.3, h: 0.65,
      fontSize: 10, color: '94A3B8', align: 'center', wrap: true,
    });
  }
}

// ── Narrative overlay ──────────────────────────────────────────────────────────
/** Adds freeform narrative bullet points near the bottom of a slide. */
function addNarrativeOverlay(slide: PptxGenJS.Slide, narrative: string) {
  const lines = narrative.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  const NX = 0.48, NY = 4.48, NW = 9.12, NH = 0.95;

  // Subtle frosted background strip
  slide.addShape('rect', {
    x: NX, y: NY, w: NW, h: NH,
    fill: { color: 'EEF2FF' },
    line: { color: '4472E8', width: 0.75 },
  });
  // Left accent bar
  slide.addShape('rect', {
    x: NX, y: NY, w: 0.04, h: NH,
    fill: { color: 'EF5252' },
    line: { color: 'EF5252', width: 0 },
  });
  // "NARRATIVE" label
  slide.addText('NARRATIVE', {
    x: NX + 0.1, y: NY + 0.05, w: 1.2, h: 0.15,
    fontSize: 5.5, bold: true, color: 'EF5252', charSpacing: 0.5,
  });
  // Bullet text
  const bulletText = lines.slice(0, 4).map(l => '•  ' + l.replace(/^[-•*]\s*/, '')).join('\n');
  slide.addText(bulletText, {
    x: NX + 0.1, y: NY + 0.2, w: NW - 0.2, h: NH - 0.24,
    fontSize: 7.5, color: '1C1C2E',
    valign: 'top', wrap: true,
    lineSpacingMultiple: 1.25,
  });
}

// ── Sidebar mark (left vertical accent + ShipHero logo footer) ───────────────
function addSlideMark(slide: PptxGenJS.Slide, num: number, dark = false) {
  const lineColor = dark ? '3A4555' : 'CBD5E1';
  const numColor  = dark ? '5A6A7C' : '94A3B8';

  // Left vertical accent line
  slide.addShape('line', {
    x: 0.3, y: 0, w: 0, h: H,
    line: { color: lineColor, width: 0.5 },
  });

  // ShipHero logo — placed in the bottom-left footer strip
  const logoH = 0.14;
  const logoW = logoH * (320 / 84); // ≈ 0.533" (maintains 320×84 aspect ratio)
  const logoBgColor = dark ? '3A4555' : '252F3E';
  const logoX = 0.03, logoY = H - 0.21;

  // Tiny navy background so the white logo is visible on both light and dark slides
  slide.addShape('rect', {
    x: logoX - 0.02, y: logoY - 0.02, w: logoW + 0.06, h: logoH + 0.04,
    fill: { color: logoBgColor },
    line: { color: logoBgColor },
  });
  slide.addImage({ data: shipheroWhiteUrl, x: logoX, y: logoY, w: logoW, h: logoH });

  // Slide number — to the right of the logo
  slide.addText(String(num), {
    x: logoX + logoW + 0.08, y: H - 0.2, w: 0.22, h: 0.16,
    fontSize: 6, color: numColor, align: 'left',
  });
}

// ── Section label + title + orange underline ───────────────────────────────────
function addSlideTitle(
  slide: PptxGenJS.Slide,
  label: string,
  title: string,
  x: number,
  y: number,
  dark = false,
) {
  const titleColor = dark ? C.WHITE : C.DARK;
  const labelColor = dark ? '7DB3FF' : C.BLUE;

  slide.addText(label.toUpperCase(), {
    x, y, w: 7, h: 0.2,
    fontSize: _sectionLabelFontSize, bold: true, color: labelColor, charSpacing: 1.5,
  });
  slide.addText(title, {
    x, y: y + 0.22, w: 7, h: 0.38,
    fontSize: 20, bold: true, color: titleColor,
  });
  slide.addShape('rect', {
    x, y: y + 0.64, w: 1.4, h: 0.04,
    fill: { color: C.ORANGE }, line: { color: C.ORANGE },
  });
}

// ── Horizontal bar ─────────────────────────────────────────────────────────────
function addHBar(
  slide: PptxGenJS.Slide,
  label: string,
  value: number,
  maxValue: number,
  color: string,
  display: string,
  x: number,
  y: number,
  totalW: number,
  labelW: number,
) {
  const barW    = totalW - labelW - 0.65;
  const fillPct = maxValue > 0 ? clamp(value / maxValue, 0.02, 1) : 0.02;
  const fillW   = barW * fillPct;

  slide.addText(trunc(label, 22), {
    x, y, w: labelW, h: 0.18,
    fontSize: 7.5, color: C.NAVY, valign: 'middle',
  });
  slide.addShape('rect', {
    x: x + labelW, y: y + 0.03, w: barW, h: 0.14,
    fill: { color: 'E5E7EB' }, line: { color: 'E5E7EB' },
  });
  if (fillW > 0) {
    slide.addShape('rect', {
      x: x + labelW, y: y + 0.03, w: fillW, h: 0.14,
      fill: { color }, line: { color },
    });
  }
  slide.addText(display, {
    x: x + labelW + barW + 0.06, y, w: 0.58, h: 0.18,
    fontSize: 7, color: C.GRAY, align: 'right', valign: 'middle',
  });
}

// ── KPI tile ───────────────────────────────────────────────────────────────────
function addKpiTile(
  slide: PptxGenJS.Slide,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  h: number,
  valueColor = C.NAVY,
) {
  slide.addShape('rect', {
    x, y, w, h,
    fill: { color: C.LIGHT }, line: { color: 'E5E7EB', width: 0.5 },
    rectRadius: 0.05,
  });
  slide.addText(label, {
    x: x + 0.1, y: y + 0.07, w: w - 0.2, h: 0.14,
    fontSize: 6, color: C.GRAY, bold: true,
  });
  slide.addText(value, {
    x: x + 0.1, y: y + 0.22, w: w - 0.2, h: 0.34,
    fontSize: 20, bold: true, color: valueColor,
  });
}

// ── Callout box ────────────────────────────────────────────────────────────────
function addCallout(
  slide: PptxGenJS.Slide,
  text: string,
  color: string,
  x: number,
  y: number,
  w: number,
) {
  slide.addShape('rect', {
    x, y, w, h: 0.52,
    fill: { color: color + '18' } as PptxGenJS.ShapeFillProps,
    line: { color: 'E5E7EB', width: 0.5 },
    rectRadius: 0.04,
  });
  slide.addShape('rect', {
    x, y, w: 0.04, h: 0.52,
    fill: { color }, line: { color },
  });
  slide.addText(text, {
    x: x + 0.12, y, w: w - 0.18, h: 0.52,
    fontSize: 7.5, color: C.NAVY, valign: 'middle', wrap: true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Slide builders
// ═══════════════════════════════════════════════════════════════════════════════

function buildCoverSlide(pptx: PptxGenJS, props: QBRDeckDocumentProps, num: number) {
  const slide = pptx.addSlide();

  // Resolve color scheme (strip '#' for pptxgenjs)
  const scheme    = COVER_COLOR_SCHEMES.find(s => s.id === props.coverColorScheme) ?? COVER_COLOR_SCHEMES[0];
  const bgHex     = scheme.bg.replace('#', '');
  const accentHex = scheme.accent.replace('#', '');
  // On light backgrounds (white) use dark text; otherwise use white text
  const textHex   = scheme.darkText ? C.NAVY : C.WHITE;
  const subTextHex = scheme.darkText ? '6B7280' : 'AAAAAA';
  const frameStroke = scheme.darkText ? '25252520' : 'FFFFFF12';
  const frameFill   = scheme.darkText ? '25252506' : 'FFFFFF06';
  const dividerColor = scheme.darkText ? '25252530' : 'FFFFFF20';

  if (props.coverPhoto) {
    slide.addImage({ data: props.coverPhoto, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: bgHex + 'CC' } as PptxGenJS.ShapeFillProps, line: { color: bgHex + '00' } });
  } else {
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: bgHex }, line: { color: bgHex } });
  }

  // Top accent bar
  slide.addShape('rect', { x: 0, y: 0, w: W, h: 0.06, fill: { color: accentHex }, line: { color: accentHex } });

  // Bottom accent bar (subtle)
  slide.addShape('rect', { x: 0, y: H - 0.04, w: W, h: 0.04, fill: { color: accentHex + '55' } as PptxGenJS.ShapeFillProps, line: { color: accentHex + '55' } });

  // ── Logo row (centered, framed box) ────────────────────────────────────────
  // ShipHero white logo: 320×84 → aspect 3.81:1
  const shH = 0.52;
  const shW = shH * (320 / 84);   // ≈ 1.98"

  // Logo frame: holds both logos side-by-side
  // Left half: ShipHero | Divider | Right half: client logo
  const BOX_W = 6.4, BOX_H = 1.3;
  const BOX_X = (W - BOX_W) / 2;  // centered horizontally
  const BOX_Y = 0.88;

  // Frame background + border
  slide.addShape('rect', {
    x: BOX_X, y: BOX_Y, w: BOX_W, h: BOX_H,
    fill: { color: frameFill } as PptxGenJS.ShapeFillProps,
    line: { color: frameStroke, width: 0.75 },
    rectRadius: 0.12,
  });

  // ShipHero logo — use white version on dark bg, colored version on white bg
  slide.addImage({ path: shipheroWhiteUrl, x: BOX_X + (BOX_W / 2 - shW) / 2, y: BOX_Y + (BOX_H - shH) / 2, w: shW, h: shH });

  // Vertical divider between logos
  const divX = BOX_X + BOX_W / 2;
  slide.addShape('line', {
    x: divX, y: BOX_Y + 0.18, w: 0, h: BOX_H - 0.36,
    line: { color: dividerColor, width: 0.75 },
  });

  // Client logo — right half of box
  const LOGO_X = divX + 0.15;
  const LOGO_Y = BOX_Y + 0.12;
  const LOGO_W = BOX_W / 2 - 0.3;
  const LOGO_H = BOX_H - 0.24;

  if (props.clientLogo) {
    const natural = readImageSize(props.clientLogo) ?? { w: 16, h: 9 };
    const PADDING = 0.1;
    const { x: ix, y: iy, w: iw, h: ih } = fitImage(
      natural.w, natural.h,
      LOGO_X + PADDING, LOGO_Y + PADDING,
      LOGO_W - PADDING * 2, LOGO_H - PADDING * 2,
    );
    slide.addImage({ data: props.clientLogo, x: ix, y: iy, w: iw, h: ih });
  } else {
    // Fallback: brand name text
    slide.addText((props.clientName || 'CLIENT').toUpperCase(), {
      x: LOGO_X, y: LOGO_Y, w: LOGO_W, h: LOGO_H,
      fontSize: 16, bold: true, color: textHex,
      align: 'center', valign: 'middle', charSpacing: 1.5,
    });
  }

  // ── Client name ────────────────────────────────────────────────────────────
  const nameY = BOX_Y + BOX_H + 0.26;
  const clientNameFontSize = props.fontOption === 'A' ? 26 : props.fontOption === 'C' ? 36 : 31;
  slide.addText(props.clientName || 'Client', {
    x: 1, y: nameY, w: W - 2, h: 0.72,
    fontSize: clientNameFontSize, bold: true, color: textHex,
    align: 'center', valign: 'middle',
  });

  // Accent underline — centered
  const barW = 0.85;
  slide.addShape('rect', {
    x: (W - barW) / 2, y: nameY + 0.74, w: barW, h: 0.055,
    fill: { color: accentHex }, line: { color: accentHex },
  });

  // QBR label
  slide.addText('QUARTERLY BUSINESS REVIEW', {
    x: 1, y: nameY + 0.84, w: W - 2, h: 0.26,
    fontSize: 8.5, bold: true, color: subTextHex, charSpacing: 2, align: 'center',
  });

  // Reporting period
  if (props.reportingPeriod) {
    slide.addText(props.reportingPeriod, {
      x: 1, y: nameY + 1.13, w: W - 2, h: 0.28,
      fontSize: 13, bold: true, color: accentHex, align: 'center',
    });
  }

  // ── Bottom bar ──────────────────────────────────────────────────────────────
  slide.addText(props.reportDate.toUpperCase(), {
    x: 0.45, y: H - 0.32, w: 3.5, h: 0.2,
    fontSize: 7.5, bold: true, color: scheme.darkText ? C.NAVY : C.BLUE, charSpacing: 1.5,
  });
  slide.addText('Confidential — ShipHero', {
    x: W - 3.5, y: H - 0.32, w: 3.0, h: 0.2,
    fontSize: 7, color: subTextHex, align: 'right',
  });
}

function buildAgendaSlide(
  pptx: PptxGenJS,
  items: { num: number; label: string }[],
  slideNum: number,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);

  // Left: "Agenda" wordmark — vertically centered
  const lx = 0.55;
  slide.addText('QUARTERLY BUSINESS REVIEW', {
    x: lx, y: 1.6, w: 3.8, h: 0.2,
    fontSize: 6.5, bold: true, color: C.BLUE, charSpacing: 1.5,
  });
  slide.addText('Agenda', {
    x: lx, y: 1.84, w: 3.8, h: 0.9,
    fontSize: 42, bold: true, color: C.DARK,
  });
  slide.addShape('rect', {
    x: lx, y: 2.78, w: 1.1, h: 0.05,
    fill: { color: C.ORANGE }, line: { color: C.ORANGE },
  });

  // Center divider
  slide.addShape('line', {
    x: 4.2, y: 0.6, w: 0, h: H - 1.2,
    line: { color: 'D1D5DB', width: 0.75 },
  });

  // Right: numbered list — vertically centered
  const rx = 4.55;
  const rowH = 0.46;
  const startY = (H - items.length * rowH) / 2;

  items.forEach(({ num, label }, idx) => {
    const ry = startY + idx * rowH;
    if (idx < items.length - 1) {
      slide.addShape('line', {
        x: rx, y: ry + rowH, w: 5.0, h: 0,
        line: { color: 'E5E7EB', width: 0.5 },
      });
    }
    slide.addText(`${num}.`, {
      x: rx, y: ry + 0.06, w: 0.35, h: rowH - 0.12,
      fontSize: 13, bold: true, color: C.BLUE, valign: 'middle',
    });
    slide.addText(label, {
      x: rx + 0.38, y: ry + 0.06, w: 4.8, h: rowH - 0.12,
      fontSize: 13, color: C.DARK, valign: 'middle',
    });
  });
}

function buildIntroductionsSlide(
  pptx: PptxGenJS,
  members: QBRDeckDocumentProps['teamMembers'],
  slideNum: number,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);

  const shown = (members ?? []).slice(0, 5);

  // Title
  slide.addText('The ShipHero Team', {
    x: 0.4, y: 0.55, w: 9.2, h: 0.5,
    fontSize: 24, bold: true, color: C.DARK, align: 'center',
  });
  slide.addShape('rect', {
    x: (W - 1.1) / 2, y: 1.1, w: 1.1, h: 0.04,
    fill: { color: C.ORANGE }, line: { color: C.ORANGE },
  });

  if (shown.length === 0) {
    slide.addText('Add team members in the Deck Builder to populate this slide.', {
      x: 1, y: 2.5, w: 8, h: 0.4,
      fontSize: 12, color: C.GRAY, align: 'center',
    });
    return;
  }

  const photoSize = 1.3;
  const cardW = shown.length <= 3 ? 2.2 : shown.length === 4 ? 1.9 : 1.6;
  const totalW = shown.length * cardW + (shown.length - 1) * 0.18;
  let cx = (W - totalW) / 2;
  const photoY = 1.5;
  const nameY  = photoY + photoSize + 0.26;

  shown.forEach((m) => {
    const withPhoto = m.showPhoto !== false;
    if (withPhoto) {
      if (m.photo) {
        slide.addImage({
          data: m.photo,
          x: cx + (cardW - photoSize) / 2,
          y: photoY,
          w: photoSize,
          h: photoSize,
          rounding: true,
          sizing: { type: 'cover', w: photoSize, h: photoSize },
        });
      } else {
        slide.addShape('ellipse', {
          x: cx + (cardW - photoSize) / 2, y: photoY,
          w: photoSize, h: photoSize,
          fill: { color: C.NAVY }, line: { color: C.NAVY },
        });
        slide.addText(m.name ? m.name.charAt(0).toUpperCase() : '?', {
          x: cx + (cardW - photoSize) / 2, y: photoY,
          w: photoSize, h: photoSize,
          fontSize: 36, bold: true, color: C.WHITE,
          align: 'center', valign: 'middle',
        });
      }
    }
    // Separator line
    slide.addShape('line', {
      x: cx, y: nameY - 0.1, w: cardW, h: 0,
      line: { color: 'D1D5DB', width: 0.5 },
    });
    slide.addText(m.name, {
      x: cx, y: nameY, w: cardW, h: 0.28,
      fontSize: 12, bold: true, color: C.DARK, align: 'center',
    });
    slide.addText(m.title, {
      x: cx, y: nameY + 0.3, w: cardW, h: 0.22,
      fontSize: 9, color: C.BLUE, align: 'center',
    });

    cx += cardW + 0.18;
  });
}

function buildAccountOverviewSlide(
  pptx: PptxGenJS,
  kpis: QBRDeckDocumentProps['kpis'],
  customerStats: QBRDeckDocumentProps['customerStats'],
  slideNum: number,
  title = 'Account Overview',
  sectionLabel = 'SHIPPING OVERVIEW',
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  if (!kpis) {
    slide.addText('No shipping data available.', { x: 1, y: 2.5, w: 8, h: 0.4, fontSize: 12, color: C.GRAY });
    return;
  }

  const margin = kpis.totalCharged > 0 ? kpis.totalCharged - kpis.totalLabelCost : null;

  // KPI tiles (left column) — body starts at BODY_Y
  const kpiX   = 0.48;
  const kpiY   = BODY_Y;
  const kpiW   = 1.52;
  const kpiH   = 0.62;
  const kpiGap = 0.08;

  // subtitle
  slide.addText('Key metrics for the reporting period', {
    x: kpiX, y: kpiY - 0.26, w: 3.2, h: 0.2,
    fontSize: 8, color: C.GRAY,
  });

  addKpiTile(slide, 'SHIPMENTS',    fmtN(kpis.totalShipments),  kpiX,            kpiY,                          kpiW, kpiH, C.BLUE);
  addKpiTile(slide, 'LABEL COST',   fmtK(kpis.totalLabelCost),  kpiX + kpiW + kpiGap, kpiY,                   kpiW, kpiH);
  addKpiTile(slide, 'AVG COST/SHIP',fmt$(kpis.avgLabelCost),    kpiX,            kpiY + kpiH + kpiGap,          kpiW, kpiH);
  addKpiTile(slide, 'AVG ZONE',     kpis.avgZone !== null ? kpis.avgZone.toFixed(1) : '--',
                                                                  kpiX + kpiW + kpiGap, kpiY + kpiH + kpiGap,  kpiW, kpiH);
  if (margin !== null) {
    addKpiTile(slide, 'BILLED TO CLIENTS', fmtK(kpis.totalCharged),
                                                kpiX,            kpiY + (kpiH + kpiGap) * 2,                   kpiW, kpiH, C.ORANGE);
    addKpiTile(slide, 'MARGIN',     `${margin >= 0 ? '+' : ''}${fmtK(margin)}`,
                                                kpiX + kpiW + kpiGap, kpiY + (kpiH + kpiGap) * 2,             kpiW, kpiH, margin >= 0 ? C.GREEN : C.RED);
  }

  // Right: bar chart — 6 rows × 0.44" each fits within the body area
  const top6 = customerStats.slice(0, 6);
  const maxOrders = top6[0]?.orderCount ?? 1;
  const rx = 3.42;
  const barRowH = 0.44;

  slide.addText('TOP ACCOUNTS BY VOLUME', {
    x: rx, y: BODY_Y - 0.26, w: 6.3, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  top6.forEach((a, i) => {
    addHBar(
      slide, a.customer, a.orderCount, maxOrders, C.BLUE,
      `${fmtN(a.orderCount)} · ${pct(a.volumePercent)}`,
      rx, BODY_Y + i * barRowH, 6.22, 1.5,
    );
  });
  if (notes) slide.addNotes(notes);
}

const CARRIER_COLORS = [C.BLUE, C.ORANGE, '22C55E', '8B5CF6', '0891B2', 'EF4444', 'F97316'];

function buildCarrierMixSlide(
  pptx: PptxGenJS,
  rows: QBRDeckDocumentProps['carrierMix'],
  slideNum: number,
  title = 'Carrier Mix',
  sectionLabel = 'SHIPPING BREAKDOWN',
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const top8 = rows.slice(0, 8);
  const maxShip = top8[0]?.shipments ?? 1;
  const total = rows.reduce((s, r) => s + r.shipments, 0);
  const barRowH = 0.46;

  // Left: bar chart
  slide.addText('VOLUME BY CARRIER / SERVICE', {
    x: 0.48, y: BODY_Y - 0.26, w: 5.8, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  top8.forEach((r, i) => {
    addHBar(
      slide, r.carrier, r.shipments, maxShip,
      CARRIER_COLORS[i % CARRIER_COLORS.length],
      pct(r.pctOfTotal),
      0.48, BODY_Y + i * barRowH, 5.8, 1.5,
    );
  });

  // Right: highlights
  const rx = 6.6;
  slide.addText('HIGHLIGHTS', {
    x: rx, y: BODY_Y - 0.26, w: 3.1, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  // Total tile
  slide.addShape('rect', {
    x: rx, y: BODY_Y, w: 3.1, h: 0.74,
    fill: { color: C.LIGHT }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.05,
  });
  slide.addText('TOTAL SHIPMENTS', {
    x: rx + 0.1, y: BODY_Y + 0.08, w: 2.9, h: 0.16,
    fontSize: 6.5, color: C.GRAY,
  });
  slide.addText(fmtN(total), {
    x: rx + 0.1, y: BODY_Y + 0.26, w: 2.9, h: 0.4,
    fontSize: 24, bold: true, color: C.NAVY,
  });
  // Top 3 legend list
  const listY = BODY_Y + 0.84;
  top8.slice(0, 3).forEach((r, i) => {
    const iy = listY + i * 0.42;
    slide.addShape('rect', {
      x: rx + 0.02, y: iy + 0.04, w: 0.12, h: 0.12,
      fill: { color: CARRIER_COLORS[i] }, line: { color: CARRIER_COLORS[i] },
    });
    slide.addText(trunc(r.carrier, 16), {
      x: rx + 0.2, y: iy, w: 2.2, h: 0.22,
      fontSize: 8, color: C.NAVY,
    });
    slide.addText(pct(r.pctOfTotal), {
      x: rx + 2.4, y: iy, w: 0.65, h: 0.22,
      fontSize: 8, bold: true, color: C.NAVY, align: 'right',
    });
    if (i < 2) {
      slide.addShape('line', {
        x: rx, y: iy + 0.3, w: 3.1, h: 0,
        line: { color: 'F3F4F6', width: 0.5 },
      });
    }
  });
  if (notes) slide.addNotes(notes);
}

function buildCostGapSlide(
  pptx: PptxGenJS,
  rows: QBRDeckDocumentProps['costGapRows'],
  slideNum: number,
  title = 'Shipping Cost Analysis',
  sectionLabel = 'BILLING ANALYSIS',
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const top8 = [...rows].sort((a, b) => a.gap - b.gap).slice(0, 8);
  const maxGap = Math.max(...top8.map(r => Math.abs(r.gap)), 1);
  const totalGap = rows.reduce((s, r) => s + r.gap, 0);
  // 8 rows need to fit: use tighter spacing
  const barRowH = 0.36;

  slide.addText('LABEL COST vs. BILLED — GAP BY ACCOUNT', {
    x: 0.48, y: BODY_Y - 0.26, w: 5.8, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  top8.forEach((r, i) => {
    const color = r.gap < 0 ? C.RED : C.GREEN;
    addHBar(
      slide, r.name, Math.abs(r.gap), maxGap, color,
      `${r.gap >= 0 ? '+' : ''}${fmt$(r.gap)} (${pct(r.gapPct)})`,
      0.48, BODY_Y + i * barRowH, 5.8, 1.45,
    );
  });

  // Right summary
  const rx = 6.6;
  const gapColor = totalGap >= 0 ? C.GREEN : C.RED;
  slide.addText('SUMMARY', {
    x: rx, y: BODY_Y - 0.26, w: 3.1, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  slide.addShape('rect', {
    x: rx, y: BODY_Y, w: 3.1, h: 0.82,
    fill: { color: C.LIGHT }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.05,
  });
  slide.addText('TOTAL MARGIN GAP', {
    x: rx + 0.1, y: BODY_Y + 0.08, w: 2.9, h: 0.16,
    fontSize: 6.5, color: C.GRAY,
  });
  slide.addText(`${totalGap >= 0 ? '+' : ''}${fmtK(totalGap)}`, {
    x: rx + 0.1, y: BODY_Y + 0.26, w: 2.9, h: 0.46,
    fontSize: 24, bold: true, color: gapColor,
  });
  addCallout(
    slide,
    totalGap < 0
      ? 'Label costs exceed billed revenue — review billing rates.'
      : 'Positive margin overall. Monitor under-charged accounts.',
    totalGap < 0 ? C.RED : C.GREEN,
    rx, BODY_Y + 0.92, 3.1,
  );
  if (notes) slide.addNotes(notes);
}

function buildZonePerformanceSlide(
  pptx: PptxGenJS,
  rows: QBRDeckDocumentProps['zoneComparisons'],
  slideNum: number,
  title = 'Rate Card Performance',
  sectionLabel = 'RATE CARD',
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const maxVal  = Math.max(...rows.map(r => Math.max(r.rateCardAvg, r.actualAvg)), 1);
  const avgDelta = rows.length > 0 ? rows.reduce((s, r) => s + r.deltaPercent, 0) / rows.length : 0;

  // Dense layout: 8 zones × 2 bars each — use BODY_Y_WIDE
  const bY = BODY_Y_WIDE;

  // Heading + legend
  slide.addText('ACTUAL vs. MRC RATE BY ZONE', {
    x: 0.48, y: bY, w: 5.8, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  // Legend
  const legY = bY + 0.22;
  slide.addShape('rect', { x: 0.48, y: legY + 0.03, w: 0.12, h: 0.12, fill: { color: C.BLUE },   line: { color: C.BLUE } });
  slide.addText('MRC Rate',   { x: 0.64, y: legY, w: 0.9, h: 0.18, fontSize: 7.5, color: C.GRAY });
  slide.addShape('rect', { x: 1.58, y: legY + 0.03, w: 0.12, h: 0.12, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
  slide.addText('Actual Avg', { x: 1.74, y: legY, w: 0.9, h: 0.18, fontSize: 7.5, color: C.GRAY });

  const zoneStartY = bY + 0.46;
  const zoneRowH   = 0.50;   // 2 bars + zone label + spacing
  const barW = 4.5;
  const labelW = 0.58;

  rows.forEach((r, i) => {
    const ry = zoneStartY + i * zoneRowH;
    slide.addText(`Zone ${r.zone}`, {
      x: 0.48, y: ry, w: labelW, h: 0.2,
      fontSize: 7.5, bold: true, color: C.NAVY, valign: 'middle',
    });
    // MRC bar
    const mrcFill = clamp(r.rateCardAvg / maxVal, 0.02, 1) * barW;
    slide.addShape('rect', { x: 0.48 + labelW, y: ry + 0.02, w: barW, h: 0.11, fill: { color: 'E5E7EB' }, line: { color: 'E5E7EB' } });
    slide.addShape('rect', { x: 0.48 + labelW, y: ry + 0.02, w: mrcFill, h: 0.11, fill: { color: C.BLUE }, line: { color: C.BLUE } });
    slide.addText(fmt$(r.rateCardAvg), { x: 0.48 + labelW + barW + 0.06, y: ry, w: 0.55, h: 0.15, fontSize: 7, color: C.GRAY, align: 'right' });
    // Actual bar
    const actFill = clamp(r.actualAvg / maxVal, 0.02, 1) * barW;
    slide.addShape('rect', { x: 0.48 + labelW, y: ry + 0.2, w: barW, h: 0.11, fill: { color: 'E5E7EB' }, line: { color: 'E5E7EB' } });
    slide.addShape('rect', { x: 0.48 + labelW, y: ry + 0.2, w: actFill, h: 0.11, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    slide.addText(fmt$(r.actualAvg), { x: 0.48 + labelW + barW + 0.06, y: ry + 0.18, w: 0.55, h: 0.14, fontSize: 7, color: C.GRAY, align: 'right' });
  });

  // Right: summary panel
  const rx = 6.6;
  const deltaColor = avgDelta <= 0 ? C.GREEN : C.RED;
  slide.addText('RATE PERFORMANCE', {
    x: rx, y: bY, w: 3.1, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  slide.addShape('rect', {
    x: rx, y: bY + 0.26, w: 3.1, h: 1.0,
    fill: { color: C.LIGHT }, line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.05,
  });
  slide.addText('AVG DELTA vs. MRC', {
    x: rx + 0.1, y: bY + 0.34, w: 2.9, h: 0.18,
    fontSize: 6.5, color: C.GRAY,
  });
  slide.addText(`${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(1)}%`, {
    x: rx + 0.1, y: bY + 0.54, w: 2.9, h: 0.44,
    fontSize: 24, bold: true, color: deltaColor,
  });
  slide.addText(avgDelta <= 0 ? 'Below MRC (favorable)' : 'Above MRC (review needed)', {
    x: rx + 0.1, y: bY + 1.0, w: 2.9, h: 0.18,
    fontSize: 7.5, color: C.GRAY,
  });
  addCallout(
    slide,
    avgDelta <= 0
      ? `Actual rates averaging ${Math.abs(avgDelta).toFixed(1)}% below MRC across all zones.`
      : `Actual rates averaging ${avgDelta.toFixed(1)}% above MRC — flag for renegotiation.`,
    avgDelta <= 0 ? C.GREEN : C.RED,
    rx, bY + 1.38, 3.1,
  );
  if (notes) slide.addNotes(notes);
}

function buildExpiryAlertsSlide(
  pptx: PptxGenJS,
  inventoryData: QBRDeckDocumentProps['inventoryData'],
  slideNum: number,
  title = 'Expiry Alerts',
  sectionLabel = 'INVENTORY',
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const alerts   = inventoryData?.expiryAlerts ?? [];
  const critical = alerts.filter(a => a.tier === 'critical').length;
  const warning  = alerts.filter(a => a.tier === 'warning').length;
  const watch    = alerts.filter(a => a.tier === 'watch').length;
  const top6     = alerts.slice(0, 6);

  const tx      = 0.48;
  const tableY  = BODY_Y;
  const rowH    = 0.38;

  // Table heading
  slide.addText('ITEMS EXPIRING SOONEST', {
    x: tx, y: tableY - 0.26, w: 5.8, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  // Header row
  slide.addShape('rect', { x: tx, y: tableY, w: 5.8, h: 0.26, fill: { color: C.NAVY }, line: { color: C.NAVY } });
  const colX = [0, 1.1, 3.0, 4.1];
  const colW = [1.1, 1.9, 1.1, 1.7];
  ['Client', 'SKU', 'Days Left', 'Urgency'].forEach((h, i) => {
    slide.addText(h, {
      x: tx + colX[i] + 0.08, y: tableY + 0.04, w: colW[i], h: 0.18,
      fontSize: 6.5, bold: true, color: C.WHITE,
    });
  });
  // Data rows
  top6.forEach((r, i) => {
    const ry = tableY + 0.26 + i * rowH;
    const tierColor = r.tier === 'critical' ? C.RED : r.tier === 'warning' ? C.ORANGE : 'EAB308';
    if (i % 2 === 1) {
      slide.addShape('rect', { x: tx, y: ry, w: 5.8, h: rowH, fill: { color: C.LIGHT }, line: { color: C.LIGHT } });
    }
    const vals = [trunc(r.client || '', 13), trunc(r.sku || '', 22), String(r.daysToExpire ?? '--'), r.tier.toUpperCase()];
    vals.forEach((val, ci) => {
      slide.addText(val, {
        x: tx + colX[ci] + 0.08, y: ry + 0.04, w: colW[ci], h: rowH - 0.08,
        fontSize: 7.5, color: ci >= 2 ? tierColor : C.NAVY, bold: ci >= 2, valign: 'middle',
      });
    });
  });

  // Right: urgency breakdown
  const rx      = 6.6;
  const tileH   = 0.56;
  const tileGap = 0.1;
  slide.addText('URGENCY BREAKDOWN', {
    x: rx, y: tableY - 0.26, w: 3.1, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  [
    { label: 'Critical (<30d)',  count: critical, color: C.RED },
    { label: 'Warning (30–90d)', count: warning,  color: C.ORANGE },
    { label: 'Watch (90–180d)', count: watch,    color: 'EAB308' },
  ].forEach(({ label, count, color }, i) => {
    const iy = tableY + i * (tileH + tileGap);
    slide.addShape('rect', {
      x: rx, y: iy, w: 3.1, h: tileH,
      fill: { color: color + '25' } as PptxGenJS.ShapeFillProps,
      line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.05,
    });
    slide.addText(label, { x: rx + 0.14, y: iy + 0.14, w: 2.0, h: 0.28, fontSize: 8.5, color: C.NAVY, valign: 'middle' });
    slide.addText(String(count), { x: rx + 2.2, y: iy + 0.06, w: 0.78, h: 0.44, fontSize: 20, bold: true, color, align: 'right', valign: 'middle' });
  });
  slide.addText(`Total alerting SKUs: ${critical + warning + watch}`, {
    x: rx, y: tableY + 3 * (tileH + tileGap) + 0.08, w: 3.1, h: 0.22,
    fontSize: 7.5, color: C.GRAY,
  });
  if (notes) slide.addNotes(notes);
}

function buildDaysOnHandSlide(
  pptx: PptxGenJS,
  inventoryData: QBRDeckDocumentProps['inventoryData'],
  slideNum: number,
  title = 'Days on Hand',
  sectionLabel = 'INVENTORY',
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const allRows     = inventoryData?.daysOnHand ?? [];
  const critical    = allRows.filter(r => r.status === 'critical').length;
  const low         = allRows.filter(r => r.status === 'low').length;
  const overstocked = allRows.filter(r => r.status === 'overstocked').length;
  const top6 = [...allRows]
    .filter(r => r.status === 'critical' || r.status === 'low')
    .sort((a, b) => (a.doh ?? 999) - (b.doh ?? 999))
    .slice(0, 6);

  const tx     = 0.48;
  const tableY = BODY_Y;
  const rowH   = 0.38;

  slide.addText('CRITICAL & LOW STOCK SKUs', {
    x: tx, y: tableY - 0.26, w: 5.8, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  slide.addShape('rect', { x: tx, y: tableY, w: 5.8, h: 0.26, fill: { color: C.NAVY }, line: { color: C.NAVY } });
  const colX = [0, 1.1, 3.0, 4.1];
  const colW = [1.1, 1.9, 1.1, 1.7];
  ['Client', 'SKU', 'Days on Hand', 'Status'].forEach((h, i) => {
    slide.addText(h, {
      x: tx + colX[i] + 0.08, y: tableY + 0.04, w: colW[i], h: 0.18,
      fontSize: 6.5, bold: true, color: C.WHITE,
    });
  });

  if (top6.length === 0) {
    slide.addText('No critical or low stock SKUs', {
      x: tx, y: tableY + 0.5, w: 5.8, h: 0.4,
      fontSize: 10, color: C.GREEN, align: 'center',
    });
  } else {
    top6.forEach((r, i) => {
      const ry = tableY + 0.26 + i * rowH;
      const c = r.status === 'critical' ? C.RED : C.ORANGE;
      if (i % 2 === 1) {
        slide.addShape('rect', { x: tx, y: ry, w: 5.8, h: rowH, fill: { color: C.LIGHT }, line: { color: C.LIGHT } });
      }
      [trunc(r.client || '', 13), trunc(r.sku || '', 22), String(r.doh !== null ? Math.round(r.doh) : '--'), r.status.toUpperCase()]
        .forEach((val, ci) => {
          slide.addText(val, {
            x: tx + colX[ci] + 0.08, y: ry + 0.04, w: colW[ci], h: rowH - 0.08,
            fontSize: 7.5, color: ci >= 2 ? c : C.NAVY, bold: ci >= 2, valign: 'middle',
          });
        });
    });
  }

  const rx      = 6.6;
  const tileH   = 0.56;
  const tileGap = 0.1;
  slide.addText('STOCK STATUS', {
    x: rx, y: tableY - 0.26, w: 3.1, h: 0.2,
    fontSize: 7, bold: true, color: C.GRAY, charSpacing: 0.5,
  });
  [
    { label: 'Critical (<14d)',     count: critical,    color: C.RED },
    { label: 'Low (14–30d)',        count: low,         color: C.ORANGE },
    { label: 'Overstocked (>180d)', count: overstocked, color: C.BLUE },
  ].forEach(({ label, count, color }, i) => {
    const iy = tableY + i * (tileH + tileGap);
    slide.addShape('rect', {
      x: rx, y: iy, w: 3.1, h: tileH,
      fill: { color: color + '25' } as PptxGenJS.ShapeFillProps,
      line: { color: 'E5E7EB', width: 0.5 }, rectRadius: 0.05,
    });
    slide.addText(label, { x: rx + 0.14, y: iy + 0.14, w: 2.0, h: 0.28, fontSize: 8.5, color: C.NAVY, valign: 'middle' });
    slide.addText(String(count), { x: rx + 2.2, y: iy + 0.06, w: 0.78, h: 0.44, fontSize: 20, bold: true, color, align: 'right', valign: 'middle' });
  });
  slide.addText(`Total tracked SKUs: ${allRows.length}`, {
    x: rx, y: tableY + 3 * (tileH + tileGap) + 0.08, w: 3.1, h: 0.22,
    fontSize: 7.5, color: C.GRAY,
  });
  if (notes) slide.addNotes(notes);
}

const PRIORITY_COLOR: Record<string, string> = { HIGH: C.RED, MEDIUM: C.ORANGE, LOW: C.BLUE };

function buildRecommendedActionsSlide(
  pptx: PptxGenJS,
  actions: QBRDeckDocumentProps['recommendedActions'],
  slideNum: number,
  title = 'Recommended Actions',
  sectionLabel = 'NEXT STEPS',
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const top6    = (actions ?? []).slice(0, 6);
  const colW    = 4.3;
  const cardH   = 1.2;
  const cardGap = 0.16;
  const bodyY   = BODY_Y;

  [[0, 1, 2], [3, 4, 5]].forEach((indices, col) => {
    const cx = 0.48 + col * (colW + 0.24);
    indices.forEach((idx, row) => {
      const a = top6[idx];
      if (!a) return;
      const pc = PRIORITY_COLOR[a.priority] ?? C.BLUE;
      const cy = bodyY + row * (cardH + cardGap);

      slide.addShape('rect', {
        x: cx, y: cy, w: colW, h: cardH,
        fill: { color: C.WHITE }, line: { color: pc + '60', width: 0.75 }, rectRadius: 0.07,
      });
      // Header band
      slide.addShape('rect', {
        x: cx, y: cy, w: colW, h: 0.34,
        fill: { color: pc + '20' } as PptxGenJS.ShapeFillProps,
        line: { color: pc + '20' } as PptxGenJS.ShapeLineProps,
        rectRadius: 0.07,
      });
      // Priority badge
      slide.addShape('rect', {
        x: cx + 0.1, y: cy + 0.08, w: 0.5, h: 0.2,
        fill: { color: pc }, line: { color: pc }, rectRadius: 0.03,
      });
      slide.addText(a.priority, {
        x: cx + 0.1, y: cy + 0.08, w: 0.5, h: 0.2,
        fontSize: 5.5, bold: true, color: C.WHITE, align: 'center', valign: 'middle',
      });
      // Title
      slide.addText(a.title, {
        x: cx + 0.68, y: cy + 0.08, w: colW - 0.82, h: 0.2,
        fontSize: 9, bold: true, color: C.NAVY, valign: 'middle',
      });
      // Body text
      slide.addText(a.body, {
        x: cx + 0.12, y: cy + 0.38, w: colW - 0.24, h: cardH - 0.46,
        fontSize: 8, color: C.GRAY, wrap: true, valign: 'top',
      });
    });
  });
  if (notes) slide.addNotes(notes);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Account Health slides (Monthly Statistics data)
// ═══════════════════════════════════════════════════════════════════════════════

/** Compute per-month aggregates from raw stats rows */
function computeMonthlyTotals(rows: MonthlyStatRow[]) {
  const allMonths = [...new Set(rows.map(r => r.month))].sort();
  const warehouseRows = dedupeWarehouseRows(rows);
  const totals = new Map<string, { orders: number; labels: number; spend: number; gmv: number }>();
  for (const r of rows) {
    const ex = totals.get(r.month) ?? { orders: 0, labels: 0, spend: 0, gmv: 0 };
    totals.set(r.month, { orders: ex.orders + r.orderCount, labels: ex.labels + r.labelCount, spend: ex.spend + r.carrierSpend, gmv: ex.gmv });
  }
  for (const r of warehouseRows) {
    const ex = totals.get(r.month);
    if (ex) totals.set(r.month, { ...ex, gmv: ex.gmv + r.gmv });
  }
  const fulfillment = new Map<string, { mib: number; sib: number; bulk: number; wholesale: number; manual: number }>();
  for (const r of warehouseRows) {
    const ex = fulfillment.get(r.month) ?? { mib: 0, sib: 0, bulk: 0, wholesale: 0, manual: 0 };
    fulfillment.set(r.month, { mib: ex.mib + r.mibLabels, sib: ex.sib + r.sibLabels, bulk: ex.bulk + r.bulkLabels, wholesale: ex.wholesale + r.wholesaleLabels, manual: ex.manual + r.manualLabels });
  }
  return { allMonths, totals, fulfillment };
}

function buildVolumeTrendSlide(pptx: PptxGenJS, rows: MonthlyStatRow[], slideNum: number, title = 'Total Volume Trend', sectionLabel = 'ACCOUNT HEALTH', notes?: string) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const { allMonths: rawMonths, totals } = computeMonthlyTotals(rows);
  const allMonths = rawMonths.filter(m => (totals.get(m)?.orders ?? 0) > 0 || (totals.get(m)?.labels ?? 0) > 0);
  const labels  = allMonths.map(m => formatMonth(m));
  const orders  = allMonths.map(m => totals.get(m)?.orders ?? 0);
  const labels2 = allMonths.map(m => totals.get(m)?.labels ?? 0);

  slide.addChart(pptx.ChartType.line as PptxGenJS.CHART_NAME, [
    { name: 'Orders', labels, values: orders },
    { name: 'Labels', labels, values: labels2 },
  ], {
    x: 0.48, y: 1.35, w: 9.1, h: 3.7,
    chartColors: [C.BLUE, C.ORANGE],
    lineDataSymbol: 'none',
    lineSmooth: true,
    showLegend: true, legendPos: 'b', legendFontSize: 9,
    valAxisLabelFontSize: 9,
    catAxisLabelFontSize: 8,
    catAxisLabelRotate: 315,
    showTitle: false,
    valGridLine: { style: 'dot', color: 'E5E7EB', size: 0.5 },
  });
  if (notes) slide.addNotes(notes);
}

function buildChildAccountTrendsSlide(pptx: PptxGenJS, rows: MonthlyStatRow[], slideNum: number, title = 'Child Account Order Trends', sectionLabel = 'ACCOUNT HEALTH', notes?: string) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const { allMonths: rawMonths2 } = computeMonthlyTotals(rows);

  // Top 6 children by total orders
  const childMap = new Map<string, { name: string; orders: Record<string, number>; total: number }>();
  for (const r of rows) {
    const ex = childMap.get(r.childAccountId) ?? { name: '', orders: {}, total: 0 };
    if (!ex.name && r.childAccountName) ex.name = r.childAccountName;
    ex.orders[r.month] = (ex.orders[r.month] ?? 0) + r.orderCount;
    ex.total += r.orderCount;
    childMap.set(r.childAccountId, ex);
  }
  const top6 = [...childMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  // Filter to months where at least one child account has orders
  const allMonths = rawMonths2.filter(m => top6.some(([, data]) => (data.orders[m] ?? 0) > 0));
  const labels = allMonths.map(m => formatMonth(m));
  const CHART_COLORS = [C.BLUE, C.ORANGE, '22C55E', '8B5CF6', '06B6D4', 'F97316'];

  const chartData = top6.map(([id, data], i) => ({
    name: data.name || id,
    labels,
    values: allMonths.map(m => data.orders[m] ?? 0),
    chartColor: CHART_COLORS[i % CHART_COLORS.length],
  }));

  slide.addChart(pptx.ChartType.line as PptxGenJS.CHART_NAME, chartData, {
    x: 0.48, y: 1.35, w: 9.1, h: 3.7,
    chartColors: CHART_COLORS,
    lineDataSymbol: 'none',
    showLegend: true, legendPos: 'b', legendFontSize: 8,
    valAxisLabelFontSize: 9,
    catAxisLabelFontSize: 8,
    catAxisLabelRotate: 315,
    showTitle: false,
    valGridLine: { style: 'dot', color: 'E5E7EB', size: 0.5 },
  });
  if (notes) slide.addNotes(notes);
}

function buildCarrierSpendGMVSlide(pptx: PptxGenJS, rows: MonthlyStatRow[], slideNum: number, title = 'Carrier Spend vs GMV', sectionLabel = 'ACCOUNT HEALTH', notes?: string) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const { allMonths: rawMonths3, totals } = computeMonthlyTotals(rows);
  const allMonths = rawMonths3.filter(m => (totals.get(m)?.spend ?? 0) > 0 || (totals.get(m)?.gmv ?? 0) > 0);
  const labels = allMonths.map(m => formatMonth(m));

  slide.addChart(pptx.ChartType.line as PptxGenJS.CHART_NAME, [
    { name: 'Carrier Spend', labels, values: allMonths.map(m => Math.round(totals.get(m)?.spend ?? 0)) },
    { name: 'GMV',           labels, values: allMonths.map(m => Math.round(totals.get(m)?.gmv  ?? 0)) },
  ], {
    x: 0.48, y: 1.35, w: 9.1, h: 3.7,
    chartColors: [C.RED, '22C55E'],
    lineDataSymbol: 'none',
    lineSmooth: true,
    showLegend: true, legendPos: 'b', legendFontSize: 9,
    valAxisLabelFontSize: 9,
    catAxisLabelFontSize: 8,
    catAxisLabelRotate: 315,
    valAxisDisplayUnit: 'millions',
    showTitle: false,
    valGridLine: { style: 'dot', color: 'E5E7EB', size: 0.5 },
  });
  if (notes) slide.addNotes(notes);
}

function buildFulfillmentMixSlide(pptx: PptxGenJS, rows: MonthlyStatRow[], slideNum: number, title = 'Fulfillment Mix', sectionLabel = 'ACCOUNT HEALTH', notes?: string) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  const { allMonths: rawMonths4, fulfillment } = computeMonthlyTotals(rows);
  const allMonths = rawMonths4.filter(m => {
    const f = fulfillment.get(m);
    return f && (f.mib + f.sib + f.bulk + f.wholesale + f.manual) > 0;
  });

  const toPct = (m: string, key: 'sib' | 'mib' | 'bulk' | 'manual' | 'wholesale') => {
    const f = fulfillment.get(m) ?? { mib: 0, sib: 0, bulk: 0, wholesale: 0, manual: 0 };
    const total = f.mib + f.sib + f.bulk + f.wholesale + f.manual;
    return total > 0 ? Math.round((f[key] / total) * 100) : 0;
  };

  const mLabels = allMonths.map(m => formatMonth(m));
  slide.addChart(pptx.ChartType.bar as PptxGenJS.CHART_NAME, [
    { name: 'SIB',       labels: mLabels, values: allMonths.map(m => toPct(m, 'sib'))       },
    { name: 'MIB',       labels: mLabels, values: allMonths.map(m => toPct(m, 'mib'))       },
    { name: 'Bulk Ship', labels: mLabels, values: allMonths.map(m => toPct(m, 'bulk'))      },
    { name: 'Manual',    labels: mLabels, values: allMonths.map(m => toPct(m, 'manual'))    },
    { name: 'Wholesale', labels: mLabels, values: allMonths.map(m => toPct(m, 'wholesale')) },
  ], {
    x: 0.48, y: 1.35, w: 9.1, h: 3.7,
    chartColors: [C.BLUE, C.ORANGE, '22C55E', 'EF4444', '8B5CF6'],
    barDir: 'col',
    barGrouping: 'stacked',
    showLegend: true, legendPos: 'b', legendFontSize: 9,
    valAxisLabelFontSize: 9,
    catAxisLabelFontSize: 8,
    catAxisLabelRotate: 315,
    valAxisMaxVal: 100,
    valAxisLabelFormatCode: '0"%"',
    showTitle: false,
    valGridLine: { style: 'dot', color: 'E5E7EB', size: 0.5 },
  });
  if (notes) slide.addNotes(notes);
}

// ── Placeholder slide for sections without a dedicated chart builder ──────────
// Insight fields (internal strategy) are pushed to speaker notes only — not shown on slide.
function buildInsightSlide(
  pptx: PptxGenJS,
  sectionLabel: string,
  title: string,
  slideNum: number,
  insight?: import('../components/pdf/QBRDeckDocument').SectionInsight,
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  // Build speaker notes from insight fields (internal use only — not on slide)
  const internalNotes = [
    notes,
    insight?.whatHappening  ? `What's happening: ${insight.whatHappening}` : '',
    insight?.whyMatters     ? `Why it matters: ${insight.whyMatters}`      : '',
    insight?.action         ? `Recommended action: ${insight.action}`      : '',
    insight?.actionNote     ? `Notes: ${insight.actionNote}`               : '',
  ].filter(Boolean).join('\n\n');

  if (internalNotes) slide.addNotes(internalNotes);
}

// ── Generic KPI tiles slide ────────────────────────────────────────────────────
/**
 * Renders a slide with a grid of KPI stat tiles and puts insight fields in speaker notes.
 * Tiles are arranged in a 2-column layout matching the Account Overview style.
 */
function buildKpiTilesSlide(
  pptx: PptxGenJS,
  sectionLabel: string,
  title: string,
  slideNum: number,
  tiles: Array<{ id: string; label: string; value: string; color?: string }>,
  insight?: import('../components/pdf/QBRDeckDocument').SectionInsight,
  notes?: string,
) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  if (tiles.length > 0) {
    const kpiX   = 0.48;
    const kpiY   = BODY_Y;
    const kpiW   = 1.52;
    const kpiH   = 0.62;
    const kpiGap = 0.08;

    slide.addText('Key metrics for the reporting period', {
      x: kpiX, y: kpiY - 0.26, w: 3.2, h: 0.2,
      fontSize: 8, color: C.GRAY,
    });

    tiles.forEach((tile, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = kpiX + col * (kpiW + kpiGap);
      const y = kpiY + row * (kpiH + kpiGap);
      addKpiTile(slide, tile.label.toUpperCase(), tile.value, x, y, kpiW, kpiH, tile.color ?? C.NAVY);
    });
  }

  const internalNotes = [
    notes,
    insight?.whatHappening  ? `What's happening: ${insight.whatHappening}` : '',
    insight?.whyMatters     ? `Why it matters: ${insight.whyMatters}`      : '',
    insight?.action         ? `Recommended action: ${insight.action}`      : '',
    insight?.actionNote     ? `Notes: ${insight.actionNote}`               : '',
  ].filter(Boolean).join('\n\n');
  if (internalNotes) slide.addNotes(internalNotes);
}

// ── Custom slide builders ──────────────────────────────────────────────────────

function buildDividerSlide(
  pptx: PptxGenJS,
  title: string,
  subtitle: string | undefined,
  slideNum: number,
  notes?: string,
) {
  const slide = pptx.addSlide();
  // Full navy background
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.NAVY }, line: { color: C.NAVY } });
  // Centered title
  slide.addText(title, {
    x: 1.0, y: subtitle ? 1.8 : 2.1, w: 8.0, h: 0.8,
    fontSize: 32, bold: true, color: C.WHITE, align: 'center',
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 1.0, y: 2.7, w: 8.0, h: 0.4,
      fontSize: 14, color: '94A3B8', align: 'center',
    });
  }
  // Orange accent line
  slide.addShape('rect', { x: 3.5, y: subtitle ? 3.2 : 3.0, w: 3.0, h: 0.06, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
  // Bottom gradient bar
  slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
  addSlideMark(slide, slideNum, true);
  if (notes) slide.addNotes(notes);
}

function buildTextSlide(
  pptx: PptxGenJS,
  title: string,
  body: string | undefined,
  sectionLabel: string,
  slideNum: number,
  wide: boolean,
  notes?: string,
) {
  const slide = pptx.addSlide();
  // Light background
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  const x = wide ? 0.5 : 0.8;
  if (!wide) addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel || 'CUSTOM', title, x, 0.28);
  if (body) {
    slide.addText(body, {
      x, y: BODY_Y, w: wide ? 9.0 : 8.7, h: 3.2,
      fontSize: 14, color: C.GRAY, lineSpacingMultiple: 1.4,
      valign: 'top', wrap: true,
    });
  }
  // Bottom bar
  slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
  if (notes) slide.addNotes(notes);
}

// ── Data-unavailable placeholder slide ────────────────────────────────────────
/**
 * Renders a clearly-labelled placeholder when a slide's required data is absent.
 * This prevents silent omission — the CSM sees the slide and knows why it's empty.
 */
function buildDataUnavailableSlide(
  pptx: PptxGenJS,
  slideNum: number,
  title: string,
  sectionLabel: string,
  reason: string,
) {
  const slide = pptx.addSlide();
  // Background
  slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
  addSlideMark(slide, slideNum);
  addSlideTitle(slide, sectionLabel, title, 0.48, 0.18);

  // Centred warning icon box
  const bx = 3.5, by = 1.9, bw = 3, bh = 0.55;
  slide.addShape('rect', {
    x: bx, y: by, w: bw, h: bh,
    fill: { color: 'FEF3C7' },
    line: { color: 'F59E0B', width: 1.5, dashType: 'dash' },
    rectRadius: 0.08,
  });
  slide.addText('⚠  Data unavailable', {
    x: bx, y: by, w: bw, h: bh,
    fontSize: 13, bold: true, color: '92400E',
    align: 'center', valign: 'middle',
  });

  // Reason text
  slide.addText(reason, {
    x: 1.5, y: 2.65, w: 7, h: 1.8,
    fontSize: 10, color: C.GRAY,
    align: 'center', valign: 'top',
    wrap: true,
    lineSpacingMultiple: 1.4,
  });

  // Speaker note with the same info for the CSM
  slide.addNotes(`This slide was included in the deck but could not be rendered.\n\n${reason}`);
}

// ── Per-section slide dispatcher ───────────────────────────────────────────────

type AgendaItem = { num: number; label: string };

function buildSectionSlide(
  pptx: PptxGenJS,
  section: DeckSectionToggle,
  wide: boolean,
  slideNum: number,
  props: QBRDeckDocumentProps,
  agendaItems: AgendaItem[],
  titleFor: (k: DeckSectionKey) => string,
  sectionLabelFor: (k: DeckSectionKey, fallback: string) => string,
  notesFor: (k: DeckSectionKey) => string | undefined,
) {
  const k = section.key;
  const rf = section.rowFilter?.length ? section.rowFilter : null; // null = no filter

  switch (k) {
    case 'agenda':
      buildAgendaSlide(pptx, agendaItems, slideNum);
      break;
    case 'introductions':
      buildIntroductionsSlide(pptx, props.teamMembers, slideNum);
      break;
    case 'accountOverview':
      if (props.kpis) buildAccountOverviewSlide(pptx, props.kpis, props.customerStats, slideNum, titleFor(k), sectionLabelFor(k, 'SHIPPING OVERVIEW'), notesFor(k));
      break;
    case 'carrierMix': {
      const rows = rf ? props.carrierMix.filter(r => rf.includes(r.carrier)) : props.carrierMix;
      if (rows.length) buildCarrierMixSlide(pptx, rows, slideNum, titleFor(k), sectionLabelFor(k, 'SHIPPING BREAKDOWN'), notesFor(k));
      break;
    }
    case 'costGap': {
      const rows = rf ? props.costGapRows.filter(r => rf.includes(r.name)) : props.costGapRows;
      if (rows.length) {
        buildCostGapSlide(pptx, rows, slideNum, titleFor(k), sectionLabelFor(k, 'BILLING ANALYSIS'), notesFor(k));
      } else {
        buildDataUnavailableSlide(
          pptx, slideNum,
          titleFor(k),
          sectionLabelFor(k, 'BILLING ANALYSIS'),
          'This slide requires a "Total Shipping Charged" column in the Shipments CSV.\nRe-export from ShipHero with billing data included to populate this chart.',
        );
      }
      break;
    }
    case 'serviceLevelMix': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, 'SHIPPING ANALYSIS'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
    case 'labelCostByCarrier': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, 'COST ANALYSIS'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
    case 'zonePerformance':
      if (props.zoneComparisons.length > 0) buildZonePerformanceSlide(pptx, props.zoneComparisons, slideNum, titleFor(k), sectionLabelFor(k, 'RATE CARD'), notesFor(k));
      break;
    case 'expiryAlerts':
      if (props.inventoryData) buildExpiryAlertsSlide(pptx, props.inventoryData, slideNum, titleFor(k), sectionLabelFor(k, 'INVENTORY'), notesFor(k));
      break;
    case 'daysOnHand':
      if (props.inventoryData) buildDaysOnHandSlide(pptx, props.inventoryData, slideNum, titleFor(k), sectionLabelFor(k, 'INVENTORY'), notesFor(k));
      break;
    case 'recommendedActions':
      if (props.recommendedActions?.length) buildRecommendedActionsSlide(pptx, props.recommendedActions, slideNum, titleFor(k), sectionLabelFor(k, 'NEXT STEPS'), notesFor(k));
      break;
    case 'volumeTrend': {
      const statsRows = props.statsRows ?? [];
      if (statsRows.length) buildVolumeTrendSlide(pptx, statsRows, slideNum, titleFor(k), sectionLabelFor(k, 'ACCOUNT HEALTH'), notesFor(k));
      break;
    }
    case 'childAccountTrends': {
      const statsRows = props.statsRows ?? [];
      if (statsRows.length) buildChildAccountTrendsSlide(pptx, statsRows, slideNum, titleFor(k), sectionLabelFor(k, 'ACCOUNT HEALTH'), notesFor(k));
      break;
    }
    case 'carrierSpendGMV': {
      const statsRows = props.statsRows ?? [];
      if (statsRows.length) buildCarrierSpendGMVSlide(pptx, statsRows, slideNum, titleFor(k), sectionLabelFor(k, 'ACCOUNT HEALTH'), notesFor(k));
      break;
    }
    case 'fulfillmentMix': {
      const statsRows = props.statsRows ?? [];
      if (statsRows.length) buildFulfillmentMixSlide(pptx, statsRows, slideNum, titleFor(k), sectionLabelFor(k, 'ACCOUNT HEALTH'), notesFor(k));
      break;
    }
    case 'childAccountScorecard': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, 'ACCOUNT HEALTH'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
    case 'shippingKPIs': {
      const { kpis } = props;
      const insight = section.insight;
      if (!kpis) {
        buildInsightSlide(pptx, sectionLabelFor(k, 'SHIPPING ANALYTICS'), titleFor(k), slideNum, insight, notesFor(k));
        break;
      }
      const allTiles = [
        { id: 'totalShipments', label: 'Total Shipments',  value: fmtN(kpis.totalShipments) },
        { id: 'totalLabelCost', label: 'Total Label Cost', value: fmtK(kpis.totalLabelCost) },
        { id: 'avgLabelCost',   label: 'Avg Cost/Ship',    value: fmt$(kpis.avgLabelCost) },
        { id: 'accounts',       label: 'Accounts',         value: fmtN(kpis.uniqueAccounts) },
        ...(kpis.avgZone !== null ? [{ id: 'avgZone',    label: 'Avg Zone',    value: kpis.avgZone.toFixed(1) }] : []),
        ...(kpis.totalCharged > 0 ? [{ id: 'totalBilled', label: 'Total Billed', value: fmtK(kpis.totalCharged) }] : []),
      ];
      buildKpiTilesSlide(pptx, sectionLabelFor(k, 'SHIPPING ANALYTICS'), titleFor(k), slideNum, applyKpiFilter(allTiles, section.kpiFilter), insight, notesFor(k));
      break;
    }
    case 'zoneMap': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, 'NETWORK ANALYSIS'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
    case 'warehouseInsights': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, 'NETWORK OPTIMIZATION'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
    case 'shipmentsByState': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, 'GEOGRAPHIC DISTRIBUTION'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
    case 'inventoryKPIs': {
      const { inventoryData } = props;
      const insight = section.insight;
      if (!inventoryData) {
        buildInsightSlide(pptx, sectionLabelFor(k, 'INVENTORY OVERVIEW'), titleFor(k), slideNum, insight, notesFor(k));
        break;
      }
      const loc = inventoryData.locRows ?? [];
      const skuSet = new Set(loc.map(r => `${r.client}::${r.sku}`));
      const totalUnits = loc.filter(r => r.pickable && r.sellable).reduce((s, r) => s + r.units, 0);
      const expiring90 = loc.filter(r => r.hasLot && r.daysToExpire !== null && (r.daysToExpire as number) <= 90).length;
      const movingDOH = inventoryData.daysOnHand.filter(r => r.doh !== null);
      const avgDOHVal = movingDOH.length ? Math.round(movingDOH.reduce((s, r) => s + r.doh!, 0) / movingDOH.length) : null;
      const manualAdj = inventoryData.manualAdjRows?.length ?? 0;
      const allTiles = [
        { id: 'activeSkus',  label: 'Active SKUs',         value: loc.length ? fmtN(skuSet.size) : '—' },
        { id: 'totalUnits',  label: 'Total Units on Hand',  value: loc.length ? fmtN(totalUnits) : '—' },
        { id: 'expiring90',  label: 'Expiring < 90 Days',  value: loc.length ? fmtN(expiring90) : '—', color: expiring90 > 0 ? C.RED : C.NAVY },
        { id: 'avgDOH',      label: 'Avg Days on Hand',     value: avgDOHVal !== null ? `${avgDOHVal}d` : '—' },
        { id: 'manualAdj',   label: 'Manual Adjustments',   value: fmtN(manualAdj) },
      ];
      buildKpiTilesSlide(pptx, sectionLabelFor(k, 'INVENTORY OVERVIEW'), titleFor(k), slideNum, applyKpiFilter(allTiles, section.kpiFilter), insight, notesFor(k));
      break;
    }
    case 'rateCardKPIs': {
      const { zoneComparisons } = props;
      const insight = section.insight;
      if (!zoneComparisons.length) {
        buildInsightSlide(pptx, sectionLabelFor(k, 'RATE CARD ANALYSIS'), titleFor(k), slideNum, insight, notesFor(k));
        break;
      }
      const total      = zoneComparisons.reduce((a, b) => a + b.shipmentCount, 0);
      const mrcTotal   = zoneComparisons.reduce((a, b) => a + b.rateCardAvg * b.shipmentCount, 0);
      const actTotal   = zoneComparisons.reduce((a, b) => a + b.actualAvg   * b.shipmentCount, 0);
      const totalDelta = actTotal - mrcTotal;
      const wDelta     = zoneComparisons.reduce((a, b) => a + b.delta * b.shipmentCount, 0) / (total || 1);
      const allTiles = [
        { id: 'totalShipments', label: 'Shipments Analyzed', value: fmtN(total) },
        { id: 'mrcTotal',       label: 'ShipHero MRC Total', value: fmtK(mrcTotal) },
        { id: 'actualTotal',    label: 'Actual Total Paid',  value: fmtK(actTotal) },
        { id: 'totalDelta',     label: 'Total Delta',        value: `${totalDelta >= 0 ? '+' : ''}${fmtK(totalDelta)}`, color: totalDelta > 0.01 ? C.RED : C.GREEN },
        { id: 'zonesAnalyzed',  label: 'Zones Analyzed',     value: `${zoneComparisons.length}` },
        { id: 'avgRateDelta',   label: 'Avg Rate Delta',     value: `${wDelta >= 0 ? '+' : ''}$${wDelta.toFixed(2)}`, color: wDelta > 0 ? C.RED : C.GREEN },
        { id: 'zonesAboveMRC',  label: 'Zones Above MRC',    value: `${zoneComparisons.filter(z => z.delta > 0).length}` },
      ];
      buildKpiTilesSlide(pptx, sectionLabelFor(k, 'RATE CARD ANALYSIS'), titleFor(k), slideNum, applyKpiFilter(allTiles, section.kpiFilter), insight, notesFor(k));
      break;
    }
    case 'threePlKPIs': {
      const { kpis, customerStats } = props;
      const insight = section.insight;
      if (!kpis) {
        buildInsightSlide(pptx, sectionLabelFor(k, '3PL OVERVIEW'), titleFor(k), slideNum, insight, notesFor(k));
        break;
      }
      const allTiles = [
        { id: '3plAccounts',    label: '3PL Accounts',    value: fmtN(kpis.uniqueAccounts) },
        { id: 'totalShipments', label: 'Total Shipments', value: fmtN(kpis.totalShipments) },
        { id: 'totalLabelCost', label: 'Total Label Cost', value: fmtK(kpis.totalLabelCost) },
        { id: 'avgLabelCost',   label: 'Avg Label Cost',  value: fmt$(kpis.avgLabelCost) },
        ...(kpis.totalCharged > 0 ? [{ id: 'totalBilled', label: 'Total Billed', value: fmtK(kpis.totalCharged) }] : []),
        ...(customerStats[0] ? [{ id: 'topAccount', label: 'Top Account', value: trunc(customerStats[0].customer, 16) }] : []),
      ];
      buildKpiTilesSlide(pptx, sectionLabelFor(k, '3PL OVERVIEW'), titleFor(k), slideNum, applyKpiFilter(allTiles, section.kpiFilter), insight, notesFor(k));
      break;
    }
    case 'accountDetailTable': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, '3PL ACCOUNT DETAIL'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
    case 'accountHealthKPIs': {
      const statsRows = props.statsRows ?? [];
      const deduped = dedupeWarehouseRows(statsRows);
      const insight = section.insight;
      if (!deduped.length) {
        buildInsightSlide(pptx, sectionLabelFor(k, 'ACCOUNT HEALTH'), titleFor(k), slideNum, insight, notesFor(k));
        break;
      }
      const t = deduped.reduce((acc, r) => ({
        orders: acc.orders + r.orderCount,
        labels: acc.labels + r.labelCount,
        spend:  acc.spend  + r.carrierSpend,
        gmv:    acc.gmv    + r.gmv,
      }), { orders: 0, labels: 0, spend: 0, gmv: 0 });
      const allTiles = [
        { id: 'orders',       label: 'Orders',        value: fmtN(t.orders) },
        { id: 'labels',       label: 'Labels',         value: fmtN(t.labels) },
        { id: 'carrierSpend', label: 'Carrier Spend',  value: fmtK(t.spend) },
        { id: 'gmv',          label: 'GMV',            value: fmtK(t.gmv) },
      ];
      buildKpiTilesSlide(pptx, sectionLabelFor(k, 'ACCOUNT HEALTH'), titleFor(k), slideNum, applyKpiFilter(allTiles, section.kpiFilter), insight, notesFor(k));
      break;
    }
    case 'priorQuarterKPIs': {
      const { kpis, priorPeriod } = props;
      const insight = section.insight;
      if (!kpis || !priorPeriod) {
        buildInsightSlide(pptx, sectionLabelFor(k, 'PRIOR QUARTER'), titleFor(k), slideNum, insight, notesFor(k));
        break;
      }
      const shipDelta  = kpis.totalShipments - priorPeriod.totalShipments;
      const spendDelta = kpis.totalLabelCost  - priorPeriod.totalSpend;
      const costDelta  = kpis.avgLabelCost    - priorPeriod.avgLabelCost;
      const pctStr = (d: number, base: number) => base === 0 ? '—' : `${d >= 0 ? '+' : ''}${((d / base) * 100).toFixed(1)}%`;
      const allTiles = [
        { id: 'shipmentsChange', label: 'Shipments Δ',  value: `${shipDelta >= 0 ? '+' : ''}${fmtN(shipDelta)}`,      color: shipDelta >= 0 ? C.GREEN : C.RED },
        { id: 'spendChange',     label: 'Spend Δ',      value: `${spendDelta >= 0 ? '+' : ''}${fmtK(spendDelta)}`,    color: spendDelta <= 0 ? C.GREEN : C.RED },
        { id: 'avgCostChange',   label: 'Avg Cost Δ',   value: `${costDelta >= 0 ? '+' : ''}$${costDelta.toFixed(2)}`, color: costDelta <= 0 ? C.GREEN : C.RED },
        { id: 'priorPeriod',     label: 'Prior Period',  value: pctStr(shipDelta, priorPeriod.totalShipments) },
      ];
      buildKpiTilesSlide(pptx, sectionLabelFor(k, 'PRIOR QUARTER'), titleFor(k), slideNum, applyKpiFilter(allTiles, section.kpiFilter), insight, notesFor(k));
      break;
    }
    case 'priorQuarterCarrierMix': {
      const insight = section.insight;
      buildInsightSlide(pptx, sectionLabelFor(k, 'PRIOR QUARTER'), titleFor(k), slideNum, insight, notesFor(k));
      break;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main export
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateQBRDeck(
  props: QBRDeckDocumentProps,
  onProgress?: (msg: string) => void,
): Promise<Blob> {
  // Set section label font size based on font option
  _sectionLabelFontSize = props.fontOption === 'A' ? 8 : props.fontOption === 'C' ? 12 : 10;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  // ── Track last added slide so we can apply narrative overlay ──────────────
  let _lastBuiltSlide: PptxGenJS.Slide | null = null;
  const _origAddSlide = pptx.addSlide.bind(pptx);
  (pptx as unknown as { addSlide: (n?: string) => PptxGenJS.Slide }).addSlide = (n?: string) => {
    _lastBuiltSlide = _origAddSlide(n);
    return _lastBuiltSlide;
  };
  pptx.author = 'ShipHero';
  pptx.subject = `QBR Deck — ${props.clientName}`;
  pptx.title   = `ShipHero QBR — ${props.clientName}`;

  const SECTION_LABELS_LOCAL: Record<DeckSectionKey, string> = {
    agenda:                'Agenda',
    introductions:         'Introductions',
    accountOverview:       'Account Overview',
    costGap:               'Shipping Cost Analysis',
    carrierMix:            'Carrier Mix',
    serviceLevelMix:       'Service Level Mix',
    labelCostByCarrier:    'Label Cost by Carrier',
    zonePerformance:       'Rate Card Performance',
    expiryAlerts:          'Inventory Expiry Alerts',
    daysOnHand:            'Inventory Days on Hand',
    recommendedActions:    'Recommended Actions',
    volumeTrend:           'Total Volume Trend',
    childAccountTrends:    'Child Account Trends',
    carrierSpendGMV:       'Carrier Spend vs GMV',
    fulfillmentMix:        'Fulfillment Mix',
    childAccountScorecard: 'Child Account Scorecard',
    manualAdjustments:     'Manual Adjustments',
    shippingKPIs:          'Shipping Overview',
    upsAvgCost:            'UPS Avg Cost by Zone',
    upsZoneBreakdown:      'UPS Zone-by-Zone Breakdown',
    zoneMap:               'Zone Distribution Map',
    warehouseInsights:     'Warehouse Insights',
    shipmentsByState:      'Shipments by State',
    inventoryKPIs:         'Inventory Summary',
    rateCardKPIs:          'Rate Card Summary',
    threePlKPIs:           '3PL Account Summary',
    accountDetailTable:    'Account Detail Table',
    accountHealthKPIs:     'Account Health Summary',
    priorQuarterKPIs:      'Prior Quarter KPIs',
    priorQuarterCarrierMix:'Prior Quarter Carrier Mix',
  };

  // Build a custom label map from sections that have been renamed
  const customLabelMap = new Map(
    props.enabledSections
      .filter(s => !!s.customLabel)
      .map(s => [s.key, s.customLabel as string])
  );
  const titleFor = (key: DeckSectionKey) => customLabelMap.get(key) ?? SECTION_LABELS_LOCAL[key];

  // Section label override (uppercase category label above title)
  const sectionLabelOverrideMap = new Map(
    props.enabledSections
      .filter(s => !!s.sectionLabel)
      .map(s => [s.key, s.sectionLabel as string])
  );
  const sectionLabelFor = (key: DeckSectionKey, fallback: string) =>
    sectionLabelOverrideMap.get(key) ?? fallback;

  // Speaker notes helper
  const notesFor = (key: DeckSectionKey) =>
    props.enabledSections.find(s => s.key === key)?.notes;

  // Active data sections (enabled + not hidden), in their current order
  const activeDataSections = props.enabledSections.filter(s => s.enabled && !s.hidden);
  const activeDataKeys = new Set(activeDataSections.map(s => s.key));

  // Build agenda items from active sections (exclude 'agenda' itself)
  const AGENDA_KEYS: DeckSectionKey[] = [
    'introductions', 'accountOverview', 'costGap', 'carrierMix',
    'serviceLevelMix', 'labelCostByCarrier',
    'zonePerformance', 'expiryAlerts', 'daysOnHand', 'recommendedActions',
    'volumeTrend', 'childAccountTrends', 'carrierSpendGMV', 'fulfillmentMix',
    'childAccountScorecard', 'manualAdjustments',
    'shippingKPIs', 'zoneMap', 'warehouseInsights', 'shipmentsByState',
    'upsAvgCost', 'upsZoneBreakdown',
    'inventoryKPIs', 'rateCardKPIs', 'threePlKPIs', 'accountHealthKPIs', 'accountDetailTable',
    'priorQuarterKPIs', 'priorQuarterCarrierMix',
  ];
  // Preserve order from activeDataSections for agenda
  const agendaItems: AgendaItem[] = activeDataSections
    .filter(s => AGENDA_KEYS.includes(s.key))
    .map((s, i) => ({ num: i + 1, label: titleFor(s.key) }));

  // Build custom slide index by orderKey
  const customByKey: Record<string, CustomDeckSlide[]> = {};
  for (const cs of (props.customSlides ?? []).filter(c => c.enabled && !c.hidden)) {
    (customByKey[cs.orderKey] ??= []).push(cs);
  }

  let slideNum = 1;

  onProgress?.('Building slides…');
  await new Promise(r => setTimeout(r, 0));

  buildCoverSlide(pptx, props, slideNum++);

  // ── Snapshot-image slide builder ─────────────────────────────────────────
  // When a section or instance has a pre-rendered PNG snapshot, embed it as an
  // image instead of rebuilding from raw data (fixes Google Slides blurriness).
  const buildSnapshotSlide = (
    snapshot: string,
    label: string,
    num: number,
    notes?: string,
    narrative?: string,
  ) => {
    const slide = pptx.addSlide();
    // Full-bleed background
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
    addSlideMark(slide, num);
    // Embed snapshot as image, fitted inside the content area (right of sidebar)
    const imgArea = { x: 0.38, y: 0.18, w: W - 0.46, h: H - 0.22 };
    const size = readImageSize(snapshot);
    const dims = size ? fitImage(size.w, size.h, imgArea.x, imgArea.y, imgArea.w, imgArea.h) : imgArea;
    slide.addImage({ data: snapshot, x: dims.x, y: dims.y, w: dims.w, h: dims.h });
    // Slide number + label
    slide.addText(label.toUpperCase(), {
      x: 0.38, y: 0.06, w: 7, h: 0.16,
      fontSize: _sectionLabelFontSize, bold: true, color: C.GRAY, charSpacing: 0.5,
    });
    if (notes) slide.addNotes(notes);
    if (narrative?.trim()) addNarrativeOverlay(slide, narrative);
  };

  // ── Misc slide builders ────────────────────────────────────────────────────
  const buildQASlide = (title: string, subtitle: string | undefined, num: number, notes?: string) => {
    const slide = pptx.addSlide();
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.NAVY }, line: { color: C.NAVY } });
    slide.addText(title || 'Q&A', {
      x: 1.0, y: subtitle ? 1.6 : 1.9, w: 8.0, h: 1.0,
      fontSize: 44, bold: true, color: C.WHITE, align: 'center',
    });
    if (subtitle) {
      slide.addText(subtitle, {
        x: 1.0, y: 2.75, w: 8.0, h: 0.4,
        fontSize: 14, color: '94A3B8', align: 'center',
      });
    }
    slide.addShape('rect', { x: 3.5, y: subtitle ? 3.3 : 3.1, w: 3.0, h: 0.06, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    addSlideMark(slide, num, true);
    if (notes) slide.addNotes(notes);
  };

  const buildThankYouSlide = (title: string, body: string | undefined, num: number, notes?: string) => {
    const slide = pptx.addSlide();
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.NAVY }, line: { color: C.NAVY } });
    slide.addText(title || 'Thank You', {
      x: 1.0, y: body ? 0.9 : 1.9, w: 8.0, h: 0.9,
      fontSize: 38, bold: true, color: C.WHITE, align: 'center',
    });
    if (body) {
      const lines = body.split('\n').filter(Boolean);
      slide.addText(lines.map(t => ({ text: t, options: { bullet: true } })), {
        x: 2.0, y: 2.0, w: 6.0, h: 1.8,
        fontSize: 13, color: 'CBD5E1', lineSpacingMultiple: 1.5, valign: 'top',
      });
    }
    slide.addShape('rect', { x: 3.5, y: body ? 3.95 : 3.0, w: 3.0, h: 0.06, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    addSlideMark(slide, num, true);
    if (notes) slide.addNotes(notes);
  };

  const buildQuoteSlide = (title: string, body: string | undefined, subtitle: string | undefined, num: number, notes?: string) => {
    const slide = pptx.addSlide();
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
    addSlideMark(slide, num);
    // Decorative quotation mark
    slide.addText('\u201C', { x: 0.5, y: 0.3, w: 1.5, h: 1.2, fontSize: 96, color: C.BLUE, bold: true, valign: 'top' });
    const quoteText = body || title;
    slide.addText(quoteText, {
      x: 0.7, y: 1.1, w: 8.6, h: 2.0,
      fontSize: 20, color: C.DARK, bold: false, italic: true,
      lineSpacingMultiple: 1.45, wrap: true, valign: 'middle', align: 'center',
    });
    if (subtitle) {
      slide.addText(`\u2014 ${subtitle}`, {
        x: 0.7, y: 3.2, w: 8.6, h: 0.4,
        fontSize: 12, color: C.GRAY, align: 'center',
      });
    }
    slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    if (notes) slide.addNotes(notes);
  };

  const buildTwoColSlide = (title: string, leftCol: string | undefined, rightCol: string | undefined, num: number, notes?: string) => {
    const slide = pptx.addSlide();
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
    addSlideMark(slide, num);
    addSlideTitle(slide, 'CUSTOM', title, 0.8, 0.28);
    const colY = BODY_Y, colH = 2.8, colW = 3.9, gap = 0.3;
    const lx = 0.8, rx = lx + colW + gap;
    // Left column box
    slide.addShape('rect', { x: lx, y: colY, w: colW, h: colH, fill: { color: C.WHITE }, line: { color: '#E5E7EB', pt: 1 } });
    if (leftCol) slide.addText(leftCol, { x: lx + 0.15, y: colY + 0.15, w: colW - 0.3, h: colH - 0.3, fontSize: 12, color: C.GRAY, wrap: true, valign: 'top', lineSpacingMultiple: 1.5 });
    // Right column box
    slide.addShape('rect', { x: rx, y: colY, w: colW, h: colH, fill: { color: C.WHITE }, line: { color: '#E5E7EB', pt: 1 } });
    if (rightCol) slide.addText(rightCol, { x: rx + 0.15, y: colY + 0.15, w: colW - 0.3, h: colH - 0.3, fontSize: 12, color: C.GRAY, wrap: true, valign: 'top', lineSpacingMultiple: 1.5 });
    slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    if (notes) slide.addNotes(notes);
  };

  const buildImageSlide = (title: string, imageData: string | undefined, num: number, notes?: string) => {
    const slide = pptx.addSlide();
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
    addSlideMark(slide, num);
    if (imageData) {
      const hasTitle = !!title;
      const imgArea = hasTitle
        ? { x: 0.38, y: 0.55, w: W - 0.46, h: H - 0.72 }
        : { x: 0.38, y: 0.18, w: W - 0.46, h: H - 0.28 };
      const size = readImageSize(imageData);
      const dims = size ? fitImage(size.w, size.h, imgArea.x, imgArea.y, imgArea.w, imgArea.h) : imgArea;
      slide.addImage({ data: imageData, x: dims.x, y: dims.y, w: dims.w, h: dims.h });
      if (hasTitle) {
        slide.addText(title, { x: 0.38, y: 0.1, w: 9.24, h: 0.38, fontSize: 16, bold: true, color: C.DARK });
      }
    } else {
      // Placeholder
      slide.addShape('rect', { x: 1.0, y: 0.8, w: 8.0, h: 3.2, fill: { color: '#D1D5DB' }, line: { color: '#9CA3AF', pt: 1 } });
      slide.addText('[ Upload an image in the editor ]', { x: 1.0, y: 2.1, w: 8.0, h: 0.6, fontSize: 13, color: C.GRAY, align: 'center' });
    }
    slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    if (notes) slide.addNotes(notes);
  };

  const buildBlankSlide = (title: string, num: number, notes?: string) => {
    const slide = pptx.addSlide();
    slide.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: C.LIGHT_BG }, line: { color: C.LIGHT_BG } });
    addSlideMark(slide, num);
    if (title) {
      addSlideTitle(slide, '', title, 0.8, 0.28);
    }
    slide.addShape('rect', { x: 0, y: H - 0.1, w: W, h: 0.1, fill: { color: C.ORANGE }, line: { color: C.ORANGE } });
    if (notes) slide.addNotes(notes);
  };

  // Helper to emit custom slides
  const buildCustom = (cs: CustomDeckSlide) => {
    const count = 1 + (cs.duplicates ?? 0);
    for (let d = 0; d < count; d++) {
      switch (cs.variant) {
        case 'divider':   buildDividerSlide(pptx, cs.title, cs.subtitle, slideNum++, cs.notes); break;
        case 'text':      buildTextSlide(pptx, cs.title, cs.body, 'CUSTOM', slideNum++, false, cs.notes); break;
        case 'qa':        buildQASlide(cs.title, cs.subtitle, slideNum++, cs.notes); break;
        case 'thankyou':  buildThankYouSlide(cs.title, cs.body, slideNum++, cs.notes); break;
        case 'quote':     buildQuoteSlide(cs.title, cs.body, cs.subtitle, slideNum++, cs.notes); break;
        case 'twocol':    buildTwoColSlide(cs.title, cs.body, cs.rightCol, slideNum++, cs.notes); break;
        case 'image':     buildImageSlide(cs.title, cs.imageData, slideNum++, cs.notes); break;
        case 'blank':     buildBlankSlide(cs.title, slideNum++, cs.notes); break;
        default:          buildTextSlide(pptx, cs.title, cs.body, 'CUSTOM', slideNum++, false, cs.notes); break;
      }
    }
  };

  // Insert custom slides after cover
  for (const cs of customByKey['after:cover'] ?? []) buildCustom(cs);

  // Build data-instance index: parentKey → instances sorted by creation order
  const instancesByParent: Record<string, DataInstanceSlide[]> = {};
  for (const inst of (props.dataInstances ?? [])) {
    (instancesByParent[inst.parentKey] ??= []).push(inst);
  }
  // Also build instance-by-orderKey map for positioning overrides
  const instanceByOrderKey: Record<string, DataInstanceSlide[]> = {};
  for (const inst of (props.dataInstances ?? [])) {
    (instanceByOrderKey[inst.orderKey] ??= []).push(inst);
  }

  // Helper: emit a single DataInstanceSlide as a snapshot-image slide (or plain title if no snapshot)
  const buildInstance = (inst: DataInstanceSlide) => {
    const label = inst.customLabel ?? SECTION_LABELS_LOCAL[inst.parentKey];
    const useSnapshot = inst.snapshot && !isBlankSnapshot(inst.snapshot);
    if (useSnapshot) {
      buildSnapshotSlide(inst.snapshot!, label, slideNum++, inst.notes, inst.narrative);
    } else {
      if (inst.snapshot) console.warn(`[QBR] Blank snapshot discarded for instance: ${label}`);
      buildInsightSlide(pptx, 'ADDITIONAL SLIDE', label, slideNum++, inst.insight, inst.notes);
      if (inst.narrative?.trim() && _lastBuiltSlide) addNarrativeOverlay(_lastBuiltSlide, inst.narrative);
    }
  };

  // Iterate data sections in user-defined order
  for (const section of activeDataSections) {
    if (!activeDataKeys.has(section.key)) continue;
    onProgress?.(`Building: ${titleFor(section.key)}`);
    const wide = section.layout === 'wide';
    const count = 1 + (section.duplicates ?? 0);
    for (let d = 0; d < count; d++) {
      // Use snapshot if available and non-blank, otherwise rebuild from data
      const useSnapshot = section.snapshot && !isBlankSnapshot(section.snapshot);
      if (useSnapshot) {
        const label = (section.customLabel ?? SECTION_LABELS_LOCAL[section.key]);
        buildSnapshotSlide(section.snapshot!, label, slideNum++, notesFor(section.key), section.narrative);
      } else {
        if (section.snapshot) console.warn(`[QBR] Blank snapshot discarded for section: ${section.key}`);
        buildSectionSlide(pptx, section, wide, slideNum++, props, agendaItems, titleFor, sectionLabelFor, notesFor);
        if (section.narrative?.trim() && _lastBuiltSlide) {
          addNarrativeOverlay(_lastBuiltSlide, section.narrative);
        }
        if (section.callout && _lastBuiltSlide) {
          addCalloutPanel(_lastBuiltSlide, section.callout);
        }
      }
    }
    // Emit data instances positioned after this section
    for (const inst of instancesByParent[section.key] ?? []) {
      if (inst.orderKey === `after:${section.key}`) buildInstance(inst);
    }
    // Insert custom slides after this section
    for (const cs of customByKey[`after:${section.key}`] ?? []) buildCustom(cs);
  }

  // Emit any data instances not yet placed (orderKey doesn't match any active section)
  for (const inst of (props.dataInstances ?? [])) {
    if (!instancesByParent[inst.parentKey]?.includes(inst)) continue; // already emitted
    const anchor = inst.orderKey.startsWith('after:') ? inst.orderKey.slice(6) : null;
    if (anchor && activeDataKeys.has(anchor as DeckSectionKey)) continue; // was handled above
    buildInstance(inst);
  }

  // Insert custom slides at end
  for (const cs of customByKey['end'] ?? []) buildCustom(cs);

  onProgress?.('Packaging PPTX…');
  await new Promise(r => setTimeout(r, 0));

  const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
}
