import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Overview from './pages/Overview';
import MentionDetail from './pages/MentionDetail';
import SyncStatus from './pages/SyncStatus';
import BrandGroup from './pages/BrandGroup';

export default function App() {
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-6 md:p-8 overflow-x-hidden">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/mentions/:id" element={<MentionDetail />} />
            <Route path="/sync" element={<SyncStatus />} />
            <Route path="/brands/:tab" element={<BrandGroup />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
