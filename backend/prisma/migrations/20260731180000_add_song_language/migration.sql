-- 为歌曲库新增 language（语种）列，承载 AI 识别带出的语种信息
ALTER TABLE songs ADD COLUMN language TEXT;
