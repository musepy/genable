/**
 * @file TokenRecorder.ts
 * @description 开发工具：记录 LLM 调用的 token 使用。
 * 写入 .agent-runs/tokens.jsonl（每行一条 JSON）。
 * 仅在 Node.js 环境下工作（测试/CLI），Figma 插件沙盒内静默降级。
 */

export interface TokenRecord {
  /** ISO timestamp */
  ts: string;
  /** 区分不同测试运行 */
  runId: string;
  /** 来源标识，如 "harness:login-form" | "promptTest:example-first" */
  source: string;
  /** 模型名称 */
  model: string;
  /** Provider 名称 */
  provider: string;
  /** Agent 循环第几轮（可选） */
  iteration?: number;
  /** Agent phase: PLANNING | EXECUTION | VERIFICATION（可选） */
  phase?: string;
  /** Prompt tokens consumed */
  promptTokens: number;
  /** Completion tokens generated */
  completionTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** 本次调用耗时（毫秒） */
  latencyMs: number;
  /** 本轮调用了哪些工具（可选） */
  toolsCalled?: string[];
  /** 可选配置标签，用于对比实验 */
  config?: Record<string, any>;
}

// Lazy-load fs to avoid breaking Figma plugin sandbox
// undefined = not yet attempted, null = attempted & failed, object = loaded
let _fs: typeof import('fs') | null | undefined = undefined;
let _path: typeof import('path') | null | undefined = undefined;

function getFs(): typeof import('fs') | null {
  if (_fs !== undefined) return _fs || null;
  try {
    _fs = require('fs');
    _path = require('path');
    return _fs || null;
  } catch {
    _fs = null; // Mark as attempted — won't retry
    return null;
  }
}

export class TokenRecorder {
  private static outputPath: string | null = null;
  private static runId: string = '';
  private static initialized = false;

  /**
   * 初始化 recorder。
   * @param outputPath JSONL 文件的完整路径，如 '.agent-runs/tokens.jsonl'
   * @param runId 可选的运行 ID，默认自动生成
   */
  static init(outputPath?: string, runId?: string): void {
    const fs = getFs();
    if (!fs) {
      // 在 Figma 插件沙盒内，静默跳过
      return;
    }

    const path = _path!;
    this.outputPath = outputPath || path.join(process.cwd(), '.agent-runs', 'tokens.jsonl');
    this.runId = runId || `run_${Date.now().toString(36)}`;
    this.initialized = true;

    // 确保目录存在
    const dir = path.dirname(this.outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    console.log(`[TokenRecorder] Initialized. Output: ${this.outputPath}, RunId: ${this.runId}`);
  }

  /**
   * 记录一条 token 使用数据。
   * 如果未初始化或在非 Node.js 环境，静默返回。
   */
  static record(entry: Omit<TokenRecord, 'ts' | 'runId'>): void {
    if (!this.initialized || !this.outputPath) return;

    const fs = getFs();
    if (!fs) return;

    const record: TokenRecord = {
      ts: new Date().toISOString(),
      runId: this.runId,
      ...entry,
    };

    try {
      fs.appendFileSync(this.outputPath, JSON.stringify(record) + '\n');
    } catch (err) {
      console.error('[TokenRecorder] Failed to write:', err);
    }
  }

  /**
   * 获取当前 runId（用于外部关联）。
   */
  static getRunId(): string {
    return this.runId;
  }

  /**
   * 重置状态（用于测试）。
   */
  static reset(): void {
    this.outputPath = null;
    this.runId = '';
    this.initialized = false;
    _fs = undefined;
    _path = undefined;
  }
}
