import { useRef, useState, useEffect } from 'react';
import type { CSMProfile } from '../hooks/useCSMProfile';

interface Props {
  profile: CSMProfile;
  userEmail: string;
  onSave: (updates: Partial<CSMProfile>) => void;
  onClose: () => void;
}

export default function CSMProfileModal({ profile, userEmail, onSave, onClose }: Props) {
  const [name,  setName]  = useState(profile.name);
  const [title, setTitle] = useState(profile.title);
  const [photo, setPhoto] = useState<string | null>(profile.photo);
  const [dragging, setDragging] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  // Sync if profile changes externally
  useEffect(() => {
    setName(profile.name);
    setTitle(profile.title);
    setPhoto(profile.photo);
  }, [profile]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handlePhotoFile(file: File) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  function handleSave() {
    onSave({ name: name.trim(), title: title.trim(), photo });
    onClose();
  }

  const initials = (name || userEmail || 'S').trim().charAt(0).toUpperCase();

  return (
    // Backdrop
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      {/* Panel */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 400, borderRadius: 16,
          background: '#fff',
          boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          fontFamily: "'Metropolis', sans-serif",
        }}
      >
        {/* Header */}
        <div style={{
          background: '#252F3E', padding: '20px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>CSM Profile</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>{userEmail}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.08)', border: '0.5px solid rgba(255,255,255,0.15)', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 16, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '28px 24px 24px' }}>

          {/* Photo upload */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28 }}>
            <div
              onClick={() => photoRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handlePhotoFile(f); }}
              style={{
                width: 96, height: 96, borderRadius: '50%',
                background: photo ? 'transparent' : '#F3F4F6',
                border: dragging ? '2px dashed #4472E8' : photo ? '3px solid #4472E8' : '2px dashed #D1D5DB',
                cursor: 'pointer', overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative', transition: 'border-color 0.15s',
                boxShadow: photo ? '0 0 0 4px rgba(68,114,232,0.12)' : 'none',
              }}
              title="Click or drag to upload photo"
            >
              {photo ? (
                <img src={photo} alt="CSM" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#4472E8', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>
                    {initials}
                  </div>
                  <span style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 600, letterSpacing: '0.04em', textAlign: 'center', lineHeight: 1.3 }}>UPLOAD<br/>PHOTO</span>
                </div>
              )}

              {/* Hover overlay */}
              {photo && (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: 0, transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = '0'; }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
              )}
            </div>
            <input ref={photoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); e.target.value = ''; }} />
            {photo && (
              <button
                onClick={() => setPhoto(null)}
                style={{ marginTop: 8, fontSize: 11, color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: "'Metropolis', sans-serif" }}
              >
                Remove photo
              </button>
            )}
            {!photo && (
              <span style={{ marginTop: 8, fontSize: 11, color: '#9CA3AF' }}>Click or drag an image</span>
            )}
          </div>

          {/* Name */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Your Name</div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Alex Johnson"
              style={INPUT}
              autoFocus
            />
          </div>

          {/* Title */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Title</div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Customer Success Manager"
              style={INPUT}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleSave}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 10, border: 'none',
                background: '#252F3E', color: '#fff',
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
                fontFamily: "'Metropolis', sans-serif",
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.88'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
            >
              Save
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px', borderRadius: 10, border: '1.5px solid #E5E7EB',
                background: '#fff', color: '#6B7280',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                fontFamily: "'Metropolis', sans-serif",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1.5px solid #E5E7EB', background: '#FAFAFA',
  fontSize: 13, color: '#252F3E', outline: 'none',
  boxSizing: 'border-box', fontFamily: "'Metropolis', sans-serif",
  transition: 'border-color 0.15s',
};
