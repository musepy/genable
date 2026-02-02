/**
 * @file remoteLogger.ts
 * @description Forwards plugin console logs to the local development log server.
 */

const LOG_SERVER_URL = 'http://localhost:3456/logs';

export class RemoteLogger {
  private static isInitialized = false;
  private static originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug
  };

  /**
   * Initialize the remote logger by wrapping the standard console object.
   */
  static init(): void {
    if (this.isInitialized) return;
    
    // Check if we are in development mode (optional, but good practice)
    // For now we'll just initialize it.
    
    console.log = (...args: any[]) => {
      this.originalConsole.log(...args);
      this.sendRemote('info', args);
    };

    console.warn = (...args: any[]) => {
      this.originalConsole.warn(...args);
      this.sendRemote('warn', args);
    };

    console.error = (...args: any[]) => {
      this.originalConsole.error(...args);
      this.sendRemote('error', args);
    };

    console.debug = (...args: any[]) => {
      this.originalConsole.debug(...args);
      this.sendRemote('debug', args);
    };

    this.isInitialized = true;
    this.originalConsole.log('[RemoteLogger] 📡 Initialized and forwarding logs to localhost:3456');
  }

  private static async sendRemote(type: string, args: any[]): Promise<void> {
    try {
      // Format the message
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try { return JSON.stringify(arg); } catch (e) { return '[Circular Object]'; }
        }
        return String(arg);
      }).join(' ');

      // Fire and forget (don't block the UI)
      fetch(LOG_SERVER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          message,
          timestamp: new Date().toISOString(),
          // Metadata about the environment
          env: 'figma-plugin'
        })
      }).catch((err) => {
        // Log error once to console if fetch fails
        if (Date.now() % 10 === 0) { // Throttle console noise
            this.originalConsole.error('[RemoteLogger] Fetch failed:', err.message);
        }
      });
    } catch (e) {
      // ignore
    }
  }
}
