export interface TelemetryLogParams {
  provider: string;
  modelName: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
  promptText?: string;
  completionText?: string;
}

export class TelemetryService {
  private static endpoint: string | null = null;
  private static apiKey: string | null = null;

  public static configure(endpoint: string, apiKey?: string) {
    this.endpoint = endpoint;
    this.apiKey = apiKey || null;
  }

  public static logLLMCall(params: TelemetryLogParams) {
    if (!this.endpoint) {
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          ...params
        })
      }).catch(err => {
        console.error('Telemetry failed:', err);
      });
    } catch (err) {
      console.error('Telemetry failed to send:', err);
    }
  }
}
