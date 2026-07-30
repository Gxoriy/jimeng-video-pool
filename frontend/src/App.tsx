import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ImageGen from './pages/ImageGen';
import DigitalHuman from './pages/DigitalHuman';
import VideoGen from './pages/VideoGen';
import Characters from './pages/Characters';
import Songs from './pages/Songs';
import Prompts from './pages/Prompts';
import Tasks from './pages/Tasks';
import Users from './pages/Users';
import ApiKeys from './pages/ApiKeys';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="gen/image" element={<ImageGen />} />
        <Route path="gen/digital-human" element={<DigitalHuman />} />
        <Route path="gen/video" element={<VideoGen />} />
        <Route path="libraries/characters" element={<Characters />} />
        <Route path="libraries/songs" element={<Songs />} />
        <Route path="libraries/prompts" element={<Prompts />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="users" element={<Users />} />
        <Route path="api-keys" element={<ApiKeys />} />
      </Route>
    </Routes>
  );
}
