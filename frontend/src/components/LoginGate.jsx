import { useEffect, useRef, useState } from 'react';
import { fetchAuthConfig, loginWithGoogle } from '../lib/api.js';
import { useStore } from '../store.js';

const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function loadGsiScript() {
  if (document.getElementById('gsi-script')) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = 'gsi-script';
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function LoginGate() {
  const setCurrentUser = useStore(s => s.setCurrentUser);
  const buttonRef = useRef(null);
  const [error, setError] = useState(null);
  const [configError, setConfigError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const { googleClientId } = await fetchAuthConfig().catch(() => ({ googleClientId: null }));
      if (cancelled) return;
      if (!googleClientId) {
        setConfigError('Chưa cấu hình GOOGLE_CLIENT_ID trên server — liên hệ Admin.');
        return;
      }

      await loadGsiScript().catch(() => setConfigError('Không tải được Google Sign-In.'));
      if (cancelled || !window.google?.accounts?.id) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          try {
            const user = await loginWithGoogle(response.credential);
            setCurrentUser(user);
          } catch (err) {
            setError(err.message);
          }
        },
      });
      if (buttonRef.current) {
        window.google.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large' });
      }
    }

    init();
    return () => { cancelled = true; };
  }, [setCurrentUser]);

  return (
    <div className="w-screen h-screen flex items-center justify-center bg-[var(--canvas,#f5f5f5)]">
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-sm border border-[var(--card-border,#e5e7eb)] px-10 py-12 flex flex-col items-center gap-4">
        <h1 className="text-lg font-semibold text-[var(--n800,#1f2937)]">Space Flow</h1>
        <p className="text-sm text-[var(--n500,#6b7280)] mb-2">Đăng nhập bằng tài khoản Google để tiếp tục</p>
        <div ref={buttonRef} />
        {configError && <p className="text-xs text-red-500 max-w-xs text-center">{configError}</p>}
        {error && <p className="text-xs text-red-500 max-w-xs text-center">{error}</p>}
      </div>
    </div>
  );
}
