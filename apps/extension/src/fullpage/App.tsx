import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';

import { AttestationPage } from './pages/AttestationPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { PrescriptionPage } from './pages/PrescriptionPage';
import { ReceivePage } from './pages/ReceivePage';
import { SendPage } from './pages/SendPage';
import { SettingsPage } from './pages/SettingsPage';
import { TokensPage } from './pages/TokensPage';
import { WalletPage } from './pages/WalletPage';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/attestation', label: 'Attestation' },
  { to: '/prescriptions', label: 'Prescriptions' },
  { to: '/history', label: 'History' },
  { to: '/wallet', label: 'Wallet' },
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
  { to: '/tokens', label: 'Tokens' },
  { to: '/settings', label: 'Settings' },
];

const App = () => (
  <HashRouter>
    <div className="dw-app dw-app-shell">
      <aside className="dw-sidebar">
        <div>
          <div className="dw-brand-kicker">DarkWallet</div>
          <div className="dw-brand-title">Command Center</div>
          <div className="dw-brand-sub">Extension fullpage console</div>
        </div>

        <nav className="dw-side-nav" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="dw-main dw-main-full">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/attestation" element={<AttestationPage />} />
          <Route path="/prescriptions" element={<PrescriptionPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/send" element={<SendPage />} />
          <Route path="/receive" element={<ReceivePage />} />
          <Route path="/tokens" element={<TokensPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  </HashRouter>
);

export default App;
