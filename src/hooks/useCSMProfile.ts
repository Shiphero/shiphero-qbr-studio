import { useState, useCallback, useEffect } from 'react';

export interface CSMProfile {
  photo: string | null;   // base64 data URL
  name: string;
  title: string;
}

const DEFAULT_PROFILE: CSMProfile = { photo: null, name: '', title: '' };

function storageKey(email: string | undefined) {
  return `csm_profile_${(email ?? 'default').toLowerCase().trim()}`;
}

function load(email: string | undefined): CSMProfile {
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

interface ServerUser {
  name: string;
  title: string;
  photo: string | null;
}

/**
 * Manages the CSM profile in localStorage, keyed by email.
 * When `serverUser` is provided and the local profile has no name yet,
 * it seeds the profile from the server values on first login.
 * `save` also calls `PUT /api/auth/profile` to keep the server in sync.
 */
export function useCSMProfile(email: string | undefined, serverUser?: ServerUser) {
  const [profile, setProfile] = useState<CSMProfile>(() => {
    const local = load(email);
    // Seed from server if local is blank
    if (!local.name && serverUser?.name) {
      return {
        photo: serverUser.photo ?? local.photo,
        name:  serverUser.name,
        title: serverUser.title ?? local.title,
      };
    }
    return local;
  });

  // If serverUser arrives after initial render (e.g. verify response), sync
  useEffect(() => {
    if (!serverUser?.name) return;
    setProfile(prev => {
      if (prev.name) return prev; // already has a local name — don't overwrite
      return {
        photo: serverUser.photo ?? prev.photo,
        name:  serverUser.name,
        title: serverUser.title ?? prev.title,
      };
    });
  }, [serverUser?.name, serverUser?.title, serverUser?.photo]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback((updates: Partial<CSMProfile>) => {
    setProfile(prev => {
      const next = { ...prev, ...updates };

      // Persist locally
      try {
        localStorage.setItem(storageKey(email), JSON.stringify(next));
      } catch {
        // quota exceeded — skip
      }

      // Sync to server (best-effort, fire-and-forget)
      const token = localStorage.getItem('sh_auth_token');
      if (token) {
        fetch('/api/auth/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name:  next.name,
            title: next.title,
            photo: next.photo,
          }),
        }).catch(() => {/* ignore network errors */});
      }

      return next;
    });
  }, [email]);

  return { profile, save };
}
