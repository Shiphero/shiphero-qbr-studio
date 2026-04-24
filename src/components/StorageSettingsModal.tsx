import { useState } from 'react';
import { useData } from '../context/DataContext';
import { useAudit } from '../context/AuditContext';
import { relativeTime, storedSizeKB, STORAGE_KEYS } from '../utils/storageUtils';
import { auditEventLabel } from '../utils/auditLogger';

interface Props {
  onClose: () => void;
}

const NAV = ['Storage', 'Audit Log', 'Settings'] as const;
type NavTab = typeof NAV[number];

export default function StorageSettingsModal({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<NavTab>('Storage');
  const { cacheStatus, cachedAt, cacheStoredKB, wipeStorage, priorPeriod, clearPriorPeriod, fileName } = useData();
  const { events, clearLog, settings, saveSettings } = useAudit();

  const [webhookUrl, setWebhookUrl] = useState(settings.webhookUrl);
  const [userIdentifier, setUserIdentifier] = useState(settings.userIdentifier);
  const [saved, setSaved] = useState(false);

  const handleSaveSettings = () => {
    saveSettings({ webhookUrl, userIdentifier });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleWipe = () => {
    if (!window.confirm('Wipe ALL localStorage data? This will clear shipment data, prior period, audit log, and settings. This cannot be undone.')) return;
    wipeStorage();
    onClose();
  };

  const priorKB = storedSizeKB(STORAGE_KEYS.PRIOR_PERIOD);
  const auditKB = storedSizeKB(STORAGE_KEYS.AUDIT_LOG);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: '#1C2433', width: 560, maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF5252" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
            </svg>
            <span className="text-white font-bold text-base">Storage & Settings</span>
          </div>
          <button onClick={onClose} style={{ color: 'rgba(255,255,255,0.5)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        {/* Sub-nav */}
        <div className="flex px-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {NAV.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-sm font-semibold transition-all relative"
              style={{ color: activeTab === tab ? '#EF5252' : 'rgba(255,255,255,0.5)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {tab}
              {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: '#EF5252' }} />}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-6">

          {activeTab === 'Storage' && (
            <div className="space-y-4">
              <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-xs font-bold mb-3" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>CACHED DATA</div>
                <StorageRow
                  label="Shipment data"
                  sublabel={fileName ?? 'No file loaded'}
                  sizeKB={cacheStoredKB}
                  status={cacheStatus === 'ok' ? 'Cached' : cacheStatus === 'quota-exceeded' ? 'Quota exceeded' : 'Not cached'}
                  statusColor={cacheStatus === 'ok' ? '#4ADE80' : cacheStatus === 'quota-exceeded' ? '#F87171' : 'rgba(255,255,255,0.3)'}
                  note={cachedAt ? `Saved ${relativeTime(cachedAt)}` : undefined}
                />
                <StorageRow
                  label="Prior period"
                  sublabel={priorPeriod?.fileName ?? 'No prior period uploaded'}
                  sizeKB={priorKB}
                  status={priorPeriod ? 'Cached' : 'Empty'}
                  statusColor={priorPeriod ? '#4ADE80' : 'rgba(255,255,255,0.3)'}
                  note={priorPeriod ? `Uploaded ${relativeTime(priorPeriod.uploadedAt)}` : undefined}
                  onClear={priorPeriod ? clearPriorPeriod : undefined}
                  clearLabel="Remove"
                />
                <StorageRow
                  label="Audit log"
                  sublabel={`${events.length} event${events.length !== 1 ? 's' : ''}`}
                  sizeKB={auditKB}
                  status={events.length > 0 ? 'Active' : 'Empty'}
                  statusColor={events.length > 0 ? '#60A5FA' : 'rgba(255,255,255,0.3)'}
                />
              </div>

              <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <div className="text-sm font-bold mb-1" style={{ color: '#FCA5A5' }}>Wipe all localStorage</div>
                <div className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Removes all cached data, prior period, audit events, and settings from this browser. The app will return to its initial state.
                </div>
                <button
                  onClick={handleWipe}
                  className="px-4 py-1.5 rounded-lg text-sm font-bold"
                  style={{ background: 'rgba(239,68,68,0.2)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}
                >
                  Wipe Storage
                </button>
              </div>
            </div>
          )}

          {activeTab === 'Audit Log' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{events.length} events stored locally (max 200)</span>
                {events.length > 0 && (
                  <button
                    onClick={() => { if (window.confirm('Clear audit log?')) clearLog(); }}
                    className="text-xs px-3 py-1 rounded-lg"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}
                  >
                    Clear Log
                  </button>
                )}
              </div>

              {events.length === 0 ? (
                <div className="text-center py-8 text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No events recorded yet</div>
              ) : (
                <div className="space-y-1.5">
                  {events.map(e => (
                    <div key={e.id} className="flex items-start gap-3 rounded-lg px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <span className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>{relativeTime(e.timestamp)}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>{auditEventLabel(e.type)}</div>
                        {e.user && e.user !== 'anonymous' && (
                          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{e.user}</div>
                        )}
                        {Object.keys(e.meta).length > 0 && (
                          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
                            {Object.entries(e.meta).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'Settings' && (
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>YOUR NAME / EMAIL</label>
                <input
                  value={userIdentifier}
                  onChange={e => setUserIdentifier(e.target.value)}
                  placeholder="e.g. jane@shiphero.com"
                  className="w-full px-3 py-2 rounded-lg text-sm"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', outline: 'none' }}
                />
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Used to identify you in the audit log.</p>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>AUDIT WEBHOOK URL <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>(optional)</span></label>
                <input
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/..."
                  className="w-full px-3 py-2 rounded-lg text-sm font-mono"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', outline: 'none' }}
                />
                <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  Google Apps Script Web App URL to receive audit events as JSON POST requests. Each event is sent individually and contains: timestamp, type, user, and metadata.
                </p>
              </div>

              <button
                onClick={handleSaveSettings}
                className="px-5 py-2 rounded-lg text-sm font-bold"
                style={{ background: '#EF5252', color: '#252F3E', border: 'none', cursor: 'pointer' }}
              >
                {saved ? '✓ Saved' : 'Save Settings'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StorageRow({
  label, sublabel, sizeKB, status, statusColor, note, onClear, clearLabel,
}: {
  label: string;
  sublabel: string;
  sizeKB: number;
  status: string;
  statusColor: string;
  note?: string;
  onClear?: () => void;
  clearLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>{label}</div>
        <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>{sublabel}</div>
        {note && <div className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{note}</div>}
      </div>
      <div className="flex items-center gap-3 ml-3 shrink-0">
        {sizeKB > 0 && <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{sizeKB} KB</span>}
        <span className="text-xs font-semibold" style={{ color: statusColor }}>{status}</span>
        {onClear && (
          <button
            onClick={onClear}
            className="text-xs px-2 py-0.5 rounded"
            style={{ background: 'rgba(239,68,68,0.15)', color: '#FCA5A5', border: 'none', cursor: 'pointer' }}
          >
            {clearLabel ?? 'Clear'}
          </button>
        )}
      </div>
    </div>
  );
}
