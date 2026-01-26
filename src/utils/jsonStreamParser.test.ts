import { describe, it, expect, vi } from 'vitest';
import { JsonStreamParser } from './jsonStreamParser';

describe('JsonStreamParser', () => {
  it('should parse a single complete JSON object', () => {
    const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);

    parser.feed('{"foo":"bar"}');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ foo: 'bar' });
  });

  it('should parse an array of objects', () => {
    const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);

    parser.feed('[{"id":1},{"id":2}]');
    
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 1 });
    expect(result[1]).toEqual({ id: 2 });
  });

  it('should handle chunked input', () => {
    const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);

    parser.feed('[');
    parser.feed('{"id"');
    parser.feed(':1}');
    parser.feed(',');
    parser.feed('{"i');
    parser.feed('d":2}');
    parser.feed(']');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 1 });
    expect(result[1]).toEqual({ id: 2 });
  });

  it('should handle nested objects and arrays', () => {
    const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);

    const complex = {
      name: "root",
      children: [
        { id: 1, meta: { val: "a" } },
        { id: 2 }
      ]
    };
    
    // Note: Our parser emits top-level items. 
    // If input is wrapped in `[...]`, it emits the items inside.
    // If input is just `{...}`, it emits that one object.
    
    parser.feed(JSON.stringify([complex]));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(complex);
  });

  it('should ignore braces inside strings', () => {
    const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);

    parser.feed('[{"text": "This is a { brace } inside"}]');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: "This is a { brace } inside" });
  });

  it('should handle escaped quotes inside strings', () => {
    const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);

    parser.feed('[{"text": "Say \\"Hello\\""}]');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: 'Say "Hello"' });
  });
  
  it('should handle escaped backslashes', () => {
     const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);
    
    // JSON: {"path": "C:\\Windows"}
    parser.feed('[{"path": "C:\\\\Windows"}]');
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ path: 'C:\\Windows' });
  });

  it('should handle partially delivered streaming array (LLM style)', () => {
    const parser = new JsonStreamParser();
    const result: any[] = [];
    parser.onValue = (val) => result.push(val);

    // LLM typically outputs: [ { ... }, { ... }
    // and might stop abruptly.
    
    parser.feed('[{"step": 1}, {"step": 2}, {"ste'); 
    
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ step: 1 });
    expect(result[1]).toEqual({ step: 2 });
    // The 3rd incomplete object is pending, not emitted.
  });
});
