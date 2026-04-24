import { useState, useRef, useCallback } from 'react';
import { useData } from '../context/DataContext';
import { detectReportType, readCSVHeaders, TYPE_META } from '../utils/reportDetection';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 8,
  border: '1.5px solid #E5E7EB', fontSize: 14, fontWeight: 600,
  fontFamily: "'Metropolis', sans-serif", color: '#111827', background: '#fff',
  outline: 'none', boxSizing: 'border-box',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: '0.07em',
  textTransform: 'uppercase', color: '#6B7280', marginBottom: 6, display: 'block',
  fontFamily: "'Metropolis', sans-serif",
};

// ── Step indicator ────────────────────────────────────────────────────────────
function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? '#22C55E' : active ? '#4472E8' : '#E5E7EB',
        color: done || active ? '#fff' : '#9CA3AF',
        fontWeight: 800, fontSize: 13, fontFamily: "'Metropolis', sans-serif",
        transition: 'background 0.2s',
      }}>
        {done ? '✓' : n}
      </div>
    </div>
  );
}

function StepBar({ step }: { step: 1 | 2 }) {
  const labels = ['Client Setup', 'Data Sources'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, marginBottom: 32 }}>
      {labels.map((label, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <StepDot n={i + 1} active={step === i + 1} done={step > i + 1} />
            <span style={{
              fontSize: 11, fontWeight: 700, fontFamily: "'Metropolis', sans-serif",
              color: step === i + 1 ? '#111827' : step > i + 1 ? '#22C55E' : '#9CA3AF',
            }}>{label}</span>
          </div>
          {i < labels.length - 1 && (
            <div style={{ width: 80, height: 2, background: step > 1 ? '#22C55E' : '#E5E7EB', margin: '0 12px 20px', transition: 'background 0.2s' }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Checklist row ─────────────────────────────────────────────────────────────
function CheckRow({ label, path, done, required, doneLabel }: { label: string; path: string; done: boolean; required?: boolean; doneLabel?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: done ? 'rgba(34,197,94,0.05)' : 'rgba(0,0,0,0.02)', border: `1px solid ${done ? 'rgba(34,197,94,0.2)' : 'rgba(0,0,0,0.06)'}` }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: done ? '#22C55E' : '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.2s' }}>
        {done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: done ? '#15803D' : '#374151', fontFamily: "'Metropolis', sans-serif" }}>{label}</span>
          {required && !done && <span style={{ fontSize: 9, fontWeight: 800, color: '#EF4444', background: 'rgba(239,68,68,0.1)', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Required</span>}
        </div>
        <div style={{ fontSize: 10, color: done ? '#16A34A' : '#9CA3AF', fontFamily: "'Metropolis', sans-serif", marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {done && doneLabel ? doneLabel : path}
        </div>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function NewQBRModal({ onComplete, onCancel }: Props) {
  const { uploadCSV, uploadPriorCSV, mergeShipmentsCSV, startSession, isLoading, setPendingStatsFile, setPendingLocFile, setPendingChangeFiles, warehouses, setWarehouseZip } = useData();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [name, setName] = useState('');
  const [cash, setCash] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Step 2 — checklist state
  const [shipmentsLoaded, setShipmentsLoaded] = useState(false);
  const [shipmentsName, setShipmentsName] = useState('');
  const [priorLoaded, setPriorLoaded] = useState(false);
  const [priorName, setPriorName] = useState('');
  const [statsLoaded, setStatsLoadedLocal] = useState(false);
  const [statsName, setStatsName] = useState('');
  const [locLoaded, setLocLoaded] = useState(false);
  const [locName, setLocName] = useState('');
  const [changeFiles, setChangeFilesLocal] = useState<File[]>([]);
  const [warehouseZips, setWarehouseZips] = useState<Record<string, string>>({});

  // Step 2 — smart upload box state
  type FileEntry = { id: string; name: string; detectedType: string; status: 'processing' | 'ok' | 'error' | 'ambiguous'; detail?: string; file: File };
  const [droppedFiles, setDroppedFiles] = useState<FileEntry[]>([]);
  const [dropDragging, setDropDragging] = useState(false);
  const dropInputRef = useRef<HTMLInputElement>(null);

  const adminUrl = `https://app.shiphero.com/admin/${cash}`;
  const cashUrl = `https://cash.shiphero.com/client/${cash}`;

  // ── Logo upload ─────────────────────────────────────────────────────────────
  const handleLogoFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => setLogo(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  // ── Smart file router ────────────────────────────────────────────────────────
  const routeFile = useCallback(async (file: File, forceType?: 'current' | 'prior' | 'merge') => {
    const id = `${file.name}-${Date.now()}`;
    setDroppedFiles(prev => [...prev, { id, name: file.name, detectedType: 'unknown', status: 'processing', file }]);

    const headers = await readCSVHeaders(file);
    const type = detectReportType(headers);
    const meta = TYPE_META[type];

    const update = (patch: Partial<FileEntry>) =>
      setDroppedFiles(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

    if (type === 'unknown') {
      update({ detectedType: 'unknown', status: 'error', detail: 'Could not identify report type from column headers.' });
      return;
    }

    if (type === 'shipments' && forceType === undefined && shipmentsLoaded) {
      update({ detectedType: type, status: 'ambiguous' });
      return;
    }

    try {
      if (type === 'shipments') {
        if (forceType === 'prior') {
          const { errors } = await uploadPriorCSV(file);
          if (errors.length) { update({ status: 'error', detail: errors[0] }); return; }
          setPriorLoaded(true); setPriorName(file.name);
        } else if (forceType === 'merge') {
          const { errors } = await mergeShipmentsCSV(file);
          if (errors.length) { update({ status: 'error', detail: errors[0] }); return; }
          setShipmentsName(prev => prev); // keep first name displayed in checklist
        } else {
          const { errors } = await uploadCSV(file);
          if (errors.length) { update({ status: 'error', detail: errors[0] }); return; }
          setShipmentsLoaded(true); setShipmentsName(file.name);
        }
      } else if (type === 'stats') {
        setPendingStatsFile(file); setStatsLoadedLocal(true); setStatsName(file.name);
      } else if (type === 'locations') {
        setPendingLocFile(file); setLocLoaded(true); setLocName(file.name);
      } else if (type === 'inventory-changes') {
        setChangeFilesLocal(prev => {
          if (prev.some(f => f.name === file.name)) return prev;
          const next = [...prev, file];
          setPendingChangeFiles(next);
          return next;
        });
      }
      update({ detectedType: type, status: 'ok', detail: meta.label });
    } catch (e) {
      update({ detectedType: type, status: 'error', detail: e instanceof Error ? e.message : 'Upload failed' });
    }
  }, [shipmentsLoaded, uploadCSV, uploadPriorCSV, mergeShipmentsCSV, setPendingStatsFile, setPendingLocFile, setPendingChangeFiles]);

  const handleDropFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(f => routeFile(f));
  }, [routeFile]);

  const resolveAmbiguous = useCallback((entry: FileEntry, choice: 'current' | 'prior' | 'merge') => {
    setDroppedFiles(prev => prev.filter(r => r.id !== entry.id));
    routeFile(entry.file, choice);
  }, [routeFile]);

  // ── Start QBR ───────────────────────────────────────────────────────────────
  const handleStart = () => {
    // Apply warehouse ZIPs before starting session
    warehouses.forEach(w => {
      const zip = warehouseZips[w.name]?.trim();
      if (zip) setWarehouseZip(w.name, zip);
    });
    startSession(name.trim(), cash.trim(), logo);
    onComplete();
  };

  const allZipsFilled = warehouses.length === 0 || warehouses.every(w => (warehouseZips[w.name] ?? '').trim().length >= 5);
  const canProceedStep1 = name.trim().length > 0 && cash.trim().length > 0;
  const canStart = shipmentsLoaded && allZipsFilled;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
    >
      <div style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        maxHeight: '90vh', overflowY: 'auto',
        fontFamily: "'Metropolis', sans-serif",
      }}>
        {/* Header */}
        <div style={{ background: '#252F3E', borderRadius: '16px 16px 0 0', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#fff', fontWeight: 900, fontSize: 16 }}>New QBR</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, marginTop: 1 }}>
              Step {step} of 2 · {step === 1 ? 'Client Setup' : 'Data Sources'}
            </div>
          </div>
          <button
            onClick={() => {
              const hasProgress = name.trim() || cash.trim() || logo || shipmentsLoaded || droppedFiles.length > 0;
              if (!hasProgress || window.confirm('Cancel this QBR? Your progress will be lost.')) onCancel();
            }}
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 16 }}
            title="Cancel"
          >×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '28px 24px 24px' }}>
          <StepBar step={step} />

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Logo upload */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div
                  onClick={() => logoInputRef.current?.click()}
                  style={{
                    width: 80, height: 80, borderRadius: 14,
                    border: `2px dashed ${logo ? 'transparent' : '#D1D5DB'}`,
                    background: logo ? 'transparent' : '#F9FAFB',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', overflow: 'hidden',
                    transition: 'border-color 0.15s',
                  }}
                >
                  {logo ? (
                    <img src={logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6 }} />
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                  )}
                </div>
                <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoFile(f); e.target.value = ''; }} />
                <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>
                  {logo ? (
                    <button onClick={() => setLogo(null)} style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: "'Metropolis', sans-serif", padding: 0 }}>Remove logo</button>
                  ) : 'Upload client logo (optional)'}
                </span>
              </div>

              {/* Name + CASH ID */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={LABEL_STYLE}>Client / 3PL Name <span style={{ color: '#EF4444' }}>*</span></label>
                  <input
                    style={{ ...INPUT_STYLE, borderColor: name.trim() ? '#D1D5DB' : '#E5E7EB' }}
                    placeholder="e.g. Acme Corp"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>CASH ID <span style={{ color: '#EF4444' }}>*</span></label>
                  <input
                    style={{ ...INPUT_STYLE, borderColor: cash.trim() ? '#D1D5DB' : '#E5E7EB' }}
                    placeholder="e.g. 12345"
                    value={cash}
                    onChange={e => setCash(e.target.value)}
                  />
                </div>
              </div>

              {cash.trim() && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(68,114,232,0.06)', border: '1px solid rgba(68,114,232,0.2)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                  <span style={{ fontSize: 12, color: '#4472E8', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    app.shiphero.com/admin/{cash}
                  </span>
                  <a href={adminUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, fontWeight: 700, color: '#4472E8', textDecoration: 'none', flexShrink: 0 }}>Preview →</a>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <button
                  disabled={!canProceedStep1}
                  onClick={() => setStep(2)}
                  style={{
                    padding: '11px 24px', borderRadius: 9, border: 'none',
                    background: canProceedStep1 ? '#4472E8' : '#E5E7EB',
                    color: canProceedStep1 ? '#fff' : '#9CA3AF',
                    fontWeight: 800, fontSize: 14, cursor: canProceedStep1 ? 'pointer' : 'not-allowed',
                    fontFamily: "'Metropolis', sans-serif",
                    transition: 'background 0.15s',
                  }}
                >
                  Next: Data Sources →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* ShipHero admin link card */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 10, background: '#252F3E', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: '#4472E8', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontFamily: "'Metropolis', sans-serif" }}>ShipHero Account · {name}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#EF5252', fontFamily: "'Metropolis', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>app.shiphero.com/admin/{cash}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                  <a href={adminUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 12px', borderRadius: 7, background: '#EF5252', color: '#252F3E', fontWeight: 800, fontSize: 11, textDecoration: 'none', textAlign: 'center', fontFamily: "'Metropolis', sans-serif", whiteSpace: 'nowrap' }}>Open Appdot →</a>
                  <a href={cashUrl} target="_blank" rel="noopener noreferrer" style={{ padding: '6px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.1)', color: '#fff', fontWeight: 800, fontSize: 11, textDecoration: 'none', textAlign: 'center', border: '1px solid rgba(255,255,255,0.2)', fontFamily: "'Metropolis', sans-serif", whiteSpace: 'nowrap' }}>Open CASH →</a>
                </div>
              </div>

              {/* Reports checklist */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}>Reports Checklist</span>
                  <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', fontFamily: "'Metropolis', sans-serif" }}>
                    {[shipmentsLoaded, priorLoaded, statsLoaded, locLoaded, changeFiles.length > 0].filter(Boolean).length} / 5 loaded
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <CheckRow label="Shipments Report" path="ShipHero → Reports → Shipments" done={shipmentsLoaded} required doneLabel={shipmentsName} />
                  <CheckRow label="Prior Quarter's Shipments" path="Same as Shipments Report — prior period" done={priorLoaded} doneLabel={priorName} />
                  <CheckRow label="QuickSight CSS_5_Insights" path="ShipHero → Reports → Monthly Statistics Export" done={statsLoaded} doneLabel={statsName} />
                  <CheckRow label="Product Locations CSV" path="ShipHero → Reports → Product Locations (Active, Stocked)" done={locLoaded} doneLabel={locName} />
                  <CheckRow label="Inventory Changes CSV" path="ShipHero → Reports → Inventory Change Report" done={changeFiles.length > 0} doneLabel={changeFiles.length > 1 ? `${changeFiles.length} warehouses` : changeFiles[0]?.name} />
                </div>
              </div>

              {/* Warehouse ZIP Codes */}
              <div style={{ padding: '14px 16px', borderRadius: 8, background: '#FAFAFA', border: '1.5px solid #E5E7EB' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: warehouses.length > 0 ? 12 : 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4472E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#4472E8', fontFamily: "'Metropolis', sans-serif" }}>Warehouse ZIP Codes</span>
                  <span style={{ fontSize: 10, color: '#9CA3AF', fontWeight: 600, fontFamily: "'Metropolis', sans-serif" }}>for network optimization</span>
                </div>
                {warehouses.length === 0 ? (
                  <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, fontFamily: "'Metropolis', sans-serif" }}>
                    Auto-filled once you upload a Shipments Report below.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {warehouses.map(w => (
                      <div key={w.name} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', fontFamily: "'Metropolis', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
                        <input
                          type="text" inputMode="numeric" maxLength={10} placeholder="e.g. 10001"
                          value={warehouseZips[w.name] ?? ''}
                          onChange={e => setWarehouseZips(prev => ({ ...prev, [w.name]: e.target.value }))}
                          style={{ ...INPUT_STYLE, padding: '8px 10px', fontSize: 13, borderColor: (warehouseZips[w.name] ?? '').trim().length >= 5 ? 'rgba(34,197,94,0.4)' : '#E5E7EB', background: (warehouseZips[w.name] ?? '').trim().length >= 5 ? 'rgba(34,197,94,0.04)' : '#fff' }}
                        />
                      </div>
                    ))}
                    {!allZipsFilled && (
                      <div style={{ fontSize: 11, color: '#F97316', fontWeight: 600, fontFamily: "'Metropolis', sans-serif" }}>Enter a ZIP code for each warehouse to continue.</div>
                    )}
                  </div>
                )}
              </div>

              {/* Single smart upload zone */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#6B7280', fontFamily: "'Metropolis', sans-serif" }}>Upload Reports</span>
                  <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
                </div>

                {/* Drop zone */}
                <label
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '22px 16px', borderRadius: 10, cursor: 'pointer', border: `2px dashed ${dropDragging ? '#4472E8' : '#D1D5DB'}`, background: dropDragging ? 'rgba(68,114,232,0.04)' : '#FAFAFA', transition: 'all 0.15s' }}
                  onDragOver={e => { e.preventDefault(); setDropDragging(true); }}
                  onDragLeave={() => setDropDragging(false)}
                  onDrop={e => { e.preventDefault(); setDropDragging(false); handleDropFiles(e.dataTransfer.files); }}
                >
                  <input ref={dropInputRef} type="file" accept=".csv" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files?.length) handleDropFiles(e.target.files); e.target.value = ''; }} />
                  {isLoading ? (
                    <div style={{ width: 22, height: 22, borderRadius: '50%', border: '2.5px solid #4472E8', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                    </svg>
                  )}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', fontFamily: "'Metropolis', sans-serif" }}>Drop any report here, or click to browse</div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2, fontFamily: "'Metropolis', sans-serif" }}>Accepts Shipments, QuickSight, Product Locations, and Inventory Changes CSVs</div>
                  </div>
                </label>

                {/* Uploaded file results */}
                {droppedFiles.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {droppedFiles.map(r => {
                      const meta = TYPE_META[r.detectedType as keyof typeof TYPE_META] ?? TYPE_META.unknown;
                      return (
                        <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, background: r.status === 'ok' ? meta.bg : r.status === 'error' ? '#FEF2F2' : r.status === 'ambiguous' ? '#FFFBEB' : '#F9FAFB', border: `1px solid ${r.status === 'ok' ? meta.color + '33' : r.status === 'error' ? '#FECACA' : r.status === 'ambiguous' ? '#FDE68A' : '#E5E7EB'}` }}>
                          {/* Status icon */}
                          <div style={{ marginTop: 1, flexShrink: 0 }}>
                            {r.status === 'processing' && <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #4472E8', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />}
                            {r.status === 'ok' && <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>}
                            {r.status === 'error' && <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>!</div>}
                            {r.status === 'ambiguous' && <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 800 }}>?</div>}
                          </div>
                          {/* Info */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#252F3E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{r.name}</span>
                              {r.status !== 'processing' && r.detectedType !== 'unknown' && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}22`, borderRadius: 3, padding: '1px 6px', whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>{meta.label}</span>
                              )}
                            </div>
                            {r.status === 'processing' && <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2, fontFamily: "'Metropolis', sans-serif" }}>Detecting report type…</div>}
                            {r.status === 'error' && <div style={{ fontSize: 10, color: '#EF4444', marginTop: 2, fontFamily: "'Metropolis', sans-serif" }}>{r.detail}</div>}
                            {r.status === 'ambiguous' && <div style={{ fontSize: 10, color: '#92400E', marginTop: 2, fontFamily: "'Metropolis', sans-serif" }}>Looks like a Shipments Report — what should we do with it?</div>}
                            {r.status === 'ambiguous' && (
                              <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                                <button onClick={() => resolveAmbiguous(r, 'merge')} style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid #4472E8', background: '#4472E8', color: '#fff', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }} title="Append rows to the existing data">Add to current</button>
                                <button onClick={() => resolveAmbiguous(r, 'current')} style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid #252F3E', background: '#252F3E', color: '#fff', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }} title="Replace existing shipments data">Replace</button>
                                <button onClick={() => resolveAmbiguous(r, 'prior')} style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }} title="Use as prior quarter for QoQ comparison">Prior quarter</button>
                              </div>
                            )}
                          </div>
                          {/* Dismiss */}
                          {(r.status === 'ok' || r.status === 'error') && (
                            <button onClick={() => setDroppedFiles(prev => prev.filter(x => x.id !== r.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 15, lineHeight: 1, flexShrink: 0, padding: '0 2px', marginTop: -1 }}>×</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
                <button onClick={() => setStep(1)} style={{ padding: '11px 20px', borderRadius: 9, border: '1.5px solid #E5E7EB', background: '#fff', color: '#374151', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}>← Back</button>
                <button
                  disabled={!canStart}
                  onClick={handleStart}
                  style={{ padding: '11px 24px', borderRadius: 9, border: 'none', background: canStart ? '#4472E8' : '#E5E7EB', color: canStart ? '#fff' : '#9CA3AF', fontWeight: 800, fontSize: 14, cursor: canStart ? 'pointer' : 'not-allowed', fontFamily: "'Metropolis', sans-serif", transition: 'background 0.15s' }}
                >
                  Start QBR →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
