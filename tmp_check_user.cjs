const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, username: true, role: true, status: true } });
    console.log('USER_COUNT=' + users.length);
    console.log(JSON.stringify(users, null, 2));
  } catch (e) {
    console.log('ERR=' + (e?.message || e));
  } finally {
    await prisma.$disconnect();
  }
})();
