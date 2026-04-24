import { useDeck, SECTION_LABELS } from '../context/DeckContext';
import type { DeckSectionKey } from './pdf/QBRDeckDocument';

const NAVY = '#252F3E';
const BLUE = '#4472E8';
const RED  = '#EF5252';

interface QBRIncludeBarProps {
  sectionKeys: DeckSectionKey[];
}

export default function QBRIncludeBar({ sectionKeys }: QBRIncludeBarProps) {
  const { sections, toggleSection, availability } = useDeck();

  const enabledCount = sectionKeys.filter(k => {
    const sec = sections.find(s => s.key === k);
    return sec?.enabled && availability[k].available;
  }).length;

  return (
    <div
      style={{
        background: '#fff',
        borderBottom: '1px solid #E5E7EB',
        padding: '9px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        minHeight: 42,
      }}
    >
      {/* Label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={RED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'Metropolis', sans-serif" }}>
          Include in QBR Deck
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 18, background: '#E5E7EB', flexShrink: 0 }} />

      {/* Section toggles */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {sectionKeys.map(key => {
          const sec = sections.find(s => s.key === key);
          const avail = availability[key].available;
          const reason = availability[key].reason;
          const checked = !!(sec?.enabled && avail);

          return (
            <label
              key={key}
              title={avail ? undefined : `⚠ ${reason}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 20,
                border: `1.5px solid ${checked ? 'rgba(68,114,232,0.35)' : '#E5E7EB'}`,
                background: checked ? 'rgba(68,114,232,0.06)' : '#FAFAFA',
                cursor: avail ? 'pointer' : 'default',
                opacity: avail ? 1 : 0.5,
                transition: 'all 0.15s',
                fontFamily: "'Metropolis', sans-serif",
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!avail}
                onChange={() => avail && toggleSection(key)}
                style={{ accentColor: BLUE, width: 13, height: 13, flexShrink: 0, cursor: avail ? 'pointer' : 'default' }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: checked ? NAVY : '#9CA3AF', whiteSpace: 'nowrap' }}>
                {SECTION_LABELS[key]}
              </span>
            </label>
          );
        })}
      </div>

      {/* Count badge */}
      <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: enabledCount > 0 ? NAVY : '#6B7280',
          fontFamily: "'Metropolis', sans-serif",
        }}>
          {enabledCount > 0
            ? `${enabledCount} slide${enabledCount !== 1 ? 's' : ''} selected`
            : 'None selected'}
        </span>
      </div>
    </div>
  );
}
