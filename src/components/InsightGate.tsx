import { useState, memo } from 'react';
import { useDeck, SECTION_LABELS } from '../context/DeckContext';
import type { DeckSectionKey, SectionInsight } from './pdf/QBRDeckDocument';
import { useData } from '../context/DataContext';
import { KPI_SLIDE_STATS } from '../utils/kpiSlideStats';

// ─── Constants ────────────────────────────────────────────────────────────────
const RECOMMENDED_ACTIONS = [
  { value: '',                      label: 'Select an action…' },
  { value: 'rate-optimization',     label: 'Rate optimization' },
  { value: 'volume-incentive',      label: 'Volume incentive' },
  { value: 'carrier-diversification', label: 'Carrier diversification' },
  { value: 'operational-review',    label: 'Operational review' },
  { value: 'onboarding-review',     label: 'Onboarding review' },
  { value: 'no-action',             label: 'No action needed' },
  { value: 'custom',                label: 'Custom action' },
];

const FONT = "'Metropolis', sans-serif";

// ─── Story card panel ─────────────────────────────────────────────────────────
function InsightPanel({
  sectionKey,
  initialInsight,
  clientName,
  onSave,
  onClose,
}: {
  sectionKey: DeckSectionKey;
  initialInsight?: SectionInsight;
  clientName: string;
  onSave: (insight: SectionInsight) => void;
  onClose: () => void;
}) {
  const label = SECTION_LABELS[sectionKey];
  const [what, setWhat]     = useState(initialInsight?.whatHappening ?? '');
  const [why, setWhy]       = useState(initialInsight?.whyMatters ?? '');
  const [action, setAction] = useState(initialInsight?.action ?? '');
  const [note, setNote]     = useState(initialInsight?.actionNote ?? '');

  const canSave = what.trim().length > 0 && why.trim().length > 0 && action.length > 0;

  const textareaStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box',
    padding: '10px 12px', borderRadius: 8,
    border: '0.5px solid rgba(0,0,0,0.15)',
    fontSize: 13, color: '#252F3E', fontFamily: FONT,
    resize: 'none', outline: 'none', lineHeight: 1.5,
    background: '#FAFAFA',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(28,28,46,0.35)', zIndex: 999 }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
        background: '#fff',
        borderLeft: '0.5px solid rgba(0,0,0,0.1)',
        zIndex: 1000,
        display: 'flex', flexDirection: 'column',
        fontFamily: FONT,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '0.5px solid rgba(0,0,0,0.08)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Tell the story</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#252F3E' }}>{label}</div>
            </div>
            <button
              onClick={onClose}
              style={{ width: 28, height: 28, borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.1)', background: '#F9FAFB', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#6B7280" strokeWidth="1.8" strokeLinecap="round">
                <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
              </svg>
            </button>
          </div>
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FFFBEB', border: '0.5px solid rgba(234,179,8,0.3)' }}>
            <p style={{ fontSize: 11, color: '#78350F', margin: 0, lineHeight: 1.55, fontWeight: 400 }}>
              Every slide needs a story. Explain what the data means for this client — not just what it shows. These notes become the presenter's talking points.
            </p>
          </div>
        </div>

        {/* Scrollable fields */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {/* What's happening */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
              What's happening?{' '}
              <span style={{ color: '#EF5252' }}>*</span>
            </label>
            <textarea
              value={what}
              onChange={e => setWhat(e.target.value.slice(0, 150))}
              placeholder="e.g. Orders are down 23% MoM across all child accounts"
              rows={3}
              style={textareaStyle}
            />
            <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 3 }}>{what.length}/150</div>
          </div>

          {/* Why it matters */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
              Why does it matter{clientName ? ` for ${clientName}` : ''}?{' '}
              <span style={{ color: '#EF5252' }}>*</span>
            </label>
            <textarea
              value={why}
              onChange={e => setWhy(e.target.value.slice(0, 150))}
              placeholder="e.g. Their highest-volume account has been declining 3 months in a row"
              rows={3}
              style={textareaStyle}
            />
            <div style={{ fontSize: 10, color: '#9CA3AF', textAlign: 'right', marginTop: 3 }}>{why.length}/150</div>
          </div>

          {/* Recommended action */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
              Recommended action{' '}
              <span style={{ color: '#EF5252' }}>*</span>
            </label>
            <select
              value={action}
              onChange={e => setAction(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                border: '0.5px solid rgba(0,0,0,0.15)',
                fontSize: 13, color: action ? '#252F3E' : '#9CA3AF',
                fontFamily: FONT, outline: 'none', background: '#FAFAFA',
                cursor: 'pointer',
              }}
            >
              {RECOMMENDED_ACTIONS.map(a => (
                <option key={a.value} value={a.value} disabled={!a.value}>{a.label}</option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
              Notes{' '}
              <span style={{ fontSize: 11, fontWeight: 400, color: '#9CA3AF' }}>(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Any additional context for the presenter…"
              rows={2}
              style={textareaStyle}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 24px', borderTop: '0.5px solid rgba(0,0,0,0.08)', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: 8,
              border: '0.5px solid rgba(0,0,0,0.12)',
              background: '#fff', color: '#6B7280',
              fontSize: 13, fontWeight: 400, cursor: 'pointer',
              fontFamily: FONT,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => canSave && onSave({ whatHappening: what.trim(), whyMatters: why.trim(), action, actionNote: note.trim() })}
            disabled={!canSave}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: canSave ? '#4472E8' : '#E5E7EB',
              color: canSave ? '#fff' : '#9CA3AF',
              fontSize: 13, fontWeight: 500,
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'background 0.15s',
            }}
          >
            Add to deck
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}

// ─── InsightGate button ───────────────────────────────────────────────────────
const InsightGate = memo(({ sectionKey }: { sectionKey: DeckSectionKey }) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const { sections, toggleSection, setInsight, availability } = useDeck();
  const { clientName } = useData();

  const section  = sections.find(s => s.key === sectionKey);
  const avail    = availability[sectionKey];
  const isEnabled = section?.enabled ?? false;
  const hasInsight = !!section?.insight;

  const handleSave = (insight: SectionInsight) => {
    setInsight(sectionKey, insight);
    if (!isEnabled) toggleSection(sectionKey);
    setPanelOpen(false);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInsight(sectionKey, undefined);
    if (isEnabled) toggleSection(sectionKey);
  };

  // ── Unavailable ─────────────────────────────────────────────────────────────
  if (!avail.available) {
    return (
      <div
        title={avail.reason}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '5px 6px', borderRadius: 6,
          border: '0.5px solid #E5E7EB',
          background: '#F9FAFB', opacity: 0.45, cursor: 'not-allowed',
          fontFamily: FONT,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="11" /><line x1="1" y1="6" x2="11" y2="6" />
        </svg>
      </div>
    );
  }

  // ── In deck (with insight) ───────────────────────────────────────────────────
  if (isEnabled && hasInsight) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          <button
            onClick={() => setPanelOpen(true)}
            title="Edit story"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 8px', borderRadius: '6px 0 0 6px',
              border: '0.5px solid rgba(34,197,94,0.4)',
              background: 'rgba(34,197,94,0.1)',
              cursor: 'pointer', fontFamily: FONT,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <polyline points="2 6 5 9 10 3" stroke="#15803D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 500, color: '#15803D' }}>In deck</span>
          </button>
          <button
            onClick={handleRemove}
            title="Remove from deck"
            style={{
              padding: '3px 6px', borderRadius: '0 6px 6px 0',
              border: '0.5px solid rgba(34,197,94,0.4)', borderLeft: 'none',
              background: 'rgba(34,197,94,0.06)',
              cursor: 'pointer', color: '#15803D',
              display: 'flex', alignItems: 'center',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
            </svg>
          </button>
        </div>

        {panelOpen && (
          <InsightPanel
            sectionKey={sectionKey}
            initialInsight={section?.insight}
            clientName={clientName ?? ''}
            onSave={handleSave}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </>
    );
  }

  // ── Default: Add to deck ─────────────────────────────────────────────────────
  return (
    <>
      <button
        onClick={() => setPanelOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '5px 6px', borderRadius: 6,
          border: '0.5px solid rgba(68,114,232,0.3)',
          background: 'rgba(68,114,232,0.05)',
          cursor: 'pointer', fontFamily: FONT,
          transition: 'background 0.15s',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#4472E8" strokeWidth="1.5" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="11" /><line x1="1" y1="6" x2="11" y2="6" />
        </svg>
      </button>

      {panelOpen && (
        <InsightPanel
          sectionKey={sectionKey}
          clientName={clientName ?? ''}
          onSave={handleSave}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  );
});

export default InsightGate;

// ─── Per-stat tile add-to-deck button ─────────────────────────────────────────
/**
 * Small + / ✓ button that lives in the top-right corner of a KPI stat tile.
 * - "+" → enables the section and adds only this stat to the kpiFilter (additive).
 * - "✓" (hover → ×) → removes this stat from the kpiFilter.
 * Parent card must have `position: relative`.
 */
export const StatDeckButton = memo(function StatDeckButton({
  sectionKey,
  statId,
}: {
  sectionKey: DeckSectionKey;
  statId: string;
}) {
  const { sections, toggleSection, setKpiFilter, availability } = useDeck();
  const [hovered, setHovered] = useState(false);

  const section   = sections.find(s => s.key === sectionKey);
  const avail     = availability[sectionKey];
  const isEnabled = section?.enabled ?? false;
  const filter    = section?.kpiFilter ?? [];
  // Stat is "in deck" when the section is on AND either all stats are shown (empty filter) or this id is explicitly included
  const isInDeck  = isEnabled && (!filter.length || filter.includes(statId));

  if (!avail?.available) return null;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInDeck) {
      // Remove this stat from the filter
      if (!filter.length) {
        // Currently "show all" — expand to all-minus-this-one
        const allIds = (KPI_SLIDE_STATS[sectionKey] ?? []).map(s => s.id);
        const next   = allIds.filter(id => id !== statId);
        setKpiFilter(sectionKey, next.length ? next : undefined);
      } else {
        const next = filter.filter(id => id !== statId);
        setKpiFilter(sectionKey, next.length ? next : undefined);
      }
    } else {
      // Add this stat — enable section if needed, then push id into filter
      if (!isEnabled) toggleSection(sectionKey);
      const next = [...new Set([...filter, statId])];
      setKpiFilter(sectionKey, next);
    }
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={isInDeck ? 'Remove from deck' : 'Add to deck'}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 22,
        height: 22,
        borderRadius: 6,
        border: isInDeck
          ? `0.5px solid ${hovered ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'}`
          : '0.5px solid rgba(68,114,232,0.3)',
        background: isInDeck
          ? hovered ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)'
          : hovered ? 'rgba(68,114,232,0.12)' : 'rgba(68,114,232,0.05)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s',
        fontFamily: FONT,
        flexShrink: 0,
      }}
    >
      {isInDeck ? (
        hovered ? (
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="#EF4444" strokeWidth="1.6" strokeLinecap="round">
            <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <polyline points="2 6 5 9 10 3" stroke="#22C55E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )
      ) : (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#4472E8" strokeWidth="1.5" strokeLinecap="round">
          <line x1="6" y1="1" x2="6" y2="11" /><line x1="1" y1="6" x2="11" y2="6" />
        </svg>
      )}
    </button>
  );
});
