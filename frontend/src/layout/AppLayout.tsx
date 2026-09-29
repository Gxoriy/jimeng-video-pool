import { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Dropdown } from 'antd';
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
    CloudServerOutlined,
    SettingOutlined,
    ThunderboltOutlined,
    SafetyCertificateOutlined,
    FolderOpenOutlined,
} from '@ant-design/icons';
import { api, User as UserType } from '../api/client';
import gxzpmLogo from '../assets/gxzpm-logo.png';
import { TaskSessionProvider, clearWorkspaceStorage } from '../context/TaskSession';
import { FeaturesProvider, useFeatures } from '../context/Features';

const { Sider, Header, Content } = Layout;

const baseMenuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
    { key: '/video-workspace', icon: <VideoCameraOutlined />, label: '视频工作区' },
    { key: '/libraries/characters', icon: <TeamOutlined />, label: '形象库' },
    { key: '/libraries/songs', icon: <SoundOutlined />, label: '歌曲库' },
    { key: '/libraries/prompts', icon: <FileTextOutlined />, label: '提示词库' },
    { key: '/tasks', icon: <HistoryOutlined />, label: '任务管理' },
    { key: '/task-logs', icon: <HistoryOutlined />, label: '任务日志' },
    { key: '/jimeng-gen', icon: <ThunderboltOutlined />, label: '即梦生成' },
];

/** 真正渲染菜单/布局的壳；必须在 FeaturesProvider 内以读取 hideJimeng 开关 */
function AppShell({ user }: { user: UserType }) {
    const navigate = useNavigate();
    const location = useLocation();
    const { hideJimeng } = useFeatures();

    const isAdmin = user?.role === 'super_admin';
    let menuItems = [...baseMenuItems];
    // 管理员关闭即梦功能时，对所有用户隐藏即梦生成菜单
    if (hideJimeng) {
        menuItems = menuItems.filter((it) => it.key !== '/jimeng-gen');
    }

    const selectedKey = '/' + (location.pathname.split('/')[1] || 'dashboard');

    const onLogout = async () => {
        await api.post('/auth/logout');
        clearWorkspaceStorage();
        window.location.hash = '#/login';
    };

    return (
        <Layout style={{ minHeight: '100vh' }}>
            <Sider theme="dark" breakpoint="lg" collapsedWidth={0} style={{ display: 'flex', flexDirection: 'column' }}>
                <div
                    style={{
                        background: '#fff',
                        padding: '10px 16px',
                        textAlign: 'center',
                        borderBottom: '1px solid #f0f0f0',
                    }}
                >
                    <img src={gxzpmLogo} alt="GxzPm" style={{ maxWidth: '100%', height: 32, objectFit: 'contain' }} />
                </div>
                <Menu
                    theme="dark"
                    mode="inline"
                    selectedKeys={[selectedKey]}
                    items={menuItems}
                    onClick={(e) => navigate(e.key)}
                    style={{ flex: 1, overflowY: 'auto' }}
                />
                {user && (
                    <Dropdown
                        trigger={['click']}
                        placement="topRight"
                        menu={{ items: [
                                { key: 'settings', icon: <KeyOutlined />, label: '个人设置', onClick: () => navigate('/settings') },
                                ...(isAdmin ? [
                                    { key: 'users', icon: <UserOutlined />, label: '用户管理', onClick: () => navigate('/users') },
                                    { key: 'channels', icon: <CloudServerOutlined />, label: 'AI 渠道配置', onClick: () => navigate('/ai-channels') },
                                    ...(!hideJimeng ? [
                                        { key: 'jimeng-accounts', icon: <SafetyCertificateOutlined />, label: '即梦账号池', onClick: () => navigate('/jimeng-accounts') },
                                    ] : []),
                                ] : []),
                                { type: 'divider' as const },
                                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: onLogout },
                            ] }}
                    >
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '12px 16px',
                                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                                cursor: 'pointer',
                            }}
                        >
                            <Avatar icon={<UserOutlined />} style={{ background: '#1c3d5a', flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                                <div style={{ color: '#fff', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {user.username}
                                </div>
                                <div style={{ color: '#8c8c8c', fontSize: 12 }}>
                                    {user.role === 'super_admin' ? '超级管理员' : '普通用户'} · {user.networkScope}
                                </div>
                            </div>
                            <SettingOutlined style={{ marginLeft: 'auto', color: '#8c8c8c', fontSize: 16 }} />
                        </div>
                    </Dropdown>
                )}
            </Sider>
            <Layout style={{ background: '#eae6df' }}>
                <Header style={{ background: '#1c3d5a' }} />
                <Content style={{ margin: 16 }}>
                    <TaskSessionProvider>
                        <Outlet />
                    </TaskSessionProvider>
                </Content>
            </Layout>
        </Layout>
    );
}

export default function AppLayout() {
    const [user, setUser] = useState<UserType | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/auth/me').then((r) => setUser(r.data.data)).catch(() => {
            window.location.hash = '#/login';
        }).finally(() => setLoading(false));
    }, []);

    if (loading) return null;

    return (
        <FeaturesProvider>
            <AppShell user={user!} />
        </FeaturesProvider>
    );
}
