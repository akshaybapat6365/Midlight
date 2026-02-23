import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { useVault } from '@ext/shared/hooks/useVault';

import { ApprovalPage } from './pages/ApprovalPage';
import { BalancePage } from './pages/BalancePage';
import { CreateWalletPage } from './pages/CreateWalletPage';
import { ImportWalletPage } from './pages/ImportWalletPage';
import { ReceivePage } from './pages/ReceivePage';
import { SendPage } from './pages/SendPage';
import { SettingsPage } from './pages/SettingsPage';
import { SigningPage } from './pages/SigningPage';
import { UnlockPage } from './pages/UnlockPage';
import { WelcomePage } from './pages/WelcomePage';

const PopupShell = ({ children }: { children: ReactNode }) => {
  const { status } = useVault();
  const navItems = useMemo(
    () =>
      status?.unlocked
        ? [
            { to: '/balance', label: 'Balance' },
            { to: '/send', label: 'Send' },
            { to: '/receive', label: 'Receive' },
            { to: '/settings', label: 'Settings' },
          ]
        : [],
    [status?.unlocked],
  );

  return (
    <div className="dw-app" style={{ width: 400, minHeight: 600 }}>
      <header className="dw-header">
        <div className="dw-brand-kicker">DarkWallet Extension</div>
        <div className="dw-brand-title">Privacy Wallet</div>
        <div className="dw-brand-sub">Cardano L1 + Midnight L2</div>
      </header>

      {navItems.length ? (
        <nav className="dw-nav" aria-label="Popup">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <main className="dw-main">{children}</main>
      <footer className="dw-footer">DarkWallet extension v0.2.0 • self-custody mode</footer>
    </div>
  );
};

const RootRoute = () => {
  const { status, loading } = useVault();

  if (loading || !status) {
    return <div className="dw-badge warn">Loading wallet status...</div>;
  }

  if (!status.exists) return <Navigate to="/welcome" replace />;
  if (!status.unlocked) return <Navigate to="/unlock" replace />;
  return <Navigate to="/balance" replace />;
};

const App = () => (
  <HashRouter>
    <PopupShell>
      <Routes>
        <Route path="/" element={<RootRoute />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/create" element={<CreateWalletPage />} />
        <Route path="/import" element={<ImportWalletPage />} />
        <Route path="/unlock" element={<UnlockPage />} />
        <Route path="/balance" element={<BalancePage />} />
        <Route path="/send" element={<SendPage />} />
        <Route path="/receive" element={<ReceivePage />} />
        <Route path="/approval" element={<ApprovalPage />} />
        <Route path="/sign" element={<SigningPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </PopupShell>
  </HashRouter>
);

export default App;
