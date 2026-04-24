import { useState } from 'react';
import shipheroIsoUrl from '../assets/logos/shiphero-iso.png';
import type { AppUser } from '../App';

interface LoginProps {
  onLogin: (token: string, user: AppUser) => void;
}

type Mode = 'signin' | 'register';

function ShipHeroLogo({ size = 56 }: { size?: number }) {
  return (
    <img src={shipheroIsoUrl} alt="ShipHero" width={size} height={size} style={{ objectFit: 'contain' }} />
  );
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  borderRadius: 10,
  border: '1.5px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.95)',
  fontSize: 14,
  color: '#1a2233',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: "'Metropolis', sans-serif",
  transition: 'border-color 0.15s',
};

export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<Mode>('signin');

  // Shared fields
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  // Register-only fields
  const [name,            setName]            = useState('');
  const [title,           setTitle]           = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState('');

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setPassword('');
    setConfirmPassword('');
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Invalid credentials'); return; }
      onLogin(data.token, data.user as AppUser);
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.toLowerCase().trim().endsWith('@shiphero.com')) {
      setError('Only @shiphero.com email addresses may register');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }

    setIsLoading(true);

    try {
      const res  = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, name: name.trim(), title: title.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Registration failed'); return; }
      onLogin(data.token, data.user as AppUser);
    } catch {
      setError('Connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1a2233 0%, #252F3E 50%, #1e3a5f 100%)' }}
    >
      {/* Grid */}
      <div className="absolute inset-0 opacity-10">
        <div
          className="w-full h-full"
          style={{
            backgroundImage: `
              linear-gradient(rgba(68,114,232,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(68,114,232,0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-10 blur-3xl" style={{ background: '#4472E8' }} />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full opacity-10 blur-3xl" style={{ background: '#EF5252' }} />

      {/* Card */}
      <div className="relative z-10 w-full max-w-md mx-4">
        <div
          className="rounded-2xl p-8 shadow-2xl"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Logo */}
          <div className="flex flex-col items-center mb-7">
            <div className="mb-4 drop-shadow-lg"><ShipHeroLogo size={64} /></div>
            <h1 className="text-3xl font-black text-white tracking-tight">ShipHero</h1>
            <p className="text-lg font-bold mt-1" style={{ color: '#EF5252' }}>Warehouse Optimizer</p>
            <p className="text-sm text-gray-400 mt-2 text-center">Intelligent shipping analytics for CSM teams</p>
          </div>

          {/* Mode toggle */}
          <div
            style={{
              display: 'flex', background: 'rgba(0,0,0,0.2)', borderRadius: 10,
              padding: 3, marginBottom: 24, border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            {(['signin', 'register'] as Mode[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 700, transition: 'all 0.15s',
                  fontFamily: "'Metropolis', sans-serif",
                  background: mode === m ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: mode === m ? '#fff' : 'rgba(255,255,255,0.45)',
                  boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
                }}
              >
                {m === 'signin' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={mode === 'signin' ? handleSignIn : handleRegister}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Email */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@shiphero.com"
                  required
                  autoFocus
                  style={INPUT}
                />
              </div>

              {/* Register: Name */}
              {mode === 'register' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Alex Johnson"
                    required
                    style={INPUT}
                  />
                </div>
              )}

              {/* Register: Title */}
              {mode === 'register' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Title{' '}
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>
                      (optional)
                    </span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Customer Success Manager"
                    style={INPUT}
                  />
                </div>
              )}

              {/* Password */}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  Password
                  {mode === 'register' && (
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, opacity: 0.6 }}>
                      {' '}(min. 8 characters)
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={mode === 'register' ? 8 : undefined}
                  style={INPUT}
                />
              </div>

              {/* Register: Confirm password */}
              {mode === 'register' && (
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={INPUT}
                  />
                </div>
              )}

              {/* Error */}
              {error && (
                <div
                  style={{
                    padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
                    background: 'rgba(224,82,82,0.15)', color: '#fca5a5',
                    border: '1px solid rgba(224,82,82,0.3)',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isLoading}
                style={{
                  width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #EF5252 0%, #d43434 100%)',
                  color: '#fff', fontSize: 14, fontWeight: 800,
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 20px rgba(239,82,82,0.4)',
                  transition: 'opacity 0.15s',
                  fontFamily: "'Metropolis', sans-serif",
                  opacity: isLoading ? 0.7 : 1,
                  marginTop: 4,
                }}
              >
                {isLoading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <svg className="animate-spin" style={{ width: 18, height: 18 }} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {mode === 'signin' ? 'Signing In…' : 'Creating Account…'}
                  </span>
                ) : (
                  mode === 'signin' ? 'Sign In' : 'Create Account'
                )}
              </button>
            </div>
          </form>

          {mode === 'register' && (
            <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 18, lineHeight: 1.6 }}>
              Access is restricted to{' '}
              <strong style={{ color: 'rgba(255,255,255,0.5)' }}>@shiphero.com</strong>{' '}
              email addresses.
            </p>
          )}
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 20 }}>
          © {new Date().getFullYear()} ShipHero, Inc. All rights reserved.
        </p>
      </div>
    </div>
  );
}
