import { useState, useEffect } from 'react';
import { DataProvider } from './context/DataContext';
import { PDFProvider } from './context/PDFContext';
import { AuditProvider } from './context/AuditContext';
import { DeckProvider } from './context/DeckContext';
import Layout from './components/Layout';
import Login from './components/Login';

export interface AppUser {
  email: string;
  name: string;
  title: string;
  photo: string | null;
}

const TOKEN_KEY = 'sh_auth_token';

function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Verify stored token on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setAuthChecked(true);
      return;
    }

    fetch('/api/auth/verify', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then((d: { valid: boolean; user?: AppUser }) => {
        if (d.valid && d.user) {
          setUser(d.user);
        } else {
          localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setAuthChecked(true));
  }, []);

  const handleLogin = (token: string, loggedInUser: AppUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1a2233 0%, #252F3E 50%, #1e3a5f 100%)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <svg
            className="animate-spin"
            style={{ width: 32, height: 32, color: '#4472E8' }}
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <AuditProvider>
      <DataProvider>
        <PDFProvider>
          <DeckProvider>
            <Layout user={user} onLogout={handleLogout} onProfileUpdate={setUser} />
          </DeckProvider>
        </PDFProvider>
      </DataProvider>
    </AuditProvider>
  );
}

export default App;
