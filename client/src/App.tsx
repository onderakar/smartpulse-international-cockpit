import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { ProfileProvider } from './context/ProfileContext';
import { ForecastProvider } from './context/ForecastContext';
import { AlertProvider } from './context/AlertContext';
import { MonitoringProvider } from './context/MonitoringContext';
import { LocaleProvider } from './context/LocaleContext';
import { ThemeProvider } from './context/ThemeContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { BatteryParamsPage } from './pages/BatteryParamsPage';
import { ForecastPage } from './pages/ForecastPage';
import { BatteryProgramPage } from './pages/BatteryProgramPage';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  return (
    <ErrorBoundary name="App">
      <ThemeProvider>
      <BrowserRouter>
        <LocaleProvider>
        <AuthProvider>
          <ProfileProvider>
            <MonitoringProvider>
            <ForecastProvider>
            <AlertProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppShell />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/battery-params" element={<BatteryParamsPage />} />
                  <Route path="/forecast" element={<ForecastPage />} />
                  <Route path="/battery-program" element={<BatteryProgramPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            </AlertProvider>
            </ForecastProvider>
            </MonitoringProvider>
            <Toaster
              position="top-right"
              toastOptions={{
                style: {
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  fontFamily: 'Mulish, system-ui, sans-serif',
                  fontSize: '13px',
                },
              }}
            />
          </ProfileProvider>
        </AuthProvider>
        </LocaleProvider>
      </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
