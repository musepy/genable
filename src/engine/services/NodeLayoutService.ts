/**
 * @file NodeLayoutService.ts
 * @description Service layer for node layout operations.
 * 
 * [RESPONSIBILITY]: Business logic and validation for node layout operations.
 * [PATTERN]: Service Layer - contains domain logic, delegates to repositories.
 * 
 * This service:
 * 1. Validates layout constraints before applying
 * 2. Orchestrates repository calls
 * 3. Returns structured results for IPC handlers
 */

import { nodeRepository } from '../figma-adapter/repositories';
import { ToolResponse } from '../agent/tools/types';

export interface LayoutResult {
  nodeId?: string;
  error?: { code: string; message: string };
}

/**
 * Service for node layout operations.
 * Encapsulates business logic and validation.
 */
export class NodeLayoutService {
  private repository = nodeRepository;

  /**
   * Delete a node by ID.
   */
  async deleteNode(nodeId: string): Promise<ToolResponse> {
    const node = await this.repository.findById(nodeId);
    
    if (!node) {
      return {
        error: `Node ${nodeId} not found.`
      };
    }

    try {
      this.repository.removeNode(node);
      return {};
    } catch (e: any) {
      return {
        error: e.message
      };
    }
  }

}

// Export singleton instance
export const nodeLayoutService = new NodeLayoutService();
