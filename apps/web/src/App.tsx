// Application root (TASK-006): runtime context + routes `/` and NotFound (ARCHITECTURE §7).
import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppErrorFallback } from './AppErrorFallback';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RuntimeContext, getDefaultRuntime, type AppRuntime } from './lib/runtime';
import { NotFoundPage } from './pages/NotFoundPage';
import { OfficePage } from './pages/OfficePage';

export default function App({ runtime }: { runtime?: AppRuntime }) {
  // One runtime per page; tests inject their own (fake socket, mocked API).
  const [instance] = useState(() => runtime ?? getDefaultRuntime());
  useEffect(() => {
    instance.start();
  }, [instance]);
  return (
    <RuntimeContext.Provider value={instance}>
      <ErrorBoundary fallback={(props) => <AppErrorFallback {...props} />}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<OfficePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </RuntimeContext.Provider>
  );
}
