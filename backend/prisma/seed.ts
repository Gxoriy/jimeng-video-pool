import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USER || 'admin';
  const password = process.env.SEED_ADMIN_PASS || 'admin123456';
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) {
    console.log(`管理员 ${username} 已存在，跳过`);
    return;
  }
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: 'super_admin',
      networkScope: 'broad',
    },
  });
  console.log(`已创建管理员：${username} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
