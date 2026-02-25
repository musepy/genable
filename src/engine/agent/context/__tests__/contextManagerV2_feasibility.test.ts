import { describe, expect, it } from 'vitest';

type OversizeMode = 'summarize' | 'skeletonize' | 'drop-oldest';

type DistillPolicy = {
  toolName: string;
  preserve: string[];
  compactChildren?: boolean;
  maxItems?: number;
  onOversize: OversizeMode;
};

type ToolEnvelope = {
  toolName: string;
  requestId: string;
  args?: Record<string, unknown>;
  response: unknown;
};

type RawToolResultRecord = {
  resultId: string;
  toolName: string;
  requestId: string;
  createdAt: number;
  expiresAt: number;
  payloadHash: string;
  rawResponse: unknown;
};

type WorkingToolEntry = {
  kind: 'tool';
  toolName: string;
  resultId: string;
  distilled: unknown;
  createdAt: number;
};

type WorkingTextEntry = {
  kind: 'text';
  text: string;
  createdAt: number;
};

type WorkingEntry = WorkingToolEntry | WorkingTextEntry;

const now = (): number => Date.now();

function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Math.ceil(text.length / 4);
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

function pickProps(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

class RawToolResultStore {
  private records: RawToolResultRecord[] = [];
  private index = new Map<string, RawToolResultRecord>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number
  ) {}

  public append(toolName: string, requestId: string, rawResponse: unknown): RawToolResultRecord {
    const timestamp = now();
    const payloadHash = stableHash(rawResponse);
    const resultId = `${toolName}_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;

    const record: RawToolResultRecord = {
      resultId,
      toolName,
      requestId,
      createdAt: timestamp,
      expiresAt: timestamp + this.ttlMs,
      payloadHash,
      rawResponse
    };

    this.records.push(record);
    this.index.set(resultId, record);
    this.evictExpiredAndOverflow();
    return record;
  }

  public rehydrate(resultId: string, mode: 'full' | 'verify'): unknown {
    const record = this.index.get(resultId);
    if (!record) throw new Error(`Result not found: ${resultId}`);

    if (mode === 'full') return record.rawResponse;

    const raw = record.rawResponse as Record<string, unknown> | null;
    const data = (raw?.data as Record<string, unknown> | undefined) || {};
    return {
      toolName: record.toolName,
      requestId: record.requestId,
      verify: {
        success: raw?.success,
        hasData: Object.keys(data).length > 0,
        keys: Object.keys(data).slice(0, 12)
      }
    };
  }

  public dropResultIds(resultIds: string[]): void {
    if (resultIds.length === 0) return;
    const toDrop = new Set(resultIds);
    this.records = this.records.filter(record => !toDrop.has(record.resultId));
    for (const id of toDrop) this.index.delete(id);
  }

  public count(): number {
    return this.records.length;
  }

  private evictExpiredAndOverflow(): void {
    const ts = now();
    this.records = this.records.filter(record => {
      const keep = record.expiresAt > ts;
      if (!keep) this.index.delete(record.resultId);
      return keep;
    });

    while (this.records.length > this.capacity) {
      const oldest = this.records.shift();
      if (oldest) this.index.delete(oldest.resultId);
    }
  }
}

class DistillPolicyEngine {
  private readonly policies: Record<string, DistillPolicy> = {
    inspectDesign: {
      toolName: 'inspectDesign',
      preserve: ['count', 'nodes', 'mode'],
      compactChildren: true,
      maxItems: 20,
      onOversize: 'skeletonize'
    },
    validateLayout: {
      toolName: 'validateLayout',
      preserve: ['valid', 'errors', 'warnings', 'summary'],
      maxItems: 30,
      onOversize: 'summarize'
    },
    batchOperations: {
      toolName: 'batchOperations',
      preserve: ['idMap', 'results'],
      maxItems: 25,
      onOversize: 'skeletonize'
    },
    applyDesignPatch: {
      toolName: 'applyDesignPatch',
      preserve: ['summary', 'results'],
      maxItems: 20,
      onOversize: 'summarize'
    }
  };

  public getPolicy(toolName: string): DistillPolicy {
    return this.policies[toolName] || {
      toolName,
      preserve: [],
      onOversize: 'summarize'
    };
  }

  public distill(envelope: ToolEnvelope, resultId: string): unknown {
    const policy = this.getPolicy(envelope.toolName);
    const raw = envelope.response as Record<string, unknown> | null;
    const data = (raw?.data as Record<string, unknown> | undefined) || {};

    if (envelope.toolName === 'inspectDesign') {
      return this.distillInspectDesign(envelope, resultId);
    }

    if (envelope.toolName === 'validateLayout') {
      return {
        resultId,
        toolName: envelope.toolName,
        success: raw?.success !== false,
        data: {
          valid: data.valid,
          errors: Array.isArray(data.errors) ? data.errors.slice(0, policy.maxItems) : [],
          warnings: Array.isArray(data.warnings) ? data.warnings.slice(0, policy.maxItems) : [],
          summary: data.summary
        }
      };
    }

    if (envelope.toolName === 'batchOperations') {
      const results = Array.isArray(data.results) ? data.results : [];
      return {
        resultId,
        toolName: envelope.toolName,
        success: raw?.success !== false,
        data: {
          idMap: data.idMap || {},
          results: results.slice(0, policy.maxItems).map((item: Record<string, unknown>) => ({
            opId: item.opId,
            action: item.action,
            success: item.success,
            nodeId: item.nodeId,
            error: item.error ? pickProps(item.error as Record<string, unknown>, ['code', 'message']) : undefined,
            diff: item.diff
          }))
        }
      };
    }

    if (envelope.toolName === 'applyDesignPatch') {
      const results = Array.isArray(data.results) ? data.results : [];
      return {
        resultId,
        toolName: envelope.toolName,
        success: raw?.success !== false,
        data: {
          summary: data.summary,
          results: results.slice(0, policy.maxItems).map((item: Record<string, unknown>) => ({
            nodeId: item.nodeId || item.id,
            applied: item.applied ?? item.success
          }))
        }
      };
    }

    return {
      resultId,
      toolName: envelope.toolName,
      success: raw?.success !== false,
      data: policy.preserve.length > 0 ? pickProps(data, policy.preserve) : data
    };
  }

  public compact(entry: WorkingToolEntry): WorkingToolEntry {
    const policy = this.getPolicy(entry.toolName);
    const payload = entry.distilled as Record<string, unknown>;
    const data = (payload.data as Record<string, unknown> | undefined) || {};
    const next = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const nextData = (next.data as Record<string, unknown> | undefined) || {};

    if (policy.onOversize === 'summarize') {
      next.data = {
        summary: data.summary || `${entry.toolName} result compacted`,
        _compacted: true
      };
      return { ...entry, distilled: next };
    }

    if (policy.onOversize === 'skeletonize') {
      if (Array.isArray(nextData.nodes)) {
        const maxItems = policy.maxItems || 10;
        const nodes = nextData.nodes as Array<Record<string, unknown>>;
        nextData.nodes = nodes.slice(0, maxItems).map(node => pickProps(node, ['id', 'name', 'type']));
        if (nodes.length > maxItems) nextData._moreNodes = nodes.length - maxItems;
      }

      if (Array.isArray(nextData.results)) {
        const maxItems = policy.maxItems || 10;
        const results = nextData.results as Array<Record<string, unknown>>;
        nextData.results = results.slice(0, maxItems).map(item =>
          pickProps(item, ['opId', 'action', 'success', 'nodeId', 'error'])
        );
        if (results.length > maxItems) nextData._moreResults = results.length - maxItems;
      }

      nextData._compacted = true;
      next.data = nextData;
      return { ...entry, distilled: next };
    }

    return entry;
  }

  private distillInspectDesign(envelope: ToolEnvelope, resultId: string): unknown {
    const raw = envelope.response as Record<string, unknown> | null;
    const data = (raw?.data as Record<string, unknown> | undefined) || {};
    const mode = envelope.args?.mode;

    if (mode === 'selection') {
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      return {
        resultId,
        toolName: envelope.toolName,
        success: raw?.success !== false,
        data: {
          mode: 'selection',
          count: data.count ?? nodes.length,
          nodes: nodes.slice(0, 80).map((node: Record<string, unknown>) =>
            pickProps(node, ['id', 'name', 'type'])
          ),
          _moreNodes: nodes.length > 80 ? nodes.length - 80 : 0
        }
      };
    }

    const children = Array.isArray(data.children) ? data.children : [];
    return {
      resultId,
      toolName: envelope.toolName,
      success: raw?.success !== false,
      data: {
        mode: mode || 'node',
        id: data.id || data.nodeId,
        type: data.type,
        props: pickProps(data.props as Record<string, unknown> || {}, [
          'name',
          'layoutMode',
          'width',
          'height',
          'characters',
          'textAutoResize',
          'layoutSizingHorizontal',
          'layoutSizingVertical'
        ]),
        childrenCount: children.length
      }
    };
  }
}

class WorkingContextStore {
  private entries: WorkingEntry[] = [];

  public addToolEntry(entry: WorkingToolEntry): void {
    this.entries.push(entry);
  }

  public addNarration(text: string): void {
    this.entries.push({
      kind: 'text',
      text,
      createdAt: now()
    });
  }

  public list(): WorkingEntry[] {
    return this.entries;
  }

  public listToolEntries(): WorkingToolEntry[] {
    return this.entries.filter((entry): entry is WorkingToolEntry => entry.kind === 'tool');
  }

  public replaceToolEntries(next: WorkingToolEntry[]): void {
    const textEntries = this.entries.filter(entry => entry.kind === 'text');
    this.entries = [...textEntries, ...next].sort((a, b) => a.createdAt - b.createdAt);
  }

  public clear(): void {
    this.entries = [];
  }

  public tokenUsage(): number {
    return estimateTokens(this.entries);
  }

  public dropOldestPercent(percent: number): void {
    if (this.entries.length === 0) return;
    const dropCount = Math.max(1, Math.floor(this.entries.length * percent));
    this.entries = this.entries.slice(dropCount);
  }
}

class OverflowRecoveryOrchestrator {
  public readonly events: string[] = [];

  constructor(
    private readonly maxTokens: number,
    private readonly warnThreshold = 0.7,
    private readonly executeThreshold = 0.8,
    private readonly maxRetries = 3
  ) {}

  public recover(working: WorkingContextStore, policyEngine: DistillPolicyEngine): void {
    const usage = working.tokenUsage();
    if (usage <= Math.floor(this.maxTokens * this.warnThreshold)) return;

    this.events.push(`warn:${usage}`);
    if (usage <= Math.floor(this.maxTokens * this.executeThreshold)) return;

    let attempts = 0;
    while (working.tokenUsage() > Math.floor(this.maxTokens * this.executeThreshold) && attempts < this.maxRetries) {
      attempts++;

      this.events.push(`phaseA:${attempts}`);
      const compacted = working.listToolEntries().map(entry => policyEngine.compact(entry));
      working.replaceToolEntries(compacted);
      if (working.tokenUsage() <= Math.floor(this.maxTokens * this.executeThreshold)) break;

      this.events.push(`phaseB:${attempts}`);
      working.dropOldestPercent(0.25);
    }

    if (working.tokenUsage() > Math.floor(this.maxTokens * this.executeThreshold)) {
      this.events.push('phaseD:new_task_handoff');
    } else {
      this.events.push('recovered');
    }
  }
}

class ContextManagerV2Sandbox {
  private readonly rawStore = new RawToolResultStore(80, 60 * 60 * 1000);
  private readonly working = new WorkingContextStore();
  private readonly policyEngine = new DistillPolicyEngine();
  private readonly recovery: OverflowRecoveryOrchestrator;
  private readonly sessionResultIds = new Set<string>();

  constructor(maxTokens: number) {
    this.recovery = new OverflowRecoveryOrchestrator(maxTokens);
  }

  public recordToolResult(envelope: ToolEnvelope): { resultId: string; distilled: unknown } {
    const rawRecord = this.rawStore.append(envelope.toolName, envelope.requestId, envelope.response);
    this.sessionResultIds.add(rawRecord.resultId);

    const distilled = this.policyEngine.distill(envelope, rawRecord.resultId);
    this.working.addToolEntry({
      kind: 'tool',
      toolName: envelope.toolName,
      resultId: rawRecord.resultId,
      distilled,
      createdAt: now()
    });

    this.recovery.recover(this.working, this.policyEngine);
    return { resultId: rawRecord.resultId, distilled };
  }

  public injectNarration(text: string): void {
    this.working.addNarration(text);
    this.recovery.recover(this.working, this.policyEngine);
  }

  public compactContext(): void {
    const compacted = this.working.listToolEntries().map(entry => this.policyEngine.compact(entry));
    this.working.replaceToolEntries(compacted);
    this.recovery.recover(this.working, this.policyEngine);
  }

  public clearContext(mode: 'soft' | 'hard'): void {
    this.working.clear();
    if (mode === 'hard') {
      this.rawStore.dropResultIds([...this.sessionResultIds]);
      this.sessionResultIds.clear();
    }
  }

  public rehydrate(resultId: string, mode: 'full' | 'verify'): unknown {
    return this.rawStore.rehydrate(resultId, mode);
  }

  public getWorkingEntries(): WorkingEntry[] {
    return this.working.list();
  }

  public getTokenUsage(): number {
    return this.working.tokenUsage();
  }

  public getRecoveryEvents(): string[] {
    return this.recovery.events;
  }

  public getRawCount(): number {
    return this.rawStore.count();
  }
}

describe('ContextManager V2 feasibility simulation', () => {
  it('validates layered context + overflow recovery + L0 rehydrate chain', () => {
    const manager = new ContextManagerV2Sandbox(550);

    const selectionNodes = Array.from({ length: 180 }, (_, i) => ({
      id: `node-${i}`,
      name: `Node ${i}`,
      type: i % 2 === 0 ? 'FRAME' : 'TEXT',
      metadata: 'x'.repeat(120)
    }));

    const selectionResult = manager.recordToolResult({
      toolName: 'inspectDesign',
      requestId: 'req-selection-1',
      args: { mode: 'selection' },
      response: {
        success: true,
        data: {
          mode: 'selection',
          count: selectionNodes.length,
          nodes: selectionNodes,
          verboseSnapshot: 'y'.repeat(9000)
        }
      }
    });

    const selectionDistilled = selectionResult.distilled as Record<string, unknown>;
    const selectionData = selectionDistilled.data as Record<string, unknown>;
    expect(selectionData.count).toBe(180);
    expect(Array.isArray(selectionData.nodes)).toBe(true);
    expect((selectionData.nodes as unknown[]).length).toBeGreaterThan(0);
    expect((selectionData.nodes as Array<Record<string, unknown>>)[0].metadata).toBeUndefined();

    manager.recordToolResult({
      toolName: 'validateLayout',
      requestId: 'req-validate-1',
      response: {
        success: true,
        data: {
          valid: false,
          errors: [{ code: 'TEXT_OVERFLOW', message: 'body text overflow' }],
          warnings: [{ code: 'LOW_CONTRAST', message: 'text contrast low' }],
          summary: '1 error, 1 warning'
        }
      }
    });

    manager.recordToolResult({
      toolName: 'batchOperations',
      requestId: 'req-batch-1',
      response: {
        success: true,
        data: {
          idMap: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`op-${i}`, `node-${i}`])),
          results: Array.from({ length: 60 }, (_, i) => ({
            opId: `op-${i}`,
            action: 'setNodeLayout',
            success: true,
            nodeId: `node-${i}`,
            diff: [`adjustment-${i}`],
            verbose: 'z'.repeat(200)
          }))
        }
      }
    });

    for (let i = 0; i < 12; i++) {
      manager.injectNarration(`Iteration ${i} narration ${'n'.repeat(1200)}`);
    }

    const events = manager.getRecoveryEvents();
    expect(events.some(event => event.startsWith('phaseA'))).toBe(true);
    expect(events.some(event => event.startsWith('phaseB'))).toBe(true);
    expect(events).toContain('recovered');

    const usageAfterRecovery = manager.getTokenUsage();
    expect(usageAfterRecovery).toBeLessThanOrEqual(Math.floor(550 * 0.8));

    const full = manager.rehydrate(selectionResult.resultId, 'full') as Record<string, unknown>;
    const fullData = full.data as Record<string, unknown>;
    expect((fullData.nodes as unknown[]).length).toBe(180);

    const verify = manager.rehydrate(selectionResult.resultId, 'verify') as Record<string, unknown>;
    expect((verify.verify as Record<string, unknown>).hasData).toBe(true);

    manager.recordToolResult({
      toolName: 'validateLayout',
      requestId: 'req-validate-2',
      response: {
        success: true,
        data: {
          valid: true,
          errors: [],
          warnings: [],
          summary: 'all good'
        }
      }
    });

    const latestTool = manager
      .getWorkingEntries()
      .filter((entry): entry is WorkingToolEntry => entry.kind === 'tool')
      .at(-1);
    const latestDistilled = latestTool?.distilled as Record<string, unknown> | undefined;
    expect(latestTool?.toolName).toBe('validateLayout');
    expect(((latestDistilled?.data as Record<string, unknown>)?.summary)).toBe('all good');
  });

  it('supports soft/hard clear semantics in control surface', () => {
    const manager = new ContextManagerV2Sandbox(400);

    const record = manager.recordToolResult({
      toolName: 'applyDesignPatch',
      requestId: 'req-patch-1',
      response: {
        success: true,
        data: {
          summary: 'patched button styles',
          results: [{ nodeId: 'btn-1', applied: true }]
        }
      }
    });

    expect(manager.getWorkingEntries().length).toBeGreaterThan(0);
    expect(manager.getRawCount()).toBe(1);

    manager.clearContext('soft');
    expect(manager.getWorkingEntries().length).toBe(0);
    expect(manager.getRawCount()).toBe(1);
    expect(() => manager.rehydrate(record.resultId, 'full')).not.toThrow();

    manager.clearContext('hard');
    expect(manager.getRawCount()).toBe(0);
    expect(() => manager.rehydrate(record.resultId, 'full')).toThrow(/Result not found/);
  });
});
