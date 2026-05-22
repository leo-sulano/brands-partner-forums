import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import ProtectedRoute from './components/ProtectedRoute';

const Login       = lazy(() => import('./pages/Login'));
const Signup      = lazy(() => import('./pages/Signup'));
const Overview    = lazy(() => import('./pages/Overview'));
const MentionDetail = lazy(() => import('./pages/MentionDetail'));
const SyncStatus  = lazy(() => import('./pages/SyncStatus'));
const BrandGroup  = lazy(() => import('./pages/BrandGroup'));
const AdminUsers  = lazy(() => import('./pages/AdminUsers'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));

function PageFallback() {
  return (
    <div className="flex-1 p-6 md:p-8 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}

function AppLayout() {
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Suspense fallback={null}><Login /></Suspense>} />
        <Route path="/signup" element={<Suspense fallback={null}><Signup /></Suspense>} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/mentions/:id" element={<MentionDetail />} />
          <Route path="/brands/:tab" element={<BrandGroup />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/sync" element={<SyncStatus />} />
            <Route path="/log" element={<ActivityLog />} />
            <Route path="/admin/users" element={<AdminUsers />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
