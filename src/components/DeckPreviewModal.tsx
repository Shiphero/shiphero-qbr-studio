import { useState, useRef, useEffect } from 'react';
import { useDeck, SECTION_LABELS } from '../context/DeckContext';
import type { DeckSectionKey } from './pdf/QBRDeckDocument';
import { ScaledSlidePreview } from './LiveSlidePreview';
import type { SlidePreviewData } from './LiveSlidePreview';

// ─── Brand ────────────────────────────────────────────────────────────────────
const NAVY   = '#252F3E';
const ORANGE = '#EF5252';
const BLUE   = '#4472E8';
const LIGHT  = '#EDEEF2';
const FONT   = "'Metropolis', sans-serif";

// ─── Per-section content hints ────────────────────────────────────────────────
const SECTION_HINT: Record<DeckSectionKey, { type: string; chart: 'bar' | 'line' | 'area' | 'table' | 'list' | 'mixed' | 'pie' }> = {
  agenda:             { type: 'Agenda slide',               chart: 'list'  },
  introductions:      { type: 'Team introductions',         chart: 'mixed' },
  accountOverview:    { type: 'KPI summary + top accounts', chart: 'mixed' },
  costGap:            { type: 'Label cost vs charged',      chart: 'bar'   },
  carrierMix:         { type: 'Volume by carrier',          chart: 'pie'   },
  zonePerformance:    { type: 'Rate card vs actual zones',  chart: 'bar'   },
  expiryAlerts:       { type: 'Expiring inventory table',   chart: 'table' },
  daysOnHand:         { type: 'Stock levels vs velocity',   chart: 'bar'   },
  recommendedActions: { type: 'Action items',               chart: 'list'  },
  volumeTrend:        { type: 'Orders & labels over time',  chart: 'area'  },
  childAccountTrends: { type: 'Per-account trend lines',    chart: 'line'  },
  carrierSpendGMV:    { type: 'Carrier spend vs GMV',       chart: 'area'  },
  fulfillmentMix:        { type: 'SIB / MIB / Bulk mix',        chart: 'bar'   },
  serviceLevelMix:       { type: 'Shipments by service type',   chart: 'bar'   },
  labelCostByCarrier:    { type: 'Avg label cost per carrier',   chart: 'bar'   },
  childAccountScorecard: { type: 'Account health scorecard',     chart: 'table' },
  manualAdjustments:     { type: 'Inventory change audit log',   chart: 'table' },
  shippingKPIs:          { type: 'Shipping KPI summary',         chart: 'mixed' },
  upsAvgCost:            { type: 'UPS avg cost vs actual by zone', chart: 'bar'  },
  upsZoneBreakdown:      { type: 'UPS zone-by-zone comparison',  chart: 'table' },
  zoneMap:               { type: 'USPS zone distribution map',   chart: 'mixed' },
  warehouseInsights:     { type: 'Warehouse location insights',  chart: 'list'  },
  shipmentsByState:      { type: 'Shipments by destination state', chart: 'table' },
  inventoryKPIs:         { type: 'Inventory KPI summary',        chart: 'mixed' },
  rateCardKPIs:          { type: 'Rate card KPI summary',        chart: 'mixed' },
  threePlKPIs:           { type: '3PL account KPI summary',      chart: 'mixed' },
  accountDetailTable:    { type: 'Per-account detail table',     chart: 'table' },
  accountHealthKPIs:     { type: 'Orders, spend, GMV, billing',  chart: 'mixed' },
  priorQuarterKPIs:      { type: 'Prior vs current KPIs',        chart: 'mixed' },
  priorQuarterCarrierMix:{ type: 'Carrier mix comparison',       chart: 'bar'   },
};

// ─── Tiny chart placeholders ──────────────────────────────────────────────────
function ChartGlyph({ type }: { type: string }) {
  const s = { opacity: 0.18 };
  if (type === 'bar') return (
    <svg width="100%" height="100%" viewBox="0 0 80 44" fill="none" preserveAspectRatio="none">
      <rect x="4"  y="20" width="10" height="20" fill={BLUE}   style={s} />
      <rect x="18" y="10" width="10" height="30" fill={ORANGE} style={s} />
      <rect x="32" y="16" width="10" height="24" fill={BLUE}   style={s} />
      <rect x="46" y="6"  width="10" height="34" fill={ORANGE} style={s} />
      <rect x="60" y="14" width="10" height="26" fill={BLUE}   style={s} />
      <line x1="2" y1="42" x2="78" y2="42" stroke={NAVY} strokeWidth="1" opacity="0.1" />
    </svg>
  );
  if (type === 'line' || type === 'area') return (
    <svg width="100%" height="100%" viewBox="0 0 80 44" fill="none" preserveAspectRatio="none">
      {type === 'area' && <path d="M2 38 Q20 20 40 28 Q60 10 78 18 L78 42 L2 42Z" fill={BLUE} opacity="0.08" />}
      <path d="M2 38 Q20 20 40 28 Q60 10 78 18" stroke={BLUE}   strokeWidth="1.5" strokeLinecap="round" style={s} />
      {type === 'area' && <path d="M2 34 Q20 32 40 36 Q60 26 78 30" stroke={ORANGE} strokeWidth="1.5" strokeLinecap="round" style={s} />}
      <line x1="2" y1="42" x2="78" y2="42" stroke={NAVY} strokeWidth="1" opacity="0.1" />
    </svg>
  );
  if (type === 'pie') return (
    <svg width="100%" height="100%" viewBox="0 0 44 44" fill="none">
      <circle cx="22" cy="22" r="18" fill="none" stroke={BLUE}   strokeWidth="7" strokeDasharray="60 113" opacity="0.2" />
      <circle cx="22" cy="22" r="18" fill="none" stroke={ORANGE} strokeWidth="7" strokeDasharray="35 138" strokeDashoffset="-60" opacity="0.2" />
      <circle cx="22" cy="22" r="18" fill="none" stroke="#22C55E" strokeWidth="7" strokeDasharray="18 155" strokeDashoffset="-95" opacity="0.2" />
    </svg>
  );
  if (type === 'table') return (
    <svg width="100%" height="100%" viewBox="0 0 80 44" fill="none" preserveAspectRatio="none">
      {[0,1,2,3,4].map(i => (
        <rect key={i} x="2" y={4 + i * 8} width="76" height="6" rx="1" fill={NAVY} opacity={i === 0 ? 0.12 : 0.05} />
      ))}
    </svg>
  );
  if (type === 'list') return (
    <svg width="100%" height="100%" viewBox="0 0 80 44" fill="none" preserveAspectRatio="none">
      {[0,1,2,3].map(i => (
        <g key={i}>
          <circle cx="8" cy={10 + i * 10} r="2.5" fill={ORANGE} opacity="0.25" />
          <rect x="16" y={7 + i * 10} width={40 - i * 6} height="5" rx="2" fill={NAVY} opacity="0.08" />
        </g>
      ))}
    </svg>
  );
  return (
    <svg width="100%" height="100%" viewBox="0 0 80 44" fill="none" preserveAspectRatio="none">
      <rect x="2"  y="4"  width="34" height="16" rx="2" fill={BLUE}  opacity="0.07" />
      <rect x="44" y="4"  width="34" height="16" rx="2" fill={BLUE}  opacity="0.07" />
      <rect x="2"  y="26" width="76" height="5"  rx="2" fill={NAVY}  opacity="0.06" />
      <rect x="2"  y="35" width="60" height="5"  rx="2" fill={NAVY}  opacity="0.04" />
    </svg>
  );
}

// ─── Slide visual only (no label) ─────────────────────────────────────────────
function SlideThumbnail({
  isCover,
  sectionKey,
  clientName,
  reportingPeriod,
  hasInsight,
  label,
}: {
  isCover?: boolean;
  sectionKey?: DeckSectionKey;
  clientName?: string;
  reportingPeriod?: string;
  hasInsight?: boolean;
  label: string;
}) {
  const hint = sectionKey ? SECTION_HINT[sectionKey] : null;

  return (
    <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)' }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        {isCover ? (
          <div style={{ width: '100%', height: '100%', background: NAVY, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '5%', background: ORANGE }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: '12%', paddingRight: '6%' }}>
              <div style={{ fontSize: 7, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', marginBottom: 6, fontFamily: FONT }}>QUARTERLY BUSINESS REVIEW</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', lineHeight: 1.2, marginBottom: 4, fontFamily: FONT }}>{clientName || 'Client Name'}</div>
              {reportingPeriod && <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', fontFamily: FONT }}>{reportingPeriod}</div>}
            </div>
            <div style={{ height: '4%', background: `linear-gradient(90deg, ${ORANGE}, ${BLUE})` }} />
          </div>
        ) : (
          <div style={{ width: '100%', height: '100%', background: LIGHT, display: 'flex', position: 'relative' }}>
            <div style={{ width: '7%', background: NAVY, flexShrink: 0, display: 'flex', alignItems: 'flex-end', paddingBottom: '6%' }}>
              <div style={{ width: '60%', height: '25%', background: ORANGE, margin: '0 auto', borderRadius: 1 }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8% 6% 6% 5%' }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: NAVY, lineHeight: 1.2, marginBottom: 4, fontFamily: FONT }}>{label}</div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {hint && <ChartGlyph type={hint.chart} />}
              </div>
            </div>
            {hasInsight && (
              <div style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 0 2px #fff' }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Editable label below thumbnail ──────────────────────────────────────────
function EditableLabel({
  sectionKey,
  slideNum,
  insightText,
  contentType,
  isCover,
}: {
  sectionKey?: DeckSectionKey;
  slideNum: number;
  insightText?: string;
  contentType?: string;
  isCover?: boolean;
}) {
  const { sections, setCustomLabel } = useDeck();
  const [editing, setEditing] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const section = sectionKey ? sections.find(s => s.key === sectionKey) : undefined;
  const currentLabel = section?.customLabel || (sectionKey ? SECTION_LABELS[sectionKey] : 'Cover slide');
  const isModified = !!section?.customLabel;

  const [draft, setDraft] = useState(currentLabel);

  // Keep draft in sync when external label changes
  useEffect(() => { if (!editing) setDraft(currentLabel); }, [currentLabel, editing]);

  const startEdit = () => {
    if (isCover || !sectionKey) return;
    setDraft(currentLabel);
    setEditing(true);
  };

  const commit = () => {
    if (!sectionKey) return;
    const trimmed = draft.trim();
    setCustomLabel(sectionKey, trimmed || undefined);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(currentLabel);
    setEditing(false);
  };

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 400, fontFamily: FONT, flexShrink: 0 }}>{slideNum}</span>

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') cancel(); }}
            style={{
              flex: 1, fontSize: 11, fontWeight: 500, color: NAVY,
              fontFamily: FONT, border: 'none', borderBottom: `1.5px solid ${BLUE}`,
              outline: 'none', padding: '1px 0', background: 'transparent',
              minWidth: 0,
            }}
          />
        ) : (
          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={startEdit}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0,
              cursor: isCover ? 'default' : 'text',
            }}
          >
            <span style={{
              fontSize: 11, fontWeight: 500,
              color: isModified ? BLUE : NAVY,
              fontFamily: FONT,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {currentLabel}
            </span>
            {!isCover && hovered && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#9CA3AF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M8.5 1.5a1.5 1.5 0 0 1 2 2L3.5 10.5l-3 1 1-3z" />
              </svg>
            )}
            {isModified && !hovered && (
              <span style={{ fontSize: 9, color: BLUE, opacity: 0.6, flexShrink: 0 }}>&#9998;</span>
            )}
          </div>
        )}
      </div>

      {insightText ? (
        <p style={{ margin: 0, fontSize: 10, color: '#6B7280', fontFamily: FONT, lineHeight: 1.4,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {insightText}
        </p>
      ) : !isCover && sectionKey && !['agenda', 'introductions', 'recommendedActions'].includes(sectionKey) ? (
        <p style={{ margin: 0, fontSize: 10, color: '#D1D5DB', fontFamily: FONT, fontStyle: 'italic' }}>No insight written</p>
      ) : (
        <p style={{ margin: 0, fontSize: 10, color: '#9CA3AF', fontFamily: FONT }}>{contentType ?? 'Auto-generated'}</p>
      )}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
interface DeckPreviewModalProps {
  clientName: string;
  reportingPeriod: string;
  data: SlidePreviewData;
  onClose: () => void;
  onDownload: () => void;
  generating: boolean;
}

export default function DeckPreviewModal({
  clientName,
  reportingPeriod,
  data,
  onClose,
  onDownload,
  generating,
}: DeckPreviewModalProps) {
  const { sections, availability } = useDeck();

  const enabledSections = sections.filter(s => s.enabled && availability[s.key].available);
  const totalSlides = enabledSections.length + 1;

  const missingInsights = enabledSections.filter(s =>
    !s.insight && !['agenda', 'introductions', 'recommendedActions'].includes(s.key)
  ).length;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,28,46,0.6)', zIndex: 1100 }} />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(92vw, 1100px)',
        height: 'min(90vh, 820px)',
        background: '#fff',
        borderRadius: 16,
        border: '0.5px solid rgba(0,0,0,0.1)',
        zIndex: 1101,
        display: 'flex', flexDirection: 'column',
        fontFamily: FONT,
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '20px 28px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.08)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 500, color: NAVY, marginBottom: 4 }}>Deck preview</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#6B7280', fontWeight: 400 }}>
                  {totalSlides} slide{totalSlides !== 1 ? 's' : ''} · 16:9 PPTX
                </span>
                {missingInsights > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 5, background: 'rgba(234,179,8,0.1)', border: '0.5px solid rgba(234,179,8,0.3)', color: '#92400E' }}>
                    &#9888; {missingInsights} slide{missingInsights !== 1 ? 's' : ''} missing insight
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#9CA3AF' }}>· Click any slide name to rename it</span>
              </div>
            </div>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.1)', background: '#F9FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round">
                <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
              </svg>
            </button>
          </div>
        </div>

        {/* Slide grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '28px 20px' }}>

            {/* Cover */}
            <div>
              <SlideThumbnail isCover clientName={clientName} reportingPeriod={reportingPeriod} label="Cover slide" />
              <EditableLabel slideNum={1} isCover contentType="Client name, period, logo" />
            </div>

            {/* Enabled sections */}
            {enabledSections.map((sec, i) => {
              const hint = SECTION_HINT[sec.key];
              const label = sec.customLabel || SECTION_LABELS[sec.key];
              return (
                <div key={sec.key}>
                  <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)' }}>
                    <ScaledSlidePreview
                      sectionKey={sec.key}
                      label={label}
                      data={data}
                      displayWidth={220}
                      borderRadius={7}
                    />
                    {sec.insight && (
                      <div style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: '50%', background: '#22C55E', boxShadow: '0 0 0 2px #fff' }} />
                    )}
                  </div>
                  <EditableLabel
                    sectionKey={sec.key}
                    slideNum={i + 2}
                    insightText={sec.insight?.whatHappening}
                    contentType={hint?.type}
                  />
                </div>
              );
            })}

            {enabledSections.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: '#9CA3AF' }}>
                  No slides selected yet. Go back and use <strong style={{ color: NAVY }}>Add to deck</strong> on the charts you want to include.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 28px', borderTop: '0.5px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: '#FAFAFA' }}>
          <div style={{ fontSize: 11, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
              Green dot = insight written
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: BLUE }}>&#9998;</span>
              Blue name = renamed
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, border: '0.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 400, cursor: 'pointer', fontFamily: FONT }}>
              Back to editor
            </button>
            <button
              onClick={onDownload}
              disabled={generating}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 8, border: 'none', background: generating ? '#D1D5DB' : NAVY, color: generating ? '#9CA3AF' : '#fff', fontSize: 13, fontWeight: 500, cursor: generating ? 'not-allowed' : 'pointer', fontFamily: FONT, transition: 'background 0.15s' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {generating ? 'Building\u2026' : 'Download PPTX'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
