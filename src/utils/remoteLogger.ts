/**
 * @file remoteLogger.ts
 * @description [DEPRECATED] Neutered logger to prevent unauthorized local network access errors.
 */

export class RemoteLogger {
  /**
   * [DISABLED] Original logger logic has been removed to avoid "local-network-access" errors in Figma.
   */
  static init(): void {
    // Disabled
  }

  private static async sendRemote(_type: string, _args: any[]): Promise<void> {
    // Disabled
  }
}
