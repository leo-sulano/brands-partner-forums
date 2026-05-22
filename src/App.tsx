import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Overview from './pages/Overview';
import MentionDetail from './pages/MentionDetail';
import SyncStatus from './pages/SyncStatus';
import BrandGroup from './pages/BrandGroup';
import AdminUsers from './pages/AdminUsers';
import ActivityLog from './pages/ActivityLog';

function AppLayout() {
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
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
