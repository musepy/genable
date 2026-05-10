import { describe, it, expect } from 'vitest';
import { getModelQuirks, learnModelQuirk, isImageRejection400, MODEL_QUIRKS } from '../modelQuirks';

describe('modelQuirks', () => {
  describe('getModelQuirks (static lookup)', () => {
    it('returns supportsVision:false for confirmed deepseek models', () => {
      expect(getModelQuirks('deepseek-v4-flash').supportsVision).toBe(false);
      expect(getModelQuirks('deepseek-v4-pro').supportsVision).toBe(false);
    });

    it('returns supportsVision:false for mimo-v2.5-pro (Xiaomi router)', () => {
      expect(getModelQuirks('mimo-v2.5-pro').supportsVision).toBe(false);
    });

    it('returns empty object for unknown ids (default open)', () => {
      expect(getModelQuirks('totally-unknown-model')).toEqual({});
      expect(getModelQuirks('').supportsVision).toBeUndefined();
      expect(getModelQuirks(null).supportsVision).toBeUndefined();
      expect(getModelQuirks(undefined).supportsVision).toBeUndefined();
    });

    it('does not declare kimi/glm/mimo-non-2.5-pro as no-vision (they accept image_url)', () => {
      // These models accepted image_url at the wire layer in the 2026-05-10 sweep;
      // whether they ACT on the image is a separate question (handled by visionProbe).
      expect(getModelQuirks('kimi-k2.6').supportsVision).toBeUndefined();
      expect(getModelQuirks('glm-5').supportsVision).toBeUndefined();
      expect(getModelQuirks('mimo-v2-pro').supportsVision).toBeUndefined();
    });
  });

  describe('learnModelQuirk (runtime self-heal)', () => {
    it('persists across calls within a session', () => {
      const id = 'fake-vendor-fooModel-' + Math.random().toString(36).slice(2);
      expect(getModelQuirks(id).supportsVision).toBeUndefined();
      learnModelQuirk(id, { supportsVision: false });
      expect(getModelQuirks(id).supportsVision).toBe(false);
    });

    it('static MODEL_QUIRKS wins on conflict — table is authoritative', () => {
      const id = 'deepseek-v4-pro'; // statically false
      learnModelQuirk(id, { supportsVision: true }); // attempt to override (should NOT take effect)
      expect(getModelQuirks(id).supportsVision).toBe(false);
    });

    it('no-ops on empty modelId', () => {
      learnModelQuirk('', { supportsVision: false });
      expect(getModelQuirks('').supportsVision).toBeUndefined();
    });
  });

  describe('isImageRejection400', () => {
    it('matches DeepSeek wire-shape rejection', () => {
      const msg = "API error 400: Error from provider (DeepSeek): Failed to deserialize the JSON body into the target type: messages[15]: unknown variant `image_url`, expected `text`";
      expect(isImageRejection400(msg)).toBe(true);
    });

    it('matches Xiaomi router missing-endpoint rejection', () => {
      const msg = 'API error 400: Error from provider (Xiaomi): No endpoints found that support image input';
      expect(isImageRejection400(msg)).toBe(true);
    });

    it('matches Xiaomi multimodal-corrupted rejection', () => {
      const msg = 'API error 400: Error from provider (Xiaomi): Request Error - Multimodal data is corrupted or cannot be processed';
      expect(isImageRejection400(msg)).toBe(true);
    });

    it('matches a generic "does not support image" message', () => {
      expect(isImageRejection400('Model does not support image inputs')).toBe(true);
    });

    it('does NOT match unrelated 400s', () => {
      expect(isImageRejection400('rate limit exceeded')).toBe(false);
      expect(isImageRejection400('max_tokens must be positive')).toBe(false);
      expect(isImageRejection400('invalid_api_key')).toBe(false);
      expect(isImageRejection400('')).toBe(false);
    });
  });

  describe('MODEL_QUIRKS table integrity', () => {
    it('all entries are frozen (no runtime mutation)', () => {
      // Object.freeze is shallow but at least guards the top level.
      expect(Object.isFrozen(MODEL_QUIRKS)).toBe(true);
    });
  });
});
