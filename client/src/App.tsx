import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import AuthorsPage from './pages/AuthorsPage';
import CommitsPage from './pages/CommitsPage';
import DashboardPage from './pages/DashboardPage';
import FilesPage from './pages/FilesPage';
import NewRepositoryPage from './pages/NewRepositoryPage';
import RepositoriesPage from './pages/RepositoriesPage';
import RepositorySettingsPage from './pages/RepositorySettingsPage';
import TimelinePage from './pages/TimelinePage';

const safe = (page: JSX.Element) => <ErrorBoundary>{page}</ErrorBoundary>;

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/repos" replace />} />
        <Route path="/repos" element={<Layout />}>
          <Route index element={safe(<RepositoriesPage />)} />
          <Route path="new" element={safe(<NewRepositoryPage />)} />
          <Route path=":repoId" element={safe(<DashboardPage />)} />
          <Route path=":repoId/files" element={safe(<FilesPage />)} />
          <Route path=":repoId/directory" element={safe(<FilesPage />)} />
          <Route path=":repoId/authors" element={safe(<AuthorsPage />)} />
          <Route path=":repoId/commits" element={safe(<CommitsPage />)} />
          <Route path=":repoId/timeline" element={safe(<TimelinePage />)} />
          <Route path=":repoId/settings" element={safe(<RepositorySettingsPage />)} />
        </Route>
        <Route path="*" element={<Navigate to="/repos" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
