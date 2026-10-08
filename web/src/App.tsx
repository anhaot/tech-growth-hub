import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore, useAIStore } from '@/store';
import { aiApi, authApi } from '@/api';
import { Layout } from '@/components/Layout';
import { hasPermission } from '@/lib/permissions';
import {
  loadBookmarksPage,
  loadHomePage,
  loadInterviewCapturePage,
  loadLearningPage,
  loadQuestionsPage,
  loadSettingsPage,
} from '@/lib/routePreload';
const LoginPage = lazy(() => import('@/pages/Auth').then((module) => ({ default: module.LoginPage })));
const RegisterPage = lazy(() => import('@/pages/Auth').then((module) => ({ default: module.RegisterPage })));
const ChangePasswordPage = lazy(() => import('@/pages/Auth').then((module) => ({ default: module.ChangePasswordPage })));
const HomePage = lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));
const QuestionsPage = lazy(() => loadQuestionsPage().then((module) => ({ default: module.QuestionsPage })));
const LearningPage = lazy(() => loadLearningPage().then((module) => ({ default: module.LearningPage })));
const SettingsPage = lazy(() => loadSettingsPage().then((module) => ({ default: module.SettingsPage })));
const BookmarksPage = lazy(() => loadBookmarksPage().then((module) => ({ default: module.BookmarksPage })));
const InterviewCapturePage = lazy(() => loadInterviewCapturePage().then((module) => ({ default: module.InterviewCapturePage })));

const PageFallback: React.FC = () => (
  <div className="animate-pulse space-y-6" aria-label="页面内容加载中">
    <div className="h-8 w-40 rounded-lg bg-slate-200" />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-28 rounded-2xl border border-slate-100 bg-white" />
      ))}
    </div>
    <div className="h-80 rounded-2xl border border-slate-100 bg-white" />
  </div>
);

const PrivateRoute: React.FC<{ children: React.ReactNode; authReady: boolean }> = ({ children, authReady }) => {
  const { isAuthenticated, user } = useAuthStore();
  if (!authReady) {
    return null;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return user?.must_change_password
    ? <Navigate to="/change-password" replace />
    : <>{children}</>;
};

const PublicRoute: React.FC<{ children: React.ReactNode; authReady: boolean }> = ({ children, authReady }) => {
  const { isAuthenticated, user } = useAuthStore();
  if (!authReady) {
    return null;
  }
  if (!isAuthenticated) {
    return <>{children}</>;
  }
  return <Navigate to={user?.must_change_password ? '/change-password' : '/'} replace />;
};

const PasswordChangeRoute: React.FC<{ children: React.ReactNode; authReady: boolean }> = ({ children, authReady }) => {
  const { isAuthenticated, user } = useAuthStore();
  if (!authReady) {
    return null;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return user?.must_change_password ? <>{children}</> : <Navigate to="/" replace />;
};

const ProtectedLayout: React.FC<{ authReady: boolean }> = ({ authReady }) => (
  <PrivateRoute authReady={authReady}>
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </Layout>
  </PrivateRoute>
);

const AppContent: React.FC = () => {
  const { isAuthenticated, user, setAuth, logout } = useAuthStore();
  const { setStatus } = useAIStore();
  const [authReady, setAuthReady] = useState(false);
  const authBootstrapStartedRef = useRef(false);

  useEffect(() => {
    if (authBootstrapStartedRef.current) {
      return;
    }
    authBootstrapStartedRef.current = true;

    authApi.getMe()
      .then((response) => {
        setAuth(response.data);
      })
      .catch((error) => {
        if (error.response || !useAuthStore.getState().isAuthenticated) logout();
      })
      .finally(() => {
        setAuthReady(true);
      });
  }, [isAuthenticated, logout, setAuth]);

  useEffect(() => {
    if (isAuthenticated && !user?.must_change_password && hasPermission(user, 'ai_use')) {
      aiApi.getStatus().then((response) => {
        setStatus({
          enabled: response.data.enabled,
          defaultProvider: response.data.defaultProvider,
          availableProviders: response.data.availableProviders,
        });
      }).catch(console.error);
    }
  }, [isAuthenticated, user, setStatus]);

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">正在加载…</div>}>
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute authReady={authReady}>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute authReady={authReady}>
            <RegisterPage />
          </PublicRoute>
        }
      />
      <Route
        path="/change-password"
        element={
          <PasswordChangeRoute authReady={authReady}>
            <ChangePasswordPage />
          </PasswordChangeRoute>
        }
      />
      <Route element={<ProtectedLayout authReady={authReady} />}>
        <Route index element={<HomePage />} />
        <Route path="/questions" element={<QuestionsPage />} />
        <Route path="/capture" element={<InterviewCapturePage />} />
        <Route path="/study" element={<LearningPage key="study" mode="study" />} />
        <Route path="/quiz" element={<LearningPage key="quiz" mode="quiz" />} />
        <Route path="/bookmarks" element={<BookmarksPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 5000,
          style: {
            background: '#363636',
            color: '#fff',
            fontSize: '14px',
            padding: '12px 20px',
            borderRadius: '8px',
            width: 'min(92vw, 440px)',
            maxHeight: 'min(50vh, 320px)',
            overflowY: 'auto',
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
          },
          success: {
            duration: 3000,
            style: {
              background: '#22c55e',
            },
          },
          error: {
            duration: 5000,
            style: {
              background: '#ef4444',
            },
          },
        }}
      />
      <AppContent />
    </BrowserRouter>
  );
};

export default App;
