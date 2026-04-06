import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { useAlertEngine } from '../../hooks/useAlertEngine';

export function AppShell() {
  // Run alert engine — evaluates rules each polling cycle
  useAlertEngine();

  return (
    <div className="flex flex-col min-h-screen bg-dark-900">
      <Header />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
