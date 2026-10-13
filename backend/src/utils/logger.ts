import pino from 'pino'
import { isDevelopment } from '@/config/env'

const logger = pino({
  level: isDevelopment ? 'debug' : 'info',
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
  ],
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
})

export default logger
