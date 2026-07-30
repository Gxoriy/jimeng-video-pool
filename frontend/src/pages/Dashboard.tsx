import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, List, Typography } from 'antd';
import { api } from '../api/client';

export default function Dashboard() {
  const [providers, setProviders] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    api.get('/generation/providers').then((r) => setProviders(r.data.data));
    api.get('/tasks?pageSize=5').then((r) => setStats(r.data.data)).catch(() => {});
  }, []);

  return (
    <div>
      <Typography.Title level={3}>概览</Typography.Title>
      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="最近任务数" value={stats?.total ?? '-'} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="生成类型" value={providers.length} suffix="种" />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="共享库" value={3} suffix="个" />
          </Card>
        </Col>
      </Row>
      <Card title="可用 Provider" style={{ marginTop: 16 }}>
        <List
          dataSource={providers}
          renderItem={(p) => (
            <List.Item>
              <List.Item.Meta title={p.label} description={`Key 池：${p.keyProvider}`} />
            </List.Item>
          )}
        />
      </Card>
      <Card title="最近任务" style={{ marginTop: 16 }}>
        <List
          dataSource={stats?.data || []}
          renderItem={(t: any) => (
            <List.Item>
              <List.Item.Meta
                title={`${t.type} · ${t.status}`}
                description={t.prompt?.slice(0, 80) || '-'}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
