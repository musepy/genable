/**
 * @file geminiLogger.ts
 * @description Structured logging system for Gemini Provider.
 */

import { GEMINI_CONFIG, LogLevel } from '../../config';

/**
 * Structured logger to provide unified log format and level control.
 */
export class GeminiLogger {
  private static readonly PREFIX = '[Gemini]';

  private static log(level: LogLevel, message: string, ...args: any[]): void {
    if (level < GEMINI_CONFIG.LOG_LEVEL) return;

    const timestamp = new Date().toISOString();
    const levelLabel = LogLevel[level];
    const logPrefix = `${this.PREFIX} [${levelLabel}] [${timestamp}]`;

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logPrefix, message, ...args);
        break;
      case LogLevel.INFO:
        console.log(logPrefix, message, ...args);
        break;
      case LogLevel.WARN:
        console.warn(logPrefix, message, ...args);
        break;
      case LogLevel.ERROR:
        console.error(logPrefix, message, ...args);
        break;
    }
  }

  static debug(message: string, ...args: any[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }

  static info(message: string, ...args: any[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }

  static warn(message: string, ...args: any[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }

  static error(message: string, ...args: any[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }
}
