import { memo } from 'react';
import { useDeck } from '../context/DeckContext';
import type { DeckSectionKey } from './pdf/QBRDeckDocument';

/**
 * Simple green checkbox that toggles a QBR deck section.
 * Greyed-out + tooltip when the section's data isn't available yet.
 */
const DeckToggle = memo(({ sectionKey }: { sectionKey: DeckSectionKey }) => {
  const { sections, toggleSection, availability } = useDeck();
  const section = sections.find(s => s.key === sectionKey);
  const avail   = availability[sectionKey];
  const checked = section?.enabled ?? false;

  return (
    <button
      onClick={() => avail.available && toggleSection(sectionKey)}
      title={avail.available ? (checked ? 'Remove from QBR Deck' : 'Include in QBR Deck') : avail.reason}
      aria-label={checked ? 'Remove from QBR Deck' : 'Include in QBR Deck'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        borderRadius: 5,
        border: checked ? '1.5px solid #16A34A' : '1.5px solid #D1D5DB',
        background: checked ? '#22C55E' : '#fff',
        opacity: avail.available ? 1 : 0.35,
        cursor: avail.available ? 'pointer' : 'not-allowed',
        flexShrink: 0,
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <polyline
            points="2 6 5 9.5 10 2.5"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
});

export default DeckToggle;
