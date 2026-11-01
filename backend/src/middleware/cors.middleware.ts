import cors from 'cors'
import { env } from '@/config/env'

const trustedOrigin = new URL(env.FRONTEND_URL).origin

export const corsMiddleware = cors({
  origin(origin, callback) {
    callback(null, origin === trustedOrigin ? trustedOrigin : false)
  },
  credentials: true,
})
