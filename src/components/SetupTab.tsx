import { useRef, useCallback, useState } from 'react';
import { useData } from '../context/DataContext';
import { usePDF } from '../context/PDFContext';
import { useAudit } from '../context/AuditContext';
import { detectReportType, readCSVHeaders, TYPE_META, type DetectedType } from '../utils/reportDetection';

const QUICKSIGHT_URL =
  'https://us-east-1.quicksight.aws.amazon.com/sn/account/shiphero/accounts/511204426188/dashboards/3931cf99-e3dc-479a-aa50-7ecfc980637e/sheets/3931cf99-e3dc-479a-aa50-7ecfc980637e_2cb9c88b-85d7-4314-8b98-42907f513114';

interface Props {
  onNavigate: (tab: string) => void;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface FileResult {
  id: string;
  name: string;
  type: DetectedType;
  status: 'processing' | 'ok' | 'error' | 'ambiguous';
  detail?: string;
  warnings?: string[];
  file: File;
}

export default function SetupTab({ onNavigate }: Props) {
  const {
    clientName, setClientName, clientLogo, setClientLogo,
    rawShipments, fileName, uploadCSV, mergeShipmentsCSV, shipmentFileCount,
    isLoading, error,
    warehouses, setWarehouseZip, toggleWarehouseExcluded,
    statsLoaded, statsRows, reportingPeriod, setReportingPeriod,
    priorPeriod, uploadPriorCSV,
    setPendingStatsFile, setPendingLocFile, setPendingChangeFiles,
  } = useData();
  const { locLoaded, inventoryData } = usePDF();
  const { log } = useAudit();

  const logoRef      = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadZoneRef = useRef<HTMLDivElement>(null);

  const [dragOver,        setDragOver]        = useState(false);
  const [results,         setResults]         = useState<FileResult[]>([]);
  const [changeFilesLocal, setChangeFilesLocal] = useState<File[]>([]);

  const hasShipping  = rawShipments.length > 0;
  const hasInventory = locLoaded;
  const hasPrior     = !!priorPeriod;

  // ── Data-agreement check ─────────────────────────────────────────────────
  const dataDiscrepancy = (() => {
    if (!hasShipping || !statsLoaded || statsRows.length === 0) return null;
    const statsLabelCount = statsRows.reduce((sum, r) => sum + r.labelCount, 0);
    if (statsLabelCount === 0) return null;
    const shipmentCount = rawShipments.length;
    const diff = Math.abs(shipmentCount - statsLabelCount);
    const pct = (diff / statsLabelCount) * 100;
    if (pct <= 5) return null;
    return { shipmentCount, statsLabelCount, pct };
  })();

  // ── Logo ──────────────────────────────────────────────────────────────────
  const handleLogoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setClientLogo(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [setClientLogo]);

  // ── File routing ──────────────────────────────────────────────────────────
  const routeFile = useCallback(async (file: File, forceType?: 'current' | 'prior' | 'merge') => {
    const id = `${file.name}-${Date.now()}`;

    // Add as processing
    setResults(prev => [...prev.filter(r => r.id !== id), {
      id, name: file.name, type: 'unknown', status: 'processing', file,
    }]);

    const headers = await readCSVHeaders(file);
    const type = detectReportType(headers);

    const update = (patch: Partial<FileResult>) =>
      setResults(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

    if (type === 'unknown') {
      update({ type: 'unknown', status: 'error', detail: 'Could not identify report type from column headers.' });
      return;
    }

    if (type === 'shipments' && forceType === undefined && hasShipping) {
      // Ambiguous — ask user
      update({ type: 'shipments', status: 'ambiguous' });
      return;
    }

    try {
      if (type === 'shipments') {
        if (forceType === 'prior') {
          const { errors, warnings } = await uploadPriorCSV(file);
          if (errors.length) { update({ status: 'error', detail: errors[0] }); return; }
          log('prior_period_upload', { fileName: file.name });
          if (warnings.length) { update({ warnings }); }
        } else if (forceType === 'merge') {
          const { errors, warnings } = await mergeShipmentsCSV(file);
          if (errors.length) { update({ status: 'error', detail: errors[0] }); return; }
          log('csv_upload_merge', { fileName: file.name });
          if (warnings.length) { update({ warnings }); }
        } else {
          const { errors, warnings } = await uploadCSV(file);
          if (errors.length) { update({ status: 'error', detail: errors[0] }); return; }
          log('csv_upload', { fileName: file.name });
          if (warnings.length) { update({ warnings }); }
        }
      } else if (type === 'stats') {
        setPendingStatsFile(file);
      } else if (type === 'locations') {
        setPendingLocFile(file);
      } else if (type === 'inventory-changes') {
        setChangeFilesLocal(prev => {
          if (prev.some(f => f.name === file.name)) return prev;
          const next = [...prev, file];
          setPendingChangeFiles(next);
          return next;
        });
      }
      update({ type, status: 'ok' });
    } catch (e) {
      update({ type, status: 'error', detail: e instanceof Error ? e.message : 'Upload failed' });
    }
  }, [hasShipping, uploadCSV, uploadPriorCSV, mergeShipmentsCSV, setPendingStatsFile, setPendingLocFile, setPendingChangeFiles, log]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach(f => routeFile(f));
  }, [routeFile]);

  const resolveAmbiguous = useCallback((result: FileResult, choice: 'current' | 'prior' | 'merge') => {
    // Remove ambiguous entry, re-process with forced type
    setResults(prev => prev.filter(r => r.id !== result.id));
    routeFile(result.file, choice);
  }, [routeFile]);

  const removeResult = useCallback((id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
  }, []);

  const removeChangeFile = useCallback((name: string) => {
    setChangeFilesLocal(prev => {
      const next = prev.filter(f => f.name !== name);
      setPendingChangeFiles(next);
      return next;
    });
  }, [setPendingChangeFiles]);

  return (
    <div style={{ padding: '28px 32px', maxWidth: 900, margin: '0 auto', fontFamily: "'Metropolis', sans-serif" }}>

      {/* Page title */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#252F3E', margin: 0 }}>Setup</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Configure your client and load data before building the QBR.</p>
      </div>

      {/* ── Client profile ── */}
      <Section title="Client Profile" subtitle="This information appears on the PDF cover page">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>

          {/* Logo upload */}
          <div>
            <Label>CLIENT LOGO</Label>
            <div
              onClick={() => logoRef.current?.click()}
              style={{
                height: 110, borderRadius: 10, border: '2px dashed #D1D5DB',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', background: '#FAFAFA', gap: 8, transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#4472E8')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#D1D5DB')}
            >
              {clientLogo ? (
                <img src={clientLogo} alt="Client logo" style={{ maxHeight: 80, maxWidth: '80%', objectFit: 'contain', borderRadius: 4 }} />
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>Click to upload logo</span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>PNG, JPG, SVG — appears on cover</span>
                </>
              )}
            </div>
            <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoChange} />
            {clientLogo && (
              <button onClick={() => setClientLogo(null)} style={{ marginTop: 6, fontSize: 11, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                Remove logo
              </button>
            )}
          </div>

          {/* Name + period */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <Label>CLIENT / 3PL NAME</Label>
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Acme Corp" style={INPUT} />
            </div>
            <div>
              <Label>REPORTING PERIOD</Label>
              <input value={reportingPeriod} onChange={e => setReportingPeriod(e.target.value)} placeholder="e.g. Q2 2026" style={INPUT} />
              <p style={{ fontSize: 11, color: '#6B7280', margin: '4px 0 0' }}>Auto-filled when you upload a Shipments Report</p>
            </div>
          </div>
        </div>

      </Section>

      {/* ── Reports checklist ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#252F3E' }}>Reports Checklist</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>Upload all required reports to unlock every dashboard section</div>
          </div>
          <button
            onClick={() => onNavigate('followup')}
            disabled={!hasShipping}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
              padding: '9px 18px', borderRadius: 10, border: 'none', cursor: hasShipping ? 'pointer' : 'not-allowed',
              background: hasShipping ? '#252F3E' : '#E5E7EB',
              color: hasShipping ? '#fff' : '#9CA3AF',
              fontWeight: 700, fontSize: 13, fontFamily: "'Metropolis', sans-serif",
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {hasShipping ? 'Open QBR Follow Up' : 'Upload data to continue'}
          </button>
        </div>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
          {[
            { label: 'Shipments Report',         path: 'ShipHero → Reports → Shipments',                            done: hasShipping,              required: true,  doneLabel: shipmentFileCount > 1 ? `${shipmentFileCount} files · ${rawShipments.length.toLocaleString()} rows` : fileName ? fileName : `${rawShipments.length.toLocaleString()} rows` },
            { label: "Prior Quarter's Shipments", path: 'Same as Shipments Report — prior period',                  done: hasPrior,                 required: false, doneLabel: priorPeriod?.fileName },
            { label: 'QuickSight CSS_5_Insights', path: 'ShipHero QuickSight → CSS_5_Insights export',              done: statsLoaded,              required: false, doneLabel: statsLoaded ? 'Loaded' : undefined },
            { label: 'Product Locations CSV',     path: 'ShipHero → Reports → Product Locations',                   done: hasInventory,             required: false, doneLabel: hasInventory ? 'Loaded' : undefined },
            { label: 'Inventory Changes CSV',     path: 'ShipHero → Reports → Inventory Changes (one per warehouse)', done: changeFilesLocal.length > 0 || (inventoryData?.changeFileEntries?.length ?? 0) > 0, required: false, doneLabel: changeFilesLocal.length > 0 ? `${changeFilesLocal.length} file${changeFilesLocal.length > 1 ? 's' : ''}` : (inventoryData?.changeFileEntries?.length ?? 0) > 0 ? `${inventoryData!.changeFileEntries!.length} file${inventoryData!.changeFileEntries!.length > 1 ? 's' : ''}` : undefined },
          ].map((item, i, arr) => (
            <div
              key={item.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 18px',
                borderBottom: i < arr.length - 1 ? '1px solid #F3F4F6' : 'none',
                background: item.done ? '#F9FEFB' : '#fff',
                cursor: item.done ? 'default' : 'pointer',
                transition: 'background 0.12s',
              }}
              onClick={() => { if (!item.done) uploadZoneRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
              onMouseEnter={e => { if (!item.done) (e.currentTarget as HTMLDivElement).style.background = '#F9FAFB'; }}
              onMouseLeave={e => { if (!item.done) (e.currentTarget as HTMLDivElement).style.background = item.done ? '#F9FEFB' : '#fff'; }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: item.done ? '#22C55E' : '#F3F4F6',
                border: item.done ? 'none' : '2px solid #D1D5DB',
              }}>
                {item.done
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#D1D5DB' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#252F3E' }}>{item.label}</span>
                  {item.required && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#B45309', background: '#FEF3C7', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.04em' }}>REQUIRED</span>
                  )}
                  {item.done && item.doneLabel && (
                    <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 600 }}>· {item.doneLabel}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{item.path}</div>
              </div>
              {!item.done && (
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, color: '#9CA3AF', fontSize: 11, fontWeight: 600 }}>
                  Upload
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Data-agreement notice ── */}
      {dataDiscrepancy && (
        <div style={{
          padding: '12px 16px', borderRadius: 10,
          background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)',
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
            <strong>Data sources differ by {dataDiscrepancy.pct.toFixed(1)}%</strong>
            {' — '}Shipments CSV: <strong>{dataDiscrepancy.shipmentCount.toLocaleString()} labels</strong>
            {' · '}Statistics CSV: <strong>{dataDiscrepancy.statsLabelCount.toLocaleString()} labels</strong>.{' '}
            This is normal — voids, multi-package orders, and export timing cause minor differences between reports.
            Slides sourced from each CSV will reflect their respective counts.
          </div>
        </div>
      )}

      {/* ── Warehouse ZIPs ── */}
      <Section title="Warehouse ZIP Codes" subtitle="Used for zone and rate card analysis">
        {warehouses.length > 0 ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
              {warehouses.filter(w => !w.excluded).map(w => (
                <div key={w.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: w.zip ? '#F0FDF4' : '#FAFAFA', border: `1px solid ${w.zip ? '#BBF7D0' : '#E5E7EB'}` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>{w.name}</div>
                    <input
                      value={w.zip}
                      onChange={e => setWarehouseZip(w.name, e.target.value)}
                      placeholder="Enter ZIP code"
                      maxLength={5}
                      style={{ ...INPUT, padding: '5px 8px', fontSize: 13, background: 'transparent', border: '1px solid #E5E7EB' }}
                    />
                  </div>
                  {w.zip && (
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                  )}
                  <button
                    onClick={() => toggleWarehouseExcluded(w.name)}
                    title="Exclude this warehouse (virtual / settings-only)"
                    style={{ width: 18, height: 18, borderRadius: '50%', background: 'transparent', border: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, color: '#9CA3AF', fontSize: 13, lineHeight: 1 }}
                  >×</button>
                </div>
              ))}
            </div>
            {warehouses.some(w => w.excluded) && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Excluded warehouses</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {warehouses.filter(w => w.excluded).map(w => (
                    <button
                      key={w.name}
                      onClick={() => toggleWarehouseExcluded(w.name)}
                      title="Click to restore"
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: '#F9FAFB', border: '1px solid #E5E7EB', cursor: 'pointer', fontSize: 12, color: '#9CA3AF', fontWeight: 600, fontFamily: "'Metropolis', sans-serif" }}
                    >
                      <span>{w.name}</span>
                      <span style={{ fontSize: 10, color: '#4472E8' }}>restore</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '12px 14px', borderRadius: 8, background: '#FAFAFA', border: '1px dashed #E5E7EB', display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>Warehouse names are pulled from your Shipments Report — upload one below to configure ZIPs.</span>
          </div>
        )}
      </Section>

      {/* ── Upload reports ── */}
      <Section title="Upload Reports" subtitle="Drop any report — the system identifies it automatically">

        {/* Drop zone */}
        <div
          ref={uploadZoneRef}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          onClick={() => fileInputRef.current?.click()}
          style={{
            borderRadius: 12, border: `2px dashed ${dragOver ? '#4472E8' : '#D1D5DB'}`,
            background: dragOver ? 'rgba(68,114,232,0.04)' : '#FAFAFA',
            padding: '32px 24px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
            cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={e => { if (!dragOver) { (e.currentTarget as HTMLDivElement).style.borderColor = '#4472E8'; (e.currentTarget as HTMLDivElement).style.background = 'rgba(68,114,232,0.02)'; } }}
          onMouseLeave={e => { if (!dragOver) { (e.currentTarget as HTMLDivElement).style.borderColor = '#D1D5DB'; (e.currentTarget as HTMLDivElement).style.background = '#FAFAFA'; } }}
        >
          <div style={{ width: 44, height: 44, borderRadius: 12, background: dragOver ? 'rgba(68,114,232,0.1)' : '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#4472E8' : '#9CA3AF'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: dragOver ? '#4472E8' : '#252F3E' }}>
              {dragOver ? 'Drop to upload' : 'Drop reports here, or click to browse'}
            </div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 3 }}>
              Accepts Shipments, QuickSight, Product Locations, and Inventory Changes CSVs
            </div>
          </div>
          {isLoading && (
            <div style={{ fontSize: 12, color: '#4472E8', fontWeight: 600 }}>Processing…</div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          style={{ display: 'none' }}
          onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
        />

        {/* Result tags */}
        {results.length > 0 && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map(r => {
              const meta = TYPE_META[r.type];
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10,
                  background: r.status === 'ok' && r.warnings?.length ? '#FFFBEB' : r.status === 'ok' ? meta.bg : r.status === 'error' ? '#FEF2F2' : r.status === 'ambiguous' ? '#FFFBEB' : '#F9FAFB',
                  border: `1px solid ${r.status === 'ok' && r.warnings?.length ? '#FDE68A' : r.status === 'ok' ? '#D1FAE5' : r.status === 'error' ? '#FECACA' : r.status === 'ambiguous' ? '#FDE68A' : '#E5E7EB'}`,
                }}>
                  {/* Status icon */}
                  <div style={{ flexShrink: 0 }}>
                    {r.status === 'processing' && (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #D1D5DB', borderTopColor: '#4472E8', animation: 'spin 0.8s linear infinite' }} />
                    )}
                    {r.status === 'ok' && !r.warnings?.length && (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                    {r.status === 'ok' && !!r.warnings?.length && (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      </div>
                    )}
                    {r.status === 'error' && (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>!</div>
                    )}
                    {r.status === 'ambiguous' && (
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>?</div>
                    )}
                  </div>

                  {/* File info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#252F3E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{r.name}</span>
                      {r.status !== 'processing' && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg, border: `1px solid ${meta.color}22`, borderRadius: 4, padding: '1px 7px', letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                          {meta.label}
                        </span>
                      )}
                    </div>
                    {r.status === 'processing' && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Detecting report type…</div>}
                    {r.status === 'error'      && <div style={{ fontSize: 11, color: '#EF4444', marginTop: 2 }}>{r.detail}</div>}
                    {r.status === 'ok' && r.warnings?.length ? (
                      <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {r.warnings.map((w, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 11, color: '#92400E' }}>
                            <svg style={{ flexShrink: 0, marginTop: 1 }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            {w}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {r.status === 'ambiguous'  && (
                      <div style={{ fontSize: 11, color: '#92400E', marginTop: 2 }}>
                        Looks like a Shipments Report — what should we do with it?
                      </div>
                    )}
                  </div>

                  {/* Ambiguous actions */}
                  {r.status === 'ambiguous' && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => resolveAmbiguous(r, 'merge')}
                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid #4472E8', background: '#4472E8', color: '#fff', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
                        title="Append rows to the existing shipments data"
                      >
                        Add to current
                      </button>
                      <button
                        onClick={() => resolveAmbiguous(r, 'current')}
                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid #252F3E', background: '#252F3E', color: '#fff', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
                        title="Replace existing shipments data with this file"
                      >
                        Replace
                      </button>
                      <button
                        onClick={() => resolveAmbiguous(r, 'prior')}
                        style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
                        title="Use as prior quarter for period-over-period comparison"
                      >
                        Prior quarter
                      </button>
                    </div>
                  )}

                  {/* Dismiss */}
                  {(r.status === 'ok' || r.status === 'error') && (
                    <button onClick={() => removeResult(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 16, lineHeight: 1, flexShrink: 0, padding: '0 2px' }}>×</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Uploaded inventory-change files list */}
        {changeFilesLocal.length > 0 && (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Inventory Changes — {changeFilesLocal.length} file{changeFilesLocal.length > 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {changeFilesLocal.map(f => (
                <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span style={{ flex: 1, fontSize: 12, color: '#78350F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <button onClick={() => removeChangeFile(f.name)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* QuickSight link */}
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, color: '#6B7280', fontSize: 12 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Need the QuickSight report?{' '}
          <a href={QUICKSIGHT_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#252F3E', fontWeight: 700, textDecoration: 'underline' }}>Open QuickSight →</a>
        </div>
      </Section>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const INPUT: React.CSSProperties = {
  width: '100%', padding: '8px 11px', borderRadius: 8, fontSize: 13,
  border: '1.5px solid #E5E7EB', background: '#FAFAFA', color: '#252F3E',
  outline: 'none', boxSizing: 'border-box', fontFamily: "'Metropolis', sans-serif",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#252F3E' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{subtitle}</div>
      </div>
      <div style={{ background: '#fff', borderRadius: 12, padding: '18px 20px', border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        {children}
      </div>
    </div>
  );
}
