import React, { createContext, useContext, useCallback, useState } from 'react';
import { AuditEvent, AuditEventType, logEvent, getAuditLog, clearAuditLog } from '../utils/auditLogger';
import { safeGetItem, safeSetItem, STORAGE_KEYS } from '../utils/storageUtils';

interface AuditSettings {
  webhookUrl: string;
  userIdentifier: string;   // CSM email / name entered in settings
}

interface AuditContextValue {
  log: (type: AuditEventType, meta?: AuditEvent['meta']) => void;
  events: AuditEvent[];
  clearLog: () => void;
  refreshEvents: () => void;
  settings: AuditSettings;
  saveSettings: (s: AuditSettings) => void;
}

const AuditContext = createContext<AuditContextValue | null>(null);

const DEFAULT_SETTINGS: AuditSettings = { webhookUrl: '', userIdentifier: 'anonymous' };

export function AuditProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<AuditEvent[]>(() => getAuditLog());
  const [settings, setSettings] = useState<AuditSettings>(() => {
    return safeGetItem<AuditSettings>(STORAGE_KEYS.SETTINGS) ?? DEFAULT_SETTINGS;
  });

  const log = useCallback((type: AuditEventType, meta: AuditEvent['meta'] = {}) => {
    const stored = safeGetItem<AuditSettings>(STORAGE_KEYS.SETTINGS) ?? DEFAULT_SETTINGS;
    logEvent(type, stored.userIdentifier || 'anonymous', meta, stored.webhookUrl || undefined);
    setEvents(getAuditLog());
  }, []);

  const clearLog = useCallback(() => {
    clearAuditLog();
    setEvents([]);
  }, []);

  const refreshEvents = useCallback(() => {
    setEvents(getAuditLog());
  }, []);

  const saveSettings = useCallback((s: AuditSettings) => {
    safeSetItem(STORAGE_KEYS.SETTINGS, s);
    setSettings(s);
  }, []);

  return (
    <AuditContext.Provider value={{ log, events, clearLog, refreshEvents, settings, saveSettings }}>
      {children}
    </AuditContext.Provider>
  );
}

export function useAudit(): AuditContextValue {
  const ctx = useContext(AuditContext);
  if (!ctx) throw new Error('useAudit must be used within AuditProvider');
  return ctx;
}
