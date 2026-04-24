import { useState } from 'react';
import { useDeck, SECTION_LABELS, SECTION_ORDER } from '../context/DeckContext';
import type { DeckSectionKey, SectionInsight } from './pdf/QBRDeckDocument';

// ─── Brand ────────────────────────────────────────────────────────────────────
const NAVY   = '#252F3E';
const ORANGE = '#EF5252';
const BLUE   = '#4472E8';
const LIGHT  = '#EDEEF2';
const FONT   = "'Metropolis', sans-serif";

// ─── Action options ───────────────────────────────────────────────────────────
const RECOMMENDED_ACTIONS = [
  { value: '',                        label: 'Select an action…' },
  { value: 'rate-optimization',       label: 'Rate optimization' },
  { value: 'volume-incentive',        label: 'Volume incentive' },
  { value: 'carrier-diversification', label: 'Carrier diversification' },
  { value: 'operational-review',      label: 'Operational review' },
  { value: 'onboarding-review',       label: 'Onboarding review' },
  { value: 'no-action',               label: 'No action needed' },
  { value: 'custom',                  label: 'Custom action' },
];

const ACTION_LABEL: Record<string, string> = Object.fromEntries(
  RECOMMENDED_ACTIONS.filter(a => a.value).map(a => [a.value, a.label])
);

// ─── Per-section visual hints ─────────────────────────────────────────────────
const SECTION_HINT: Record<DeckSectionKey, { category: string; chart: 'bar' | 'line' | 'area' | 'table' | 'list' | 'mixed' | 'pie' }> = {
  agenda:             { category: 'Structure',       chart: 'list'  },
  introductions:      { category: 'Structure',       chart: 'mixed' },
  accountOverview:    { category: 'Shipping',        chart: 'mixed' },
  costGap:            { category: 'Billing',         chart: 'bar'   },
  carrierMix:         { category: 'Shipping',        chart: 'pie'   },
  zonePerformance:    { category: 'Rate card',       chart: 'bar'   },
  expiryAlerts:       { category: 'Inventory',       chart: 'table' },
  daysOnHand:         { category: 'Inventory',       chart: 'bar'   },
  recommendedActions: { category: 'Next steps',      chart: 'list'  },
  volumeTrend:        { category: 'Account health',  chart: 'area'  },
  childAccountTrends: { category: 'Account health',  chart: 'line'  },
  carrierSpendGMV:    { category: 'Account health',  chart: 'area'  },
  fulfillmentMix:        { category: 'Account health',  chart: 'bar'   },
  serviceLevelMix:       { category: 'Shipping',        chart: 'bar'   },
  labelCostByCarrier:    { category: 'Billing',         chart: 'bar'   },
  childAccountScorecard: { category: 'Account health',  chart: 'table' },
  manualAdjustments:     { category: 'Inventory',       chart: 'table' },
  shippingKPIs:          { category: 'Shipping',        chart: 'mixed' },
  upsAvgCost:            { category: 'Rate card',       chart: 'bar'   },
  upsZoneBreakdown:      { category: 'Rate card',       chart: 'table' },
  zoneMap:               { category: 'Network',         chart: 'mixed' },
  warehouseInsights:     { category: 'Network',         chart: 'list'  },
  shipmentsByState:      { category: 'Shipping',        chart: 'table' },
  inventoryKPIs:         { category: 'Inventory',       chart: 'mixed' },
  rateCardKPIs:          { category: 'Rate card',       chart: 'mixed' },
  threePlKPIs:           { category: '3PL',             chart: 'mixed' },
  accountDetailTable:    { category: '3PL',              chart: 'table' },
  accountHealthKPIs:     { category: 'Account health',   chart: 'mixed' },
  priorQuarterKPIs:      { category: 'Prior quarter',    chart: 'mixed' },
  priorQuarterCarrierMix:{ category: 'Prior quarter',    chart: 'bar'   },
};

// ─── Mini chart glyph ─────────────────────────────────────────────────────────
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
      <rect x="2"  y="4"  width="34" height="16" rx="2" fill={BLUE} opacity="0.07" />
      <rect x="44" y="4"  width="34" height="16" rx="2" fill={BLUE} opacity="0.07" />
      <rect x="2"  y="26" width="76" height="5"  rx="2" fill={NAVY} opacity="0.06" />
      <rect x="2"  y="35" width="60" height="5"  rx="2" fill={NAVY} opacity="0.04" />
    </svg>
  );
}

// ─── Slide thumbnail (16:9) ───────────────────────────────────────────────────
function SlideMini({ sectionKey, label }: { sectionKey: DeckSectionKey; label: string }) {
  const hint = SECTION_HINT[sectionKey];
  return (
    <div style={{ width: 192, flexShrink: 0 }}>
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', borderRadius: 8, overflow: 'hidden', border: '0.5px solid rgba(0,0,0,0.1)' }}>
        <div style={{ position: 'absolute', inset: 0, background: LIGHT, display: 'flex' }}>
          <div style={{ width: '7%', background: NAVY, flexShrink: 0, display: 'flex', alignItems: 'flex-end', paddingBottom: '6%' }}>
            <div style={{ width: '60%', height: '25%', background: ORANGE, margin: '0 auto', borderRadius: 1 }} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8% 6% 6% 5%' }}>
            <div style={{ fontSize: 7, fontWeight: 700, color: NAVY, marginBottom: 3, fontFamily: FONT, lineHeight: 1.2 }}>{label}</div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ChartGlyph type={hint.chart} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 5, textAlign: 'center', fontSize: 9, color: '#9CA3AF', fontFamily: FONT, fontWeight: 400 }}>
        {hint.category}
      </div>
    </div>
  );
}

// ─── Individual recommendation card ──────────────────────────────────────────
function RecommendationCard({
  sectionKey,
  slideNum,
}: {
  sectionKey: DeckSectionKey;
  slideNum: number;
}) {
  const { sections, setInsight, availability } = useDeck();
  const section = sections.find(s => s.key === sectionKey)!;
  const label   = section.customLabel || SECTION_LABELS[sectionKey];
  const insight = section.insight;

  const [editing, setEditing]     = useState(false);
  const [dWhat, setDWhat]         = useState('');
  const [dWhy, setDWhy]           = useState('');
  const [dAction, setDAction]     = useState('');
  const [dNote, setDNote]         = useState('');

  const isStructural = ['agenda', 'introductions', 'recommendedActions'].includes(sectionKey);
  const avail = availability[sectionKey];

  const startEdit = () => {
    setDWhat(insight?.whatHappening ?? '');
    setDWhy(insight?.whyMatters ?? '');
    setDAction(insight?.action ?? '');
    setDNote(insight?.actionNote ?? '');
    setEditing(true);
  };

  const save = () => {
    const trimWhat = dWhat.trim();
    const trimWhy  = dWhy.trim();
    if (trimWhat && trimWhy && dAction) {
      setInsight(sectionKey, { whatHappening: trimWhat, whyMatters: trimWhy, action: dAction, actionNote: dNote.trim() });
    }
    setEditing(false);
  };

  const cancel = () => setEditing(false);

  const canSave = dWhat.trim().length > 0 && dWhy.trim().length > 0 && dAction.length > 0;

  const taStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '8px 10px', borderRadius: 7,
    border: '0.5px solid rgba(0,0,0,0.15)',
    fontSize: 13, color: NAVY, fontFamily: FONT,
    resize: 'none', outline: 'none', lineHeight: 1.5,
    background: '#FAFAFA',
  };

  return (
    <div style={{
      background: '#fff',
      border: `0.5px solid ${insight ? 'rgba(34,197,94,0.2)' : 'rgba(0,0,0,0.08)'}`,
      borderRadius: 12,
      padding: '18px 20px',
      display: 'flex',
      gap: 20,
      fontFamily: FONT,
    }}>
      {/* Left: mini thumbnail */}
      <SlideMini sectionKey={sectionKey} label={label} />

      {/* Right: insight content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF', fontFamily: FONT }}>Slide {slideNum}</span>
              {insight && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 500, color: '#15803D', background: 'rgba(34,197,94,0.08)', border: '0.5px solid rgba(34,197,94,0.2)', borderRadius: 5, padding: '1px 7px' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
                  Story written
                </span>
              )}
              {!insight && !isStructural && (
                <span style={{ fontSize: 10, fontWeight: 500, color: '#92400E', background: 'rgba(234,179,8,0.1)', border: '0.5px solid rgba(234,179,8,0.25)', borderRadius: 5, padding: '1px 7px' }}>
                  ⚠ Missing story
                </span>
              )}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: NAVY }}>{label}</div>
          </div>

          {/* Edit / Save / Cancel buttons */}
          {!isStructural && avail.available && (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              {editing ? (
                <>
                  <button onClick={cancel} style={{ padding: '5px 12px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#6B7280', fontSize: 12, fontWeight: 400, cursor: 'pointer', fontFamily: FONT }}>
                    Cancel
                  </button>
                  <button
                    onClick={save}
                    disabled={!canSave}
                    style={{ padding: '5px 14px', borderRadius: 7, border: 'none', background: canSave ? BLUE : '#E5E7EB', color: canSave ? '#fff' : '#9CA3AF', fontSize: 12, fontWeight: 500, cursor: canSave ? 'pointer' : 'not-allowed', fontFamily: FONT }}
                  >
                    Save
                  </button>
                </>
              ) : (
                <button
                  onClick={startEdit}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.12)', background: '#fff', color: '#374151', fontSize: 12, fontWeight: 400, cursor: 'pointer', fontFamily: FONT }}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8.5 1.5a1.5 1.5 0 0 1 2 2L3.5 10.5l-3 1 1-3z" />
                  </svg>
                  {insight ? 'Edit' : 'Write story'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Unavailable state */}
        {!avail.available && (
          <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>{avail.reason}</p>
        )}

        {/* Structural sections (no insight needed) */}
        {isStructural && (
          <p style={{ margin: 0, fontSize: 12, color: '#9CA3AF' }}>Auto-generated — no story needed for this slide.</p>
        )}

        {/* Edit mode */}
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#374151', marginBottom: 5 }}>
                What's happening? <span style={{ color: ORANGE }}>*</span>
              </label>
              <textarea value={dWhat} onChange={e => setDWhat(e.target.value.slice(0, 150))} rows={2} style={taStyle}
                placeholder="e.g. Orders are down 23% MoM across all child accounts" />
              <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 2 }}>{dWhat.length}/150</div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#374151', marginBottom: 5 }}>
                Why does it matter? <span style={{ color: ORANGE }}>*</span>
              </label>
              <textarea value={dWhy} onChange={e => setDWhy(e.target.value.slice(0, 150))} rows={2} style={taStyle}
                placeholder="e.g. Their highest-volume account has been declining 3 months in a row" />
              <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 2 }}>{dWhy.length}/150</div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#374151', marginBottom: 5 }}>
                  Recommended action <span style={{ color: ORANGE }}>*</span>
                </label>
                <select value={dAction} onChange={e => setDAction(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 7, border: '0.5px solid rgba(0,0,0,0.15)', fontSize: 12, color: dAction ? NAVY : '#9CA3AF', fontFamily: FONT, outline: 'none', background: '#FAFAFA', cursor: 'pointer' }}>
                  {RECOMMENDED_ACTIONS.map(a => (
                    <option key={a.value} value={a.value} disabled={!a.value}>{a.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#374151', marginBottom: 5 }}>
                  Notes <span style={{ fontSize: 10, fontWeight: 400, color: '#9CA3AF' }}>(optional)</span>
                </label>
                <textarea value={dNote} onChange={e => setDNote(e.target.value)} rows={1} style={{ ...taStyle }}
                  placeholder="Additional context for the presenter…" />
              </div>
            </div>
          </div>
        )}

        {/* View mode — has insight */}
        {!editing && insight && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', border: '0.5px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 10, fontWeight: 500, color: '#9CA3AF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>What's happening</div>
                <p style={{ margin: 0, fontSize: 13, color: NAVY, lineHeight: 1.55, fontWeight: 400 }}>{insight.whatHappening}</p>
              </div>
              <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '10px 12px', border: '0.5px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 10, fontWeight: 500, color: '#9CA3AF', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Why it matters</div>
                <p style={{ margin: 0, fontSize: 13, color: NAVY, lineHeight: 1.55, fontWeight: 400 }}>{insight.whyMatters}</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {insight.action && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, color: BLUE, background: 'rgba(68,114,232,0.08)', border: '0.5px solid rgba(68,114,232,0.2)', borderRadius: 6, padding: '3px 10px' }}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="2 6 5 9 10 3" />
                  </svg>
                  {ACTION_LABEL[insight.action] ?? insight.action}
                </span>
              )}
              {insight.actionNote && (
                <span style={{ fontSize: 11, color: '#6B7280', fontStyle: 'italic' }}>{insight.actionNote}</span>
              )}
            </div>
          </div>
        )}

        {/* View mode — no insight, not structural */}
        {!editing && !insight && !isStructural && avail.available && (
          <div style={{ padding: '14px 16px', borderRadius: 8, background: 'rgba(234,179,8,0.05)', border: '0.5px dashed rgba(234,179,8,0.3)' }}>
            <p style={{ margin: 0, fontSize: 12, color: '#78350F', lineHeight: 1.55 }}>
              No story written for this slide yet. Click <strong>Write story</strong> to add the narrative before this slide goes into the deck.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────
export default function RecommendationsTab() {
  const { sections, availability } = useDeck();

  const enabledSections = SECTION_ORDER.filter(key => {
    const s = sections.find(s => s.key === key);
    return s?.enabled && availability[key].available;
  });

  const readyCount   = enabledSections.filter(key => {
    const s = sections.find(s => s.key === key);
    const isStructural = ['agenda', 'introductions', 'recommendedActions'].includes(key);
    return isStructural || !!s?.insight;
  }).length;

  const pendingCount = enabledSections.length - readyCount;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px', fontFamily: FONT }}>

      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, color: NAVY, margin: '0 0 6px' }}>Recommendations</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
          Review and edit the story behind each slide before generating the deck. Every data slide needs a narrative that explains what it means for this client.
        </p>
      </div>

      {/* Summary chips */}
      {enabledSections.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7, background: 'rgba(34,197,94,0.08)', border: '0.5px solid rgba(34,197,94,0.2)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: '#15803D' }}>{readyCount} ready</span>
          </div>
          {pendingCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 7, background: 'rgba(234,179,8,0.08)', border: '0.5px solid rgba(234,179,8,0.2)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: '#92400E' }}>{pendingCount} need a story</span>
            </div>
          )}
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>{enabledSections.length} slide{enabledSections.length !== 1 ? 's' : ''} in deck</span>
        </div>
      )}

      {/* Section cards */}
      {enabledSections.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {enabledSections.map((key, i) => (
            <RecommendationCard key={key} sectionKey={key} slideNum={i + 2} />
          ))}
        </div>
      ) : (
        /* Empty state */
        <div style={{ padding: '56px 24px', textAlign: 'center', background: '#fff', borderRadius: 12, border: '0.5px solid rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#374151', marginBottom: 8 }}>No slides in your deck yet</div>
          <p style={{ fontSize: 13, color: '#9CA3AF', maxWidth: 380, margin: '0 auto', lineHeight: 1.6 }}>
            Go to the <strong style={{ color: NAVY }}>Data</strong> step and use <strong style={{ color: NAVY }}>Add to deck</strong> on any chart to start building your story.
          </p>
        </div>
      )}
    </div>
  );
}
