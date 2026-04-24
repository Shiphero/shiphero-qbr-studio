import { useState, useEffect, useCallback } from 'react';
import { useHubSpot, type HubSpotRecord } from '../hooks/useHubSpot';
import { useData } from '../context/DataContext';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Deal {
  id: string;
  name: string;
  stage: string;
  amount: string;
  closeDate: string;
  ownerId: string;
}

interface Note {
  id: string;
  body: string;
  createdAt: string;
  associatedId?: string;
}

interface Task {
  id: string;
  subject: string;
  status: string;
  dueDate: string;
  priority: string;
  notes: string;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  phone: string;
}

const FONT = "'Metropolis', sans-serif";

// ── Helpers ───────────────────────────────────────────────────────────────────
function p(record: HubSpotRecord, key: string) {
  return record.properties[key] ?? '';
}

function fmt(dateStr: string) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function currency(v: string) {
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

const STAGE_COLORS: Record<string, { bg: string; color: string }> = {
  appointmentscheduled: { bg: '#EFF6FF', color: '#1D4ED8' },
  qualifiedtobuy:       { bg: '#F0FDF4', color: '#166534' },
  presentationscheduled:{ bg: '#FAF5FF', color: '#6B21A8' },
  decisionmakerboughtin:{ bg: '#FFFBEB', color: '#92400E' },
  contractsent:         { bg: '#FFF7ED', color: '#C2410C' },
  closedwon:            { bg: '#F0FDF4', color: '#15803D' },
  closedlost:           { bg: '#FEF2F2', color: '#991B1B' },
};

function StageChip({ stage }: { stage: string }) {
  const key = stage.toLowerCase().replace(/\s+/g, '');
  const colors = STAGE_COLORS[key] ?? { bg: '#F3F4F6', color: '#374151' };
  const label = stage.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: colors.bg, color: colors.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {label}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HubSpotPanel() {
  const { status, loading, connect, disconnect, call } = useHubSpot();
  const { clientName } = useData();

  const [activeTab, setActiveTab] = useState<'deals' | 'contacts' | 'notes' | 'tasks'>('deals');
  const [deals,    setDeals]    = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [notes,    setNotes]    = useState<Note[]>([]);
  const [tasks,    setTasks]    = useState<Task[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Edit state ──────────────────────────────────────────────────────────────
  const [editingDeal,    setEditingDeal]    = useState<Deal | null>(null);
  const [editingNote,    setEditingNote]    = useState<Note | null>(null);
  const [editingTask,    setEditingTask]    = useState<Task | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [saving, setSaving] = useState(false);

  // ── New item state ──────────────────────────────────────────────────────────
  const [addingNote, setAddingNote] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [newNoteBody,  setNewNoteBody]  = useState('');
  const [newTask,      setNewTask]      = useState({ subject: '', dueDate: '', priority: 'MEDIUM', notes: '' });

  // ── Fetch data ──────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!status.connected) return;
    setDataLoading(true);
    try {
      // Search for company matching clientName
      const searchBody = clientName ? {
        filterGroups: [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: clientName }] }],
        properties: ['name', 'domain'],
        limit: 1,
      } : null;

      const [dealsRes, contactsRes, notesRes, tasksRes] = await Promise.all([
        call<{ results: HubSpotRecord[] }>('/crm/v3/objects/deals', 'GET', undefined, {
          properties: 'dealname,dealstage,amount,closedate,hubspot_owner_id',
          limit: '20',
          archived: 'false',
        }),
        call<{ results: HubSpotRecord[] }>('/crm/v3/objects/contacts', 'GET', undefined, {
          properties: 'firstname,lastname,email,jobtitle,phone',
          limit: '20',
        }),
        call<{ results: HubSpotRecord[] }>('/crm/v3/objects/notes', 'GET', undefined, {
          properties: 'hs_note_body,hs_createdate',
          limit: '20',
        }),
        call<{ results: HubSpotRecord[] }>('/crm/v3/objects/tasks', 'GET', undefined, {
          properties: 'hs_task_subject,hs_task_status,hs_task_priority,hs_timestamp,hs_task_body',
          limit: '20',
        }),
      ]);

      setDeals((dealsRes.results ?? []).map(r => ({
        id:        r.id,
        name:      p(r, 'dealname'),
        stage:     p(r, 'dealstage'),
        amount:    p(r, 'amount'),
        closeDate: p(r, 'closedate'),
        ownerId:   p(r, 'hubspot_owner_id'),
      })));

      setContacts((contactsRes.results ?? []).map(r => ({
        id:        r.id,
        firstName: p(r, 'firstname'),
        lastName:  p(r, 'lastname'),
        email:     p(r, 'email'),
        jobTitle:  p(r, 'jobtitle'),
        phone:     p(r, 'phone'),
      })));

      setNotes((notesRes.results ?? []).map(r => ({
        id:        r.id,
        body:      p(r, 'hs_note_body'),
        createdAt: p(r, 'hs_createdate'),
      })));

      setTasks((tasksRes.results ?? []).map(r => ({
        id:       r.id,
        subject:  p(r, 'hs_task_subject'),
        status:   p(r, 'hs_task_status'),
        priority: p(r, 'hs_task_priority'),
        dueDate:  p(r, 'hs_timestamp'),
        notes:    p(r, 'hs_task_body'),
      })));
    } catch (e) {
      console.error('HubSpot fetch error', e);
    } finally {
      setDataLoading(false);
    }
  }, [status.connected, call, clientName]);

  useEffect(() => { if (status.connected) fetchData(); }, [status.connected, fetchData]);

  // ── Save deal ───────────────────────────────────────────────────────────────
  const saveDeal = async () => {
    if (!editingDeal) return;
    setSaving(true);
    try {
      await call(`/crm/v3/objects/deals/${editingDeal.id}`, 'PATCH', {
        properties: { dealname: editingDeal.name, dealstage: editingDeal.stage, amount: editingDeal.amount, closedate: editingDeal.closeDate },
      });
      setDeals(prev => prev.map(d => d.id === editingDeal.id ? editingDeal : d));
      setEditingDeal(null);
    } finally { setSaving(false); }
  };

  // ── Save contact ────────────────────────────────────────────────────────────
  const saveContact = async () => {
    if (!editingContact) return;
    setSaving(true);
    try {
      await call(`/crm/v3/objects/contacts/${editingContact.id}`, 'PATCH', {
        properties: { firstname: editingContact.firstName, lastname: editingContact.lastName, jobtitle: editingContact.jobTitle, phone: editingContact.phone },
      });
      setContacts(prev => prev.map(c => c.id === editingContact.id ? editingContact : c));
      setEditingContact(null);
    } finally { setSaving(false); }
  };

  // ── Save note ───────────────────────────────────────────────────────────────
  const saveNote = async () => {
    if (!editingNote) return;
    setSaving(true);
    try {
      await call(`/crm/v3/objects/notes/${editingNote.id}`, 'PATCH', {
        properties: { hs_note_body: editingNote.body },
      });
      setNotes(prev => prev.map(n => n.id === editingNote.id ? editingNote : n));
      setEditingNote(null);
    } finally { setSaving(false); }
  };

  // ── Create note ─────────────────────────────────────────────────────────────
  const createNote = async () => {
    if (!newNoteBody.trim()) return;
    setSaving(true);
    try {
      const res = await call<HubSpotRecord>('/crm/v3/objects/notes', 'POST', {
        properties: { hs_note_body: newNoteBody, hs_timestamp: new Date().toISOString() },
      });
      setNotes(prev => [{ id: res.id, body: newNoteBody, createdAt: new Date().toISOString() }, ...prev]);
      setNewNoteBody('');
      setAddingNote(false);
    } finally { setSaving(false); }
  };

  // ── Save task ───────────────────────────────────────────────────────────────
  const saveTask = async () => {
    if (!editingTask) return;
    setSaving(true);
    try {
      await call(`/crm/v3/objects/tasks/${editingTask.id}`, 'PATCH', {
        properties: {
          hs_task_subject: editingTask.subject,
          hs_task_status: editingTask.status,
          hs_task_priority: editingTask.priority,
          hs_timestamp: editingTask.dueDate,
          hs_task_body: editingTask.notes,
        },
      });
      setTasks(prev => prev.map(t => t.id === editingTask.id ? editingTask : t));
      setEditingTask(null);
    } finally { setSaving(false); }
  };

  // ── Create task ─────────────────────────────────────────────────────────────
  const createTask = async () => {
    if (!newTask.subject.trim()) return;
    setSaving(true);
    try {
      const res = await call<HubSpotRecord>('/crm/v3/objects/tasks', 'POST', {
        properties: {
          hs_task_subject: newTask.subject,
          hs_task_status: 'NOT_STARTED',
          hs_task_priority: newTask.priority,
          hs_timestamp: newTask.dueDate || new Date().toISOString(),
          hs_task_body: newTask.notes,
        },
      });
      setTasks(prev => [{ id: res.id, ...newTask, status: 'NOT_STARTED' }, ...prev]);
      setNewTask({ subject: '', dueDate: '', priority: 'MEDIUM', notes: '' });
      setAddingTask(false);
    } finally { setSaving(false); }
  };

  // ── Not connected ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', fontFamily: FONT, color: '#9CA3AF' }}>
        Checking HubSpot connection…
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div style={{ maxWidth: 540, margin: '64px auto', padding: '0 24px', fontFamily: FONT }}>
        <div style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: '40px 36px', textAlign: 'center' }}>
          {/* HubSpot logo-ish icon */}
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(255,122,0,0.08)', border: '0.5px solid rgba(255,122,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" fill="#FF7A00"/>
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="#FF7A00" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#252F3E', marginBottom: 8 }}>Connect HubSpot</div>
          <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 28, lineHeight: 1.6 }}>
            Connect your HubSpot account to view and edit deals, contacts, notes, and tasks directly from QBR Studio.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', marginBottom: 28 }}>
            {[
              { icon: '📋', text: 'View & edit deals and pipeline stage' },
              { icon: '👤', text: 'Update contact info and job titles' },
              { icon: '📝', text: 'Create and edit CRM notes' },
              { icon: '✅', text: 'Manage follow-up tasks from QBR actions' },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 16 }}>{icon}</span>
                <span style={{ fontSize: 13, color: '#374151' }}>{text}</span>
              </div>
            ))}
          </div>
          <button
            onClick={connect}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
              background: '#FF7A00', color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', fontFamily: FONT, transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
          >
            Connect with HubSpot
          </button>
        </div>
      </div>
    );
  }

  // ── Connected ────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'deals',    label: 'Deals',    count: deals.length },
    { key: 'contacts', label: 'Contacts', count: contacts.length },
    { key: 'notes',    label: 'Notes',    count: notes.length },
    { key: 'tasks',    label: 'Tasks',    count: tasks.length },
  ] as const;

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1000, margin: '0 auto', fontFamily: FONT }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#252F3E', margin: 0 }}>HubSpot CRM</h1>
          <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 3 }}>
            Connected to{' '}
            <span style={{ fontWeight: 600, color: '#374151' }}>
              {status.hubDomain || `Hub ID ${status.hubId}`}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={fetchData} disabled={dataLoading} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', fontFamily: FONT }}>
            {dataLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={disconnect} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8, border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#EF4444', cursor: 'pointer', fontFamily: FONT }}>
            Disconnect
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #E5E7EB', marginBottom: 20, gap: 2 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 18px', background: 'none', border: 'none', cursor: 'pointer',
              fontFamily: FONT, fontSize: 13, fontWeight: activeTab === tab.key ? 700 : 400,
              color: activeTab === tab.key ? '#252F3E' : '#6B7280',
              borderBottom: activeTab === tab.key ? '2px solid #FF7A00' : '2px solid transparent',
              marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: activeTab === tab.key ? '#FFF7ED' : '#F3F4F6', color: activeTab === tab.key ? '#C2410C' : '#9CA3AF' }}>
              {tab.count}
            </span>
          </button>
        ))}
        {/* Search */}
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search…"
            style={{ paddingLeft: 30, paddingRight: 10, paddingTop: 7, paddingBottom: 7, fontSize: 12, borderRadius: 8, border: '1px solid #E5E7EB', background: '#FAFAFA', color: '#252F3E', outline: 'none', fontFamily: FONT, width: 180 }}
          />
        </div>
      </div>

      {/* ── Deals tab ── */}
      {activeTab === 'deals' && (
        <div>
          {dataLoading ? <Spinner /> : deals.length === 0 ? <Empty label="No deals found" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {deals.filter(d => !searchQuery || d.name.toLowerCase().includes(searchQuery.toLowerCase())).map(deal => (
                <div key={deal.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#252F3E', marginBottom: 4 }}>{deal.name || 'Untitled Deal'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <StageChip stage={deal.stage} />
                      {deal.amount && <span style={{ fontSize: 12, fontWeight: 600, color: '#059669' }}>{currency(deal.amount)}</span>}
                      {deal.closeDate && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Closes {fmt(deal.closeDate)}</span>}
                    </div>
                  </div>
                  <button onClick={() => setEditingDeal({ ...deal })} style={EDIT_BTN}>Edit</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Contacts tab ── */}
      {activeTab === 'contacts' && (
        <div>
          {dataLoading ? <Spinner /> : contacts.length === 0 ? <Empty label="No contacts found" /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {contacts.filter(c => !searchQuery || `${c.firstName} ${c.lastName} ${c.email}`.toLowerCase().includes(searchQuery.toLowerCase())).map(c => (
                <div key={c.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#4472E8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {(c.firstName?.[0] ?? c.email?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#252F3E' }}>{`${c.firstName} ${c.lastName}`.trim() || '—'}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                    </div>
                  </div>
                  {c.jobTitle && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>{c.jobTitle}</div>}
                  {c.phone    && <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>{c.phone}</div>}
                  <button onClick={() => setEditingContact({ ...c })} style={EDIT_BTN}>Edit</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Notes tab ── */}
      {activeTab === 'notes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setAddingNote(true)} style={ADD_BTN}>+ Add Note</button>
          </div>
          {addingNote && (
            <div style={{ background: '#fff', border: '1px solid #FDE68A', borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <textarea
                value={newNoteBody}
                onChange={e => setNewNoteBody(e.target.value)}
                placeholder="Write your note…"
                rows={4}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, fontFamily: FONT, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button onClick={createNote} disabled={saving} style={SAVE_BTN}>{saving ? 'Saving…' : 'Save Note'}</button>
                <button onClick={() => { setAddingNote(false); setNewNoteBody(''); }} style={CANCEL_BTN}>Cancel</button>
              </div>
            </div>
          )}
          {dataLoading ? <Spinner /> : notes.length === 0 ? <Empty label="No notes found" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.filter(n => !searchQuery || n.body.toLowerCase().includes(searchQuery.toLowerCase())).map(note => (
                <div key={note.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{note.body || '—'}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 6 }}>{fmt(note.createdAt)}</div>
                    </div>
                    <button onClick={() => setEditingNote({ ...note })} style={EDIT_BTN}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tasks tab ── */}
      {activeTab === 'tasks' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => setAddingTask(true)} style={ADD_BTN}>+ Add Task</button>
          </div>
          {addingTask && (
            <div style={{ background: '#fff', border: '1px solid #FDE68A', borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel>Subject</FieldLabel>
                  <input value={newTask.subject} onChange={e => setNewTask(t => ({ ...t, subject: e.target.value }))} placeholder="Task subject" style={FIELD_INPUT} />
                </div>
                <div>
                  <FieldLabel>Due Date</FieldLabel>
                  <input type="date" value={newTask.dueDate} onChange={e => setNewTask(t => ({ ...t, dueDate: e.target.value }))} style={FIELD_INPUT} />
                </div>
                <div>
                  <FieldLabel>Priority</FieldLabel>
                  <select value={newTask.priority} onChange={e => setNewTask(t => ({ ...t, priority: e.target.value }))} style={FIELD_INPUT}>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <FieldLabel>Notes</FieldLabel>
                  <textarea value={newTask.notes} onChange={e => setNewTask(t => ({ ...t, notes: e.target.value }))} rows={2} style={{ ...FIELD_INPUT, resize: 'vertical' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={createTask} disabled={saving} style={SAVE_BTN}>{saving ? 'Saving…' : 'Create Task'}</button>
                <button onClick={() => { setAddingTask(false); setNewTask({ subject: '', dueDate: '', priority: 'MEDIUM', notes: '' }); }} style={CANCEL_BTN}>Cancel</button>
              </div>
            </div>
          )}
          {dataLoading ? <Spinner /> : tasks.length === 0 ? <Empty label="No tasks found" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tasks.filter(t => !searchQuery || t.subject.toLowerCase().includes(searchQuery.toLowerCase())).map(task => (
                <div key={task.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#252F3E', marginBottom: 4 }}>{task.subject || '—'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <TaskStatusChip status={task.status} />
                      <PriorityChip priority={task.priority} />
                      {task.dueDate && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Due {fmt(task.dueDate)}</span>}
                    </div>
                    {task.notes && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 6 }}>{task.notes}</div>}
                  </div>
                  <button onClick={() => setEditingTask({ ...task })} style={EDIT_BTN}>Edit</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Edit modals ──────────────────────────────────────────────────────── */}
      {editingDeal && (
        <EditModal title="Edit Deal" onSave={saveDeal} onClose={() => setEditingDeal(null)} saving={saving}>
          <FieldLabel>Deal Name</FieldLabel>
          <input value={editingDeal.name} onChange={e => setEditingDeal(d => d && ({ ...d, name: e.target.value }))} style={FIELD_INPUT} />
          <FieldLabel>Stage</FieldLabel>
          <select value={editingDeal.stage} onChange={e => setEditingDeal(d => d && ({ ...d, stage: e.target.value }))} style={FIELD_INPUT}>
            {['appointmentscheduled','qualifiedtobuy','presentationscheduled','decisionmakerboughtin','contractsent','closedwon','closedlost'].map(s => (
              <option key={s} value={s}>{s.replace(/([A-Z])/g, ' $1').trim()}</option>
            ))}
          </select>
          <FieldLabel>Amount (USD)</FieldLabel>
          <input type="number" value={editingDeal.amount} onChange={e => setEditingDeal(d => d && ({ ...d, amount: e.target.value }))} style={FIELD_INPUT} />
          <FieldLabel>Close Date</FieldLabel>
          <input type="date" value={editingDeal.closeDate?.slice(0, 10) ?? ''} onChange={e => setEditingDeal(d => d && ({ ...d, closeDate: e.target.value }))} style={FIELD_INPUT} />
        </EditModal>
      )}

      {editingContact && (
        <EditModal title="Edit Contact" onSave={saveContact} onClose={() => setEditingContact(null)} saving={saving}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div><FieldLabel>First Name</FieldLabel><input value={editingContact.firstName} onChange={e => setEditingContact(c => c && ({ ...c, firstName: e.target.value }))} style={FIELD_INPUT} /></div>
            <div><FieldLabel>Last Name</FieldLabel><input value={editingContact.lastName} onChange={e => setEditingContact(c => c && ({ ...c, lastName: e.target.value }))} style={FIELD_INPUT} /></div>
          </div>
          <FieldLabel>Job Title</FieldLabel>
          <input value={editingContact.jobTitle} onChange={e => setEditingContact(c => c && ({ ...c, jobTitle: e.target.value }))} style={FIELD_INPUT} />
          <FieldLabel>Phone</FieldLabel>
          <input value={editingContact.phone} onChange={e => setEditingContact(c => c && ({ ...c, phone: e.target.value }))} style={FIELD_INPUT} />
        </EditModal>
      )}

      {editingNote && (
        <EditModal title="Edit Note" onSave={saveNote} onClose={() => setEditingNote(null)} saving={saving}>
          <FieldLabel>Note Body</FieldLabel>
          <textarea value={editingNote.body} onChange={e => setEditingNote(n => n && ({ ...n, body: e.target.value }))} rows={6} style={{ ...FIELD_INPUT, resize: 'vertical' }} />
        </EditModal>
      )}

      {editingTask && (
        <EditModal title="Edit Task" onSave={saveTask} onClose={() => setEditingTask(null)} saving={saving}>
          <FieldLabel>Subject</FieldLabel>
          <input value={editingTask.subject} onChange={e => setEditingTask(t => t && ({ ...t, subject: e.target.value }))} style={FIELD_INPUT} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <FieldLabel>Status</FieldLabel>
              <select value={editingTask.status} onChange={e => setEditingTask(t => t && ({ ...t, status: e.target.value }))} style={FIELD_INPUT}>
                {['NOT_STARTED','IN_PROGRESS','WAITING','COMPLETED','DEFERRED'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <select value={editingTask.priority} onChange={e => setEditingTask(t => t && ({ ...t, priority: e.target.value }))} style={FIELD_INPUT}>
                {['LOW','MEDIUM','HIGH'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <FieldLabel>Due Date</FieldLabel>
          <input type="date" value={editingTask.dueDate?.slice(0, 10) ?? ''} onChange={e => setEditingTask(t => t && ({ ...t, dueDate: e.target.value }))} style={FIELD_INPUT} />
          <FieldLabel>Notes</FieldLabel>
          <textarea value={editingTask.notes} onChange={e => setEditingTask(t => t && ({ ...t, notes: e.target.value }))} rows={3} style={{ ...FIELD_INPUT, resize: 'vertical' }} />
        </EditModal>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Spinner() {
  return <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>Loading…</div>;
}

function Empty({ label }: { label: string }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF', fontSize: 13 }}>
      <div style={{ marginBottom: 6 }}>—</div>
      {label}
    </div>
  );
}

function TaskStatusChip({ status }: { status: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    NOT_STARTED: { bg: '#F3F4F6', color: '#6B7280' },
    IN_PROGRESS: { bg: '#EFF6FF', color: '#1D4ED8' },
    WAITING:     { bg: '#FFFBEB', color: '#92400E' },
    COMPLETED:   { bg: '#F0FDF4', color: '#166534' },
    DEFERRED:    { bg: '#FEF2F2', color: '#991B1B' },
  };
  const c = colors[status] ?? { bg: '#F3F4F6', color: '#6B7280' };
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{status.replace(/_/g, ' ')}</span>;
}

function PriorityChip({ priority }: { priority: string }) {
  const map = { HIGH: '#EF4444', MEDIUM: '#F59E0B', LOW: '#9CA3AF' };
  const color = map[priority as keyof typeof map] ?? '#9CA3AF';
  return <span style={{ fontSize: 10, fontWeight: 700, color }}>{priority}</span>;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '10px 0 4px', fontFamily: "'Metropolis', sans-serif" }}>{children}</div>;
}

function EditModal({ title, children, onSave, onClose, saving }: {
  title: string; children: React.ReactNode;
  onSave: () => void; onClose: () => void; saving: boolean;
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 8000, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 480, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.18)', fontFamily: "'Metropolis', sans-serif" }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#252F3E' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>
        <div style={{ padding: '16px 22px 6px' }}>{children}</div>
        <div style={{ padding: '12px 22px 20px', display: 'flex', gap: 8 }}>
          <button onClick={onSave} disabled={saving} style={SAVE_BTN}>{saving ? 'Saving…' : 'Save Changes'}</button>
          <button onClick={onClose} style={CANCEL_BTN}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const EDIT_BTN: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 7,
  border: '1px solid #E5E7EB', background: '#fff', color: '#374151',
  cursor: 'pointer', flexShrink: 0, fontFamily: "'Metropolis', sans-serif",
};

const SAVE_BTN: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 9,
  border: 'none', background: '#252F3E', color: '#fff',
  cursor: 'pointer', fontFamily: "'Metropolis', sans-serif",
};

const CANCEL_BTN: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, padding: '9px 16px', borderRadius: 9,
  border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280',
  cursor: 'pointer', fontFamily: "'Metropolis', sans-serif",
};

const ADD_BTN: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, padding: '7px 14px', borderRadius: 8,
  border: '1px solid #FF7A00', background: '#FFF7ED', color: '#C2410C',
  cursor: 'pointer', fontFamily: "'Metropolis', sans-serif",
};

const FIELD_INPUT: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 7, fontSize: 13,
  border: '1.5px solid #E5E7EB', background: '#FAFAFA', color: '#252F3E',
  outline: 'none', boxSizing: 'border-box', fontFamily: "'Metropolis', sans-serif",
};
