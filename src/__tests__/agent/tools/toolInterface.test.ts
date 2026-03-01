import { searchDesignKnowledgeExecutor } from '../../../engine/agent/tools/unified/queryKnowledge';
import { validateLayoutExecutor } from '../../../engine/agent/tools/unified/validateDesign';

describe('Agent Tool Interface Layer', () => {
  describe('searchDesignKnowledge', () => {
    it('should return results from various knowledge domains', async () => {
      const result = await searchDesignKnowledgeExecutor({ domain: 'styles', query: 'minimal' });
      expect(result.success).toBe(true);
      expect(result.data.results.length).toBeGreaterThan(0);
    });

    it('should return error for invalid domain', async () => {
      const result = await searchDesignKnowledgeExecutor({ domain: 'invalid' as any, query: 'test' });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_DOMAIN');
    });
  });

  describe('validateLayout', () => {
    it('should detect sizing conflicts', async () => {
      const invalidNode = {
        id: '1',
        type: 'FRAME' as const,
        props: {
          name: 'InvalidNode',
          layout: 'HORIZONTAL' as any,
          layoutSizingHorizontal: 'HUG',
          width: 500
        }
      };
      const result = await validateLayoutExecutor({ node: invalidNode });
      expect(result.success).toBe(true);
      expect(result.data.valid).toBe(true); // It's a warning in the validator, not an error
      expect(result.data.warnings.some(w => w.rule === 'SizingDimensionConflict')).toBe(true);
    });
  });
});
