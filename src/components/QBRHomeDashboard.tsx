import { useState, useRef } from 'react';
import { QBRSessionMeta } from '../context/DataContext';

interface Props {
  sessions: QBRSessionMeta[];
  onNewQBR: () => void;
  onDeleteSession: (id: string) => void;
  onOpenSession: (id: string) => void;
  onImportFile?: (file: File) => Promise<void>;
}

function ClientInitials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : name.slice(0, 2);
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 10,
      background: 'linear-gradient(135deg, #EF5252 0%, #252F3E 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: 18, flexShrink: 0,
      fontFamily: "'Metropolis', sans-serif",
    }}>
      {initials.toUpperCase()}
    </div>
  );
}

function FileBadge({ label, done }: { label: string; done: boolean }) {
  if (!done) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
      background: 'rgba(34,197,94,0.12)', color: '#16A34A',
      border: '1px solid rgba(34,197,94,0.25)',
    }}>{label}</span>
  );
}

function SessionCard({ session, onDelete, onOpen }: { session: QBRSessionMeta; onDelete: () => void; onOpen: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const date = new Date(session.lastModified);
  const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div
      onClick={e => {
        // Don't open if clicking the delete/cancel/confirm buttons
        if ((e.target as HTMLElement).closest('button')) return;
        onOpen();
      }}
      style={{
        background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB',
        padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; (e.currentTarget as HTMLDivElement).style.borderColor = '#D1D5DB'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; (e.currentTarget as HTMLDivElement).style.borderColor = '#E5E7EB'; }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {session.clientLogo ? (
          <img src={session.clientLogo} alt="" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 10, background: '#F9FAFB', border: '1px solid #E5E7EB', padding: 4, flexShrink: 0 }} />
        ) : (
          <ClientInitials name={session.clientName} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111827', fontFamily: "'Metropolis', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.clientName}
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, marginTop: 1 }}>
            CASH ID: <span style={{ color: '#374151', fontWeight: 700 }}>{session.cashId}</span>
            {session.period && <span style={{ marginLeft: 10, color: '#374151' }}>{session.period}</span>}
          </div>
        </div>
      </div>

      {/* File badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <FileBadge label="Shipments" done={session.filesLoaded.shipments} />
        <FileBadge label="Prior Quarter" done={session.filesLoaded.priorPeriod} />
        <FileBadge label="Stats" done={session.filesLoaded.stats} />
        {!session.filesLoaded.shipments && !session.filesLoaded.priorPeriod && !session.filesLoaded.stats && (
          <span style={{ fontSize: 11, color: '#6B7280', fontStyle: 'italic' }}>No data files loaded</span>
        )}
      </div>

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid #F3F4F6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 600 }}>{dateLabel}</span>
          {(session.deckOutputs?.length ?? 0) > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
              background: 'rgba(68,114,232,0.1)', color: '#4472E8',
              border: '1px solid rgba(68,114,232,0.2)',
            }} title={`Last generated: ${new Date(session.deckOutputs![session.deckOutputs!.length - 1].generatedAt).toLocaleDateString()}`}>
              {session.deckOutputs!.length} deck{session.deckOutputs!.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {confirmDelete ? (
            <>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
              >Cancel</button>
              <button
                onClick={onDelete}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#EF4444', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
              >Delete</button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmDelete(true)}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid #F3F4F6', background: 'transparent', color: '#6B7280', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
              >Remove</button>
              <button
                onClick={onOpen}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(37,47,62,0.2)', background: '#252F3E', color: '#fff', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
              >Open →</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function QBRHomeDashboard({ sessions, onNewQBR, onDeleteSession, onOpenSession, onImportFile }: Props) {
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleImportChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onImportFile) return;
    setImporting(true);
    try {
      await onImportFile(file);
    } catch {
      alert('Failed to import — make sure the file is a valid .qbr.json bundle.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={{ minHeight: 'calc(100vh - 80px)', background: '#F3F4F6', padding: '48px 40px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>

        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 40 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: '#111827', margin: 0, fontFamily: "'Metropolis', sans-serif" }}>
              QBR Studio
            </h1>
            <p style={{ fontSize: 14, color: '#6B7280', margin: '6px 0 0', fontFamily: "'Metropolis', sans-serif" }}>
              Create and manage quarterly business reviews for your clients.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            {onImportFile && (
              <>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json,.qbr.json"
                  style={{ display: 'none' }}
                  onChange={handleImportChange}
                />
                <button
                  onClick={() => importRef.current?.click()}
                  disabled={importing}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '10px 18px', borderRadius: 10,
                    background: '#fff', color: '#374151',
                    fontWeight: 600, fontSize: 13, border: '1.5px solid #E5E7EB', cursor: importing ? 'wait' : 'pointer',
                    fontFamily: "'Metropolis', sans-serif",
                    opacity: importing ? 0.6 : 1,
                  }}
                  title="Import a .qbr.json session bundle"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  {importing ? 'Importing…' : 'Import'}
                </button>
              </>
            )}
            <button
              onClick={onNewQBR}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '11px 22px', borderRadius: 10,
                background: '#252F3E', color: '#fff',
                fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
                fontFamily: "'Metropolis', sans-serif",
                boxShadow: '0 2px 8px rgba(37,47,62,0.25)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New QBR
            </button>
          </div>
        </div>

        {/* Content */}
        {sessions.length === 0 ? (
          /* Empty state */
          <div style={{
            background: '#fff', borderRadius: 16, border: '2px dashed #E5E7EB',
            padding: '72px 40px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 8px', fontFamily: "'Metropolis', sans-serif" }}>
              No QBRs yet
            </h2>
            <p style={{ fontSize: 14, color: '#6B7280', margin: '0 0 28px', fontFamily: "'Metropolis', sans-serif" }}>
              Start your first quarterly business review by setting up a client profile<br />and loading your data.
            </p>
            <button
              onClick={onNewQBR}
              style={{
                padding: '12px 28px', borderRadius: 10,
                background: '#252F3E', color: '#fff',
                fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
                fontFamily: "'Metropolis', sans-serif",
                boxShadow: '0 2px 8px rgba(37,47,62,0.25)',
              }}
            >
              Create your first QBR
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14, fontFamily: "'Metropolis', sans-serif" }}>
              Recent QBRs — {sessions.length} total
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 16,
            }}>
              {sessions.map(s => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onDelete={() => onDeleteSession(s.id)}
                  onOpen={() => onOpenSession(s.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
