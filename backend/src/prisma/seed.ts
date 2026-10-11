import { prisma } from '../config/database'
import { hashPassword } from '../utils/bcrypt'
import { env } from '../config/env'

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('The demo seed is disabled in production')
  }

  console.log('Seeding database...')

  // Create demo user
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
      fullName: 'Demo User',
      passwordHash: await hashPassword('Password123!'),
      isVerified: true,
    },
  })

  console.log('Demo user created:', demoUser)
  console.log('Seeding complete')
}

main()
  .catch((e) => {
    console.error('Seeding error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
