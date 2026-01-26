import { NodeLayer } from '../figma-adapter/renderers';
import { TreeReconstructor } from '../figma-adapter/treeReconstructor';
import { GenerationPhase, GenerationState } from '../llm-client/types';

export type FlatNodeType =
  | 'FRAME'
  | 'GROUP'
  | 'VECTOR'
  | 'LINE'
  | 'ELLIPSE'
  | 'RECTANGLE'
  | 'TEXT'
  | 'SECTION'
  | 'ICON';

export type FlatNode = {
  id: string;
  parent: string | null;
  type: FlatNodeType;
  props: Record<string, any>;
};

export interface SessionState extends GenerationState {
    nodes: FlatNode[];
    lastRoot: NodeLayer | null;
}

/**
 * Manages streaming sessions and tree reconstruction.
 * Holds the source of truth for generation state.
 */
export class StreamBufferManager {
    private static sessions = new Map<string, SessionState>();
    private static reconstructor = new TreeReconstructor();

    private static getOrCreateSession(sessionId: string): SessionState {
        let session = this.sessions.get(sessionId);
        if (!session) {
            session = {
                sessionId,
                phase: GenerationPhase.IDLE,
                nodes: [],
                lastRoot: null
            };
            this.sessions.set(sessionId, session);
        }
        return session;
    }

    public static updateState(sessionId: string, patch: Partial<GenerationState>): void {
        const session = this.getOrCreateSession(sessionId);
        Object.assign(session, patch);
    }

    public static addNode(sessionId: string, node: FlatNode): NodeLayer | null {
        const session = this.getOrCreateSession(sessionId);
        session.nodes.push(node);
        session.phase = GenerationPhase.GENERATING;
        session.count = session.nodes.length;

        const { root } = this.reconstructor.reconstruct(session.nodes, { 
            wrapperId: `wrapper-${sessionId}`,
            forceWrapper: true 
        });
        session.lastRoot = root as unknown as NodeLayer;
        return session.lastRoot;
    }

    public static getSession(sessionId: string): SessionState | undefined {
        return this.sessions.get(sessionId);
    }

    public static clear(sessionId: string): void {
        this.sessions.delete(sessionId);
    }
}
