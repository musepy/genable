/**
 * @file logger.ts
 * @description Unified logging utility with level control.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

class Logger {
  private level: LogLevel = LogLevel.INFO;
  private prefix: string = '[Genable]';

  setLevel(level: LogLevel) {
    this.level = level;
  }

  debug(message: string, ...args: any[]) {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`${this.prefix} [DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.level <= LogLevel.INFO) {
      console.log(`${this.prefix} [INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.level <= LogLevel.WARN) {
      console.warn(`${this.prefix} [WARN] ${message}`, ...args);
    }
  }

  private safeStringify(obj: any): string {
    const cache = new Set();
    try {
      const str = JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (cache.has(value)) {
            return '[Circular]';
          }
          if ('type' in value && 'id' in value && 'parent' in value) {
            return `[FigmaNode ${value.type} ${value.id}]`;
          }
          cache.add(value);
        }
        return value;
      }, 2);
      return str.length > 5000 ? str.substring(0, 5000) + '... [truncated]' : str;
    } catch (e) {
      return '[Unserializable Object]';
    }
  }

  error(message: string, ...args: any[]) {
    if (this.level <= LogLevel.ERROR) {
      const safeArgs = args.map(arg => typeof arg === 'object' ? this.safeStringify(arg) : arg);
      console.error(`${this.prefix} [ERROR] ${message}`, ...safeArgs);
    }
  }
}

export const logger = new Logger();
