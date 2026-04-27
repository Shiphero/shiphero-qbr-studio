import { useState, useEffect, lazy, Suspense } from 'react';
import ShippingTab from './ShippingTab';
import InventoryHealthTab from './InventoryHealthTab';
import Dashboard from './Dashboard';
import RateCardTab from './RateCardTab';
import SetupTab from './SetupTab';
import QBRHomeDashboard from './QBRHomeDashboard';
import NewQBRModal from './NewQBRModal';
import { useData, SessionBundle } from '../context/DataContext';
import { useDeck } from '../context/DeckContext';
import { usePDF } from '../context/PDFContext';
import shipheroIsoUrl from '../assets/logos/shiphero-iso.png';
import AccountHealthTab from './AccountHealthTab';
import ThreePLTab from './ThreePLTab';
import PriorQuarterTab from './PriorQuarterTab';
import CSMProfileModal from './CSMProfileModal';
import { useCSMProfile } from '../hooks/useCSMProfile';

const QBRExportModal  = lazy(() => import('./QBRExportModal'));
const QBRDeckBuilder  = lazy(() => import('./QBRDeckBuilder'));
const HubSpotPanel    = lazy(() => import('./HubSpotPanel'));
const StorageSettingsModal = lazy(() => import('./StorageSettingsModal'));
const FollowUpDocument = lazy(() => import('./FollowUpDocument'));

import type { AppUser } from '../App';

interface LayoutProps {
  user: AppUser | null;
  onLogout: () => void;
  onProfileUpdate?: (user: AppUser) => void;
}

function ShipHeroLogo({ size = 36 }: { size?: number }) {
  return (
    <img src={shipheroIsoUrl} alt="ShipHero" width={size} height={size} style={{ objectFit: 'contain' }} />
  );
}

type Step = 'setup' | 'data' | 'deck' | 'followup' | 'leadership';
type DataSubTab = 'shipping-health' | 'shipping-3pl' | 'inventory' | 'network' | 'ratecard' | 'prior-quarter';

const STEPS: { key: Step; label: string; sub: string; badge?: string }[] = [
  { key: 'setup',           label: 'Setup',               sub: 'Client & configuration' },
  { key: 'data',            label: 'Data',                sub: 'Upload & explore' },
  { key: 'deck',            label: 'Deck',                sub: 'QBR slide builder' },
  { key: 'followup',        label: 'Follow up',           sub: 'Action items & PDF' },
  { key: 'leadership',      label: 'Leadership insights', sub: 'HubSpot · coming soon', badge: 'SOON' },
];

const DATA_SUB_TABS: { key: DataSubTab; label: string }[] = [
  { key: 'shipping-health', label: 'Account health' },
  { key: 'shipping-3pl',    label: '3PL accounts' },
  { key: 'inventory',       label: 'Inventory health' },
  { key: 'network',         label: 'Optimization' },
  { key: 'ratecard',        label: 'Rate analysis' },
  { key: 'prior-quarter',   label: 'Prior quarter' },
];


export default function Layout({ user, onLogout, onProfileUpdate }: LayoutProps) {
  const [activeStep, setActiveStep]       = useState<Step>('setup');
  const [activeDataTab, setActiveDataTab] = useState<DataSubTab>('shipping-health');
  const [showSettings, setShowSettings]   = useState(false);
  const [showCSMCard, setShowCSMCard]     = useState(false);
  const [resetKey, setResetKey]           = useState(0);
  const [isCreatingQBR, setIsCreatingQBR] = useState(false);

  const { profile: csmProfile, save: saveCSMProfileBase } = useCSMProfile(user?.email, user ?? undefined);

  const saveCSMProfile = (updates: Partial<typeof csmProfile>) => {
    saveCSMProfileBase(updates);
    // Keep App-level user in sync so the name/title appear correctly everywhere
    if (user && onProfileUpdate) {
      onProfileUpdate({
        ...user,
        name:  updates.name  ?? user.name,
        title: updates.title ?? user.title,
        photo: updates.photo !== undefined ? updates.photo : user.photo,
      });
    }
  };

  const {
    rawShipments, selectedAccount, setSelectedAccount,
    reportingPeriod, cacheStatus, clientName, clientLogo,
    cashId, cachedAt,
    sessionActive, sessions, deleteSession, goHome, resumeSession,
    exportSessionBundle, importSessionBundle,
    pendingDeckRestore, consumePendingDeckRestore,
  } = useData();
  const { applyImportedDeckState } = useDeck();
  const { clearInventoryData } = usePDF();

  const hasData = rawShipments.length > 0;

  const handleGoHome = () => {
    if (!window.confirm('Return to the QBR list? This session will be saved automatically — you can resume it any time.')) return;
    clearInventoryData();
    setResetKey(k => k + 1);
    setActiveStep('setup');
    goHome();
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    const bundle = JSON.parse(text) as SessionBundle;
    if (bundle.version !== 1) throw new Error('Unsupported bundle version');
    await importSessionBundle(bundle);
    if (bundle.deckState) applyImportedDeckState(bundle.deckState);
    setActiveStep('setup');
  };

  // Restore deck state (insights, narratives, slide config) when switching sessions
  useEffect(() => {
    if (!pendingDeckRestore) return;
    applyImportedDeckState(pendingDeckRestore);
    consumePendingDeckRestore();
  }, [pendingDeckRestore]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNavigate = (target: string) => {
    switch (target) {
      case 'shipping':  setActiveStep('data'); setActiveDataTab('shipping-health'); break;
      case 'inventory': setActiveStep('data'); setActiveDataTab('inventory');       break;
      case 'network':   setActiveStep('data'); setActiveDataTab('network');         break;
      case 'ratecard':  setActiveStep('data'); setActiveDataTab('ratecard');        break;
      case 'qbr':       setActiveStep('followup');                                  break;
      case 'deck':      setActiveStep('deck');                                      break;
      default:          setActiveStep(target as Step);                              break;
    }
  };

  const getStepState = (step: Step): 'done' | 'active' | 'pending' => {
    if (activeStep === step) return 'active';
    if (step === 'setup' && clientName && hasData) return 'done';
    if (step === 'data' && hasData) return 'done';
    return 'pending';
  };

  // ── Home screen (no active session) ─────────────────────────────────────────
  if (!sessionActive) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: '#F3F4F6', fontFamily: "'Metropolis', sans-serif" }}>
        {/* Minimal navbar for home */}
        <header style={{ background: '#252F3E', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
          <div className="flex items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <ShipHeroLogo size={32} />
              <div>
                <span className="text-white text-sm" style={{ fontWeight: 500 }}>ShipHero <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>QBR Studio</span></span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowSettings(true)} className="w-7 h-7 rounded flex items-center justify-center transition-all hover:opacity-80" style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} title="Storage & Settings">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
              </button>
              <button
                onClick={onLogout}
                className="w-7 h-7 rounded flex items-center justify-center transition-all hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
                title={`Sign out (${user?.email ?? ''})`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
              <AvatarButton profile={csmProfile} user={user} onClick={() => setShowCSMCard(true)} />
            </div>
          </div>
        </header>

        <main className="flex-1">
          <QBRHomeDashboard
            sessions={sessions}
            onNewQBR={() => setIsCreatingQBR(true)}
            onDeleteSession={deleteSession}
            onOpenSession={id => { resumeSession(id); setActiveStep('setup'); }}
            onImportFile={handleImportFile}
          />
        </main>

        {isCreatingQBR && (
          <NewQBRModal
            onComplete={() => { setIsCreatingQBR(false); setActiveStep('setup'); }}
            onCancel={() => setIsCreatingQBR(false)}
          />
        )}

        {showSettings && (
          <Suspense fallback={null}>
            <StorageSettingsModal onClose={() => setShowSettings(false)} />
          </Suspense>
        )}

        {showCSMCard && (
          <CSMProfileModal
            profile={csmProfile}
            userEmail={user?.email ?? ''}
            onSave={saveCSMProfile}
            onClose={() => setShowCSMCard(false)}
          />
        )}
      </div>
    );
  }

  // ── Active session — full tab layout ─────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F3F4F6', fontFamily: "'Metropolis', sans-serif" }}>

      {/* ── Dark top bar ────────────────────────────────────────────────────── */}
      <header style={{ background: '#252F3E', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between px-6 py-2.5">
          {/* Left: back + logo + client pill */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleGoHome}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6, border: '0.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: "'Metropolis', sans-serif" }}
              title="Back to QBR list"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
              All QBRs
            </button>
            <div className="flex items-center gap-2">
              <ShipHeroLogo size={32} />
              <span className="text-white text-sm" style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>ShipHero <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>QBR Studio</span></span>
            </div>
            {clientName && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px', borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '0.5px solid rgba(34,197,94,0.2)', marginLeft: 4 }}>
                {clientLogo && <img src={clientLogo} alt="" style={{ height: 20, maxWidth: 48, objectFit: 'contain', borderRadius: 3, background: '#fff', padding: '1px 2px' }} />}
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22C55E', flexShrink: 0 }} />
                <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontSize: 13 }}>{clientName}</span>
                {cashId && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 400 }}>#{cashId}</span>}
              </div>
            )}
          </div>
          {/* Right: settings + avatar */}
          <div className="flex items-center gap-1.5">
            {reportingPeriod && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 6, background: 'rgba(68,114,232,0.12)', border: '0.5px solid rgba(68,114,232,0.25)' }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: '#93C5FD' }}>{reportingPeriod}</span>
              </div>
            )}
            {cachedAt && (() => {
              const ageDays = Math.floor((Date.now() - new Date(cachedAt).getTime()) / 86_400_000);
              if (ageDays < 1) return null;
              const stale = ageDays > 14;
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, background: stale ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.05)', border: `0.5px solid ${stale ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.08)'}` }}>
                  {stale && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
                  <span style={{ fontSize: 10, fontWeight: 500, color: stale ? '#F59E0B' : 'rgba(255,255,255,0.35)' }}>
                    Data {ageDays}d old
                  </span>
                </div>
              );
            })()}
            {cacheStatus === 'quota-exceeded' && (
              <div className="flex items-center gap-1 px-2.5 py-1 rounded text-xs" style={{ background: 'rgba(251,191,36,0.1)', color: '#FCD34D', border: '0.5px solid rgba(251,191,36,0.2)', fontWeight: 500 }} title="Data too large to cache">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Cache full
              </div>
            )}
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
            <button
              onClick={exportSessionBundle}
              className="w-7 h-7 rounded flex items-center justify-center transition-all hover:opacity-80"
              style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
              title="Export session bundle (.qbr.json)"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
            <button onClick={() => setShowSettings(true)} className="w-7 h-7 rounded flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', cursor: 'pointer' }} title="Storage & Settings">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
            </button>
            <button
              onClick={onLogout}
              className="w-7 h-7 rounded flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
              title={`Sign out (${user?.email ?? ''})`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
            <AvatarButton profile={csmProfile} user={user} onClick={() => setShowCSMCard(true)} />
          </div>
        </div>
      </header>

      {/* ── Step rail ────────────────────────────────────────────────────────── */}
      <div style={{ background: '#fff', borderBottom: '0.5px solid rgba(0,0,0,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 24, paddingRight: 24 }}>
          {STEPS.map((step, i) => {
            const state = getStepState(step.key);
            const isDone    = state === 'done';
            const isActive  = state === 'active';
            const isPending = state === 'pending';

            const circleColor = isDone ? '#22C55E' : isActive ? '#4472E8' : '#E5E7EB';
            const labelColor  = isActive ? '#252F3E' : isDone ? '#374151' : '#9CA3AF';
            const subColor    = isActive ? '#6B7280' : isDone ? '#9CA3AF' : '#D1D5DB';

            return (
              <div key={step.key} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setActiveStep(step.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 16px',
                    background: 'none', border: 'none',
                    cursor: 'pointer',
                    borderBottom: isActive ? '2px solid #4472E8' : '2px solid transparent',
                    fontFamily: "'Metropolis', sans-serif",
                    transition: 'border-color 0.15s',
                  }}
                >
                  {/* Circle */}
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%',
                    background: circleColor,
                    border: isPending ? '1.5px solid #E5E7EB' : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {isDone ? (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <polyline points="2 6 5 9.5 10 2.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : isActive ? (
                      <span style={{ fontSize: 11, fontWeight: 500, color: '#fff' }}>{i + 1}</span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 400, color: '#9CA3AF' }}>{i + 1}</span>
                    )}
                  </div>
                  {/* Labels */}
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: isActive ? 500 : 400, color: labelColor, lineHeight: 1.3 }}>{step.label}</span>
                      {step.badge && (
                        <span style={{
                          fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
                          background: isActive ? 'rgba(68,114,232,0.15)' : 'rgba(0,0,0,0.05)',
                          color: isActive ? '#4472E8' : '#9CA3AF',
                          border: `0.5px solid ${isActive ? 'rgba(68,114,232,0.25)' : 'rgba(0,0,0,0.08)'}`,
                          letterSpacing: '0.04em', verticalAlign: 'middle',
                        }}>
                          {step.badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 400, color: subColor, lineHeight: 1.3 }}>{step.sub}</div>
                  </div>
                </button>
                {/* Connector */}
                {i < STEPS.length - 1 && (
                  <div style={{ width: 32, height: 1, background: isDone ? 'rgba(34,197,94,0.25)' : 'rgba(0,0,0,0.07)', flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Data sub-nav — only visible when activeStep === 'data' */}
        {activeStep === 'data' && (
          <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 24, borderTop: '0.5px solid rgba(0,0,0,0.05)', background: '#FAFAFA' }}>
            {DATA_SUB_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveDataTab(key)}
                style={{
                  padding: '8px 16px',
                  fontSize: 12,
                  fontWeight: activeDataTab === key ? 500 : 400,
                  color: activeDataTab === key ? '#4472E8' : '#6B7280',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: activeDataTab === key ? '2px solid #4472E8' : '2px solid transparent',
                  fontFamily: "'Metropolis', sans-serif",
                  transition: 'color 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            ))}
            {selectedAccount !== 'all' && (
              <div
                onClick={() => setSelectedAccount('all')}
                style={{ marginLeft: 'auto', marginRight: 24, display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 5, background: 'rgba(239,82,82,0.1)', color: '#EF5252', border: '0.5px solid rgba(239,82,82,0.2)', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
                title="Click to clear account filter"
              >
                {selectedAccount} <span style={{ opacity: 0.6 }}>✕</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        <div key={resetKey}>
          {/* Setup */}
          <div style={{ display: activeStep === 'setup' ? 'block' : 'none' }}>
            <SetupTab onNavigate={handleNavigate} />
          </div>

          {/* Data */}
          <div style={{ display: activeStep === 'data' ? 'block' : 'none' }}>
            <div style={{ display: activeDataTab === 'shipping-health' ? 'block' : 'none' }}><AccountHealthTab onManageWarehouses={() => setActiveDataTab('network')} /></div>
            <div style={{ display: activeDataTab === 'shipping-3pl'    ? 'block' : 'none' }}><ThreePLTab /></div>
            <div style={{ display: activeDataTab === 'inventory'       ? 'block' : 'none' }}><InventoryHealthTab /></div>
            <div style={{ display: activeDataTab === 'network'         ? 'block' : 'none' }}><Dashboard /></div>
            <div style={{ display: activeDataTab === 'ratecard'        ? 'block' : 'none' }}><RateCardTab /></div>
            <div style={{ display: activeDataTab === 'prior-quarter'   ? 'block' : 'none' }}><PriorQuarterTab /></div>
          </div>

          {/* Deck */}
          <div style={{ display: activeStep === 'deck' ? 'flex' : 'none', flexDirection: 'column', height: 'calc(100vh - 148px)' }}>
            <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading QBR Deck Builder…</div>}>
              <QBRDeckBuilder />
            </Suspense>
          </div>

          {/* Follow up */}
          <div style={{ display: activeStep === 'followup' ? 'block' : 'none', overflowY: 'auto', height: 'calc(100vh - 148px)' }}>
            <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#6B7280' }}>Loading Follow-Up Document…</div>}>
              <FollowUpDocument />
            </Suspense>
          </div>

          {/* Leadership insights — coming soon */}
          <div style={{ display: activeStep === 'leadership' ? 'block' : 'none' }}>
            <div style={{ maxWidth: 540, margin: '64px auto', padding: '0 24px', fontFamily: "'Metropolis', sans-serif" }}>
              <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: '40px 36px', textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(255,122,0,0.08)', border: '0.5px solid rgba(255,122,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="3" fill="#FF7A00"/>
                    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="#FF7A00" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Coming soon</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#252F3E', marginBottom: 10 }}>Leadership Insights</div>
                <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.7 }}>
                  HubSpot CRM integration — deals, contacts, notes, and tasks — directly inside QBR Studio.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {showSettings && (
        <Suspense fallback={null}>
          <StorageSettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      )}

      {showCSMCard && (
        <CSMProfileModal
          profile={csmProfile}
          userEmail={user?.email ?? ''}
          onSave={saveCSMProfile}
          onClose={() => setShowCSMCard(false)}
        />
      )}
    </div>
  );
}

// ── Avatar button ─────────────────────────────────────────────────────────────
function AvatarButton({
  profile, user, onClick,
}: {
  profile: { photo: string | null; name: string };
  user: AppUser | null;
  onClick: () => void;
}) {
  const initials = (profile.name || user?.name || user?.email || 'S').trim().charAt(0).toUpperCase();
  return (
    <button
      onClick={onClick}
      title="Edit CSM profile"
      style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        border: profile.photo ? '2px solid rgba(255,255,255,0.3)' : 'none',
        padding: 0, cursor: 'pointer', overflow: 'hidden',
        background: profile.photo ? 'transparent' : '#4472E8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'opacity 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 0 2px rgba(68,114,232,0.5)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none'; }}
    >
      {profile.photo ? (
        <img src={profile.photo} alt={profile.name || 'CSM'} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
      ) : (
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', fontFamily: "'Metropolis', sans-serif" }}>{initials}</span>
      )}
    </button>
  );
}
