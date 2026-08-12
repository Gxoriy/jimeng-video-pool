INSERT INTO jimeng_accounts (id, label, sessionid, cookie_enc, status, source, created_at, updated_at)
VALUES ('test-0001', '测试号', 'sess-xxx', 'enc-xxx', 'active', 'local', now(), now())
ON CONFLICT (id) DO NOTHING;
