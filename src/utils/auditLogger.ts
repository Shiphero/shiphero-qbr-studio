import { safeSetItem, safeGetItem, STORAGE_KEYS } from './storageUtils';

export type AuditEventType =
  | 'csv_upload'
  | 'csv_upload_merge'
  | 'prior_period_upload'
  | 'qbr_export'
  | 'deck_export'
  | 'inventory_upload'
  | 'data_cleared'
  | 'storage_wiped'
  | 'account_filter_changed'
  | 'reporting_period_set';

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: string;     // ISO string
  user: string;          // email or 'anonymous'
  meta: Record<string, string | number | boolean | null>;
}

const MAX_LOCAL_EVENTS = 200;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Read / Write ──────────────────────────────────────────────────────────────

export function getAuditLog(): AuditEvent[] {
  return safeGetItem<AuditEvent[]>(STORAGE_KEYS.AUDIT_LOG) ?? [];
}

function saveAuditLog(events: AuditEvent[]): void {
  safeSetItem(STORAGE_KEYS.AUDIT_LOG, events);
}

// ── Log an event ─────────────────────────────────────────────────────────────

export function logEvent(
  type: AuditEventType,
  user: string,
  meta: AuditEvent['meta'] = {},
  webhookUrl?: string,
): void {
  const event: AuditEvent = {
    id: generateId(),
    type,
    timestamp: new Date().toISOString(),
    user: user || 'anonymous',
    meta,
  };

  // Persist locally
  const existing = getAuditLog();
  const updated = [event, ...existing].slice(0, MAX_LOCAL_EVENTS);
  saveAuditLog(updated);

  // Fire-and-forget webhook if configured
  if (webhookUrl) {
    sendToWebhook(webhookUrl, event).catch(() => { /* silent */ });
  }
}

// ── Google Sheets webhook ─────────────────────────────────────────────────────

async function sendToWebhook(url: string, event: AuditEvent): Promise<void> {
  const body = JSON.stringify({
    timestamp: event.timestamp,
    type: event.type,
    user: event.user,
    ...event.meta,
  });

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

// ── Clear ────────────────────────────────────────────────────────────────────

export function clearAuditLog(): void {
  saveAuditLog([]);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function auditEventLabel(type: AuditEventType): string {
  const labels: Record<AuditEventType, string> = {
    csv_upload:               'Shipment CSV uploaded',
    csv_upload_merge:         'Shipment CSV merged (chunk)',
    prior_period_upload:      'Prior period CSV uploaded',
    qbr_export:               'QBR exported',
    deck_export:              'QBR Deck exported',
    inventory_upload:         'Inventory file uploaded',
    data_cleared:             'Data cleared',
    storage_wiped:            'localStorage wiped',
    account_filter_changed:   'Account filter changed',
    reporting_period_set:     'Reporting period updated',
  };
  return labels[type] ?? type;
}
