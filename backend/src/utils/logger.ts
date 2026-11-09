import pino, { type DestinationStream, type LoggerOptions } from 'pino'
import { isDevelopment } from '@/config/env'
import { serializeLogError } from '@/observability/redaction'

const levels = new Set(['debug', 'info', 'warn', 'error'])

function logLevel(): string {
  const configured = process.env.LOG_LEVEL?.trim()
  if (configured && levels.has(configured)) return configured
  return isDevelopment ? 'debug' : 'info'
}

const options: LoggerOptions = {
  level: logLevel(),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
      'password',
      'token',
      'secret',
      'apiKey',
      'authorization',
      'cookie',
      'email',
      'invitationToken',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.apiKey',
      '*.secret',
      '*.authorization',
      '*.cookie',
      '*.email',
      '*.invitationToken',
      '*.session',
      '*.dsn',
    ],
    censor: '[redacted]',
  },
  serializers: {
    err: serializeLogError,
  },
  formatters: {
    level(label) {
      return { level: label }
    },
  },
}

export function createApplicationLogger(destination?: DestinationStream) {
  if (destination) return pino(options, destination)
  return pino({
    ...options,
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
}

const logger = createApplicationLogger()

export default logger
