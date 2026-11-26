import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { FullPageLoader } from './components/ui';
import { useAuth } from './lib/queries';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { MyPulls } from './pages/MyPulls';
import { Account } from './pages/Account';
import { Repositories } from './pages/Repositories';
import { NotFound } from './pages/NotFound';
import { Settings } from './pages/Settings';
import { Actions } from './pages/repo/Actions';
import { Code } from './pages/repo/Code';
import { Commits } from './pages/repo/Commits';
import { Contributors } from './pages/repo/Contributors';
import { Deployments } from './pages/repo/Deployments';
import { Issues } from './pages/repo/Issues';
import { Overview } from './pages/repo/Overview';
import { Pull } from './pages/repo/Pull';
import { Pulls } from './pages/repo/Pulls';
import { Releases } from './pages/repo/Releases';
import { Stars } from './pages/repo/Stars';
import { Traffic } from './pages/repo/Traffic';

function RequireAuth() {
  const { data, isLoading } = useAuth();
  if (isLoading) return <FullPageLoader />;
  if (!data?.authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { index: true, element: <Home /> },
          { path: 'repositories', element: <Repositories /> },
          { path: 'a/:login', element: <Account /> },
          { path: 'pulls', element: <MyPulls /> },
          { path: 'settings', element: <Settings /> },
          {
            path: 'r/:owner/:repo',
            children: [
              { index: true, element: <Overview /> },
              { path: 'stars', element: <Stars /> },
              { path: 'traffic', element: <Traffic /> },
              { path: 'commits', element: <Commits /> },
              { path: 'pulls', element: <Pulls /> },
              { path: 'pull/:number', element: <Pull /> },
              { path: 'issues', element: <Issues /> },
              { path: 'contributors', element: <Contributors /> },
              { path: 'code', element: <Code /> },
              { path: 'actions', element: <Actions /> },
              { path: 'releases', element: <Releases /> },
              { path: 'deployments', element: <Deployments /> },
            ],
          },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

export const App = () => <RouterProvider router={router} />;
