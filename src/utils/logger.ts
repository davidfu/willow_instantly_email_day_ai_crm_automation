type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function timestamp(): string {
  return new Date().toISOString();
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

export const logger = {
  debug(msg: string, data?: unknown): void {
    if (shouldLog('debug')) {
      console.log(`[${timestamp()}] [DEBUG] ${msg}`, data !== undefined ? data : '');
    }
  },
  info(msg: string, data?: unknown): void {
    if (shouldLog('info')) {
      console.log(`[${timestamp()}] [INFO]  ${msg}`, data !== undefined ? data : '');
    }
  },
  warn(msg: string, data?: unknown): void {
    if (shouldLog('warn')) {
      console.warn(`[${timestamp()}] [WARN]  ${msg}`, data !== undefined ? data : '');
    }
  },
  error(msg: string, data?: unknown): void {
    if (shouldLog('error')) {
      console.error(`[${timestamp()}] [ERROR] ${msg}`, data !== undefined ? data : '');
    }
  },
};
