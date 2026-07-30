import { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Tag, Dropdown } from 'antd';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  DashboardOutlined,
  PictureOutlined,
  CustomerServiceOutlined,
  VideoCameraOutlined,
  TeamOutlined,
  SoundOutlined,
  FileTextOutlined,
  HistoryOutlined,
  UserOutlined,
  KeyOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { api, User as UserType } from '../api/client';

const { Sider, Header, Content } = Layout;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/gen/image', icon: <PictureOutlined />, label: '图片生成' },
  { key: '/gen/digital-human', icon: <CustomerServiceOutlined />, label: '数字人对口型' },
  { key: '/gen/video', icon: <VideoCameraOutlined />, label: '视频生成' },
  { key: '/libraries/characters', icon: <TeamOutlined />, label: '形象库' },
  { key: '/libraries/songs', icon: <SoundOutlined />, label: '歌曲库' },
  { key: '/libraries/prompts', icon: <FileTextOutlined />, label: '提示词库' },
  { key: '/tasks', icon: <HistoryOutlined />, label: '任务管理' },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me').then((r) => setUser(r.data.data)).catch(() => {
      window.location.href = '/login';
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  const selectedKey = '/' + (location.pathname.split('/')[1] || 'dashboard');

  const onLogout = async () => {
    await api.post('/auth/logout');
    window.location.href = '/login';
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" breakpoint="lg" collapsedWidth={0}>
        <div style={{ color: '#fff', padding: 16, fontWeight: 700, fontSize: 16 }}>
          AI 生成面板
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={(e) => navigate(e.key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {user && (
            <>
              <Avatar icon={<UserOutlined />} />
              <span>{user.username}</span>
              <Tag color={user.role === 'super_admin' ? 'gold' : 'blue'}>{user.role}</Tag>
              <Tag>{user.networkScope === 'broad' ? 'broad' : 'restricted'}</Tag>
            </>
          )}
          <Dropdown menu={{ items: [
            { key: 'api', icon: <KeyOutlined />, label: '我的密钥', onClick: () => navigate('/api-keys') },
            { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: onLogout },
          ] }}>
            <a onClick={(e) => e.preventDefault()}>更多 ▾</a>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
