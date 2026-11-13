import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lib/theme';
import { supabaseConfigMissing } from './lib/supabase';
import { initSentry } from './lib/sentry';
import { SentryErrorBoundary } from './components/SentryErrorBoundary';
import { PWAUpdateBanner } from './components/PWAUpdateBanner';
import { currentDict } from './i18n';

// Установленное приложение супервайзера запускается с /sv.html (там свой манифест и иконка);
// дальше работаем по обычному маршруту /sv.
if (window.location.pathname === '/sv.html') {
  window.history.replaceState(null, '', `/sv${window.location.search}${window.location.hash}`);
}

initSentry();

const d = currentDict();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {supabaseConfigMissing ? (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif', fontSize: '1.125rem', color: '#1e293b' }}>
        {d.supabaseConfigMissing}
      </div>
    ) : (
      <SentryErrorBoundary>
        <App />
        <PWAUpdateBanner />
      </SentryErrorBoundary>
    )}
  </StrictMode>
);
