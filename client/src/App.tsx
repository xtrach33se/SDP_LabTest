import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import AuthorsPage from './pages/AuthorsPage';
import CommitsPage from './pages/CommitsPage';
import DashboardPage from './pages/DashboardPage';
import FilesPage from './pages/FilesPage';
import NewRepositoryPage from './pages/NewRepositoryPage';
import RepositoriesPage from './pages/RepositoriesPage';
import TimelinePage from './pages/TimelinePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/repos" replace />} />
        <Route path="/repos" element={<Layout />}>
          <Route index element={<RepositoriesPage />} />
          <Route path="new" element={<NewRepositoryPage />} />
          <Route path=":repoId" element={<DashboardPage />} />
          <Route path=":repoId/files" element={<FilesPage />} />
          <Route path=":repoId/directory" element={<FilesPage />} />
          <Route path=":repoId/authors" element={<AuthorsPage />} />
          <Route path=":repoId/commits" element={<CommitsPage />} />
          <Route path=":repoId/timeline" element={<TimelinePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/repos" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
