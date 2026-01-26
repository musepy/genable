/**
 * @file jsonStreamParser.ts
 * @description A lightweight, dependency-free streaming JSON parser.
 * Designed to extract complete JSON objects from a continuous stream of string chunks,
 * specifically optimizing for "Array of Objects" patterns used by LLMs.
 */

export type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
export interface JsonObject { [key: string]: JsonValue }
export interface JsonArray extends Array<JsonValue> {}

export interface StreamParserOptions {
  /**
   * If true, logs internal state transitions.
   * @default false
   */
  debug?: boolean;
}

/**
 * A robust streaming JSON parser that emits objects as they are completed.
 * It handles:
 * - Chunked string inputs
 * - Top-level arrays (emitting items as they close)
 * - Escaped characters and strings (ignoring structure symbols inside strings)
 * - Nested structures
 */
export class JsonStreamParser {
  // State for parsing
  private buffer: string = '';
  private processedIndex: number = 0; // Where we have successfully parsed up to
  
  // State Machine variables
  private cursor: number = 0;
  private depth: number = 0;
  private inString: boolean = false;
  private isEscaped: boolean = false;
  
  private options: StreamParserOptions;
  
  // Callback for when a potential root-level object/item is found
  public onValue?: (value: JsonValue) => void;

  constructor(options: StreamParserOptions = {}) {
    this.options = options;
  }

  /**
   * Process a new chunk of text from the stream.
   * @param chunk The incoming string fragment
   */
  public feed(chunk: string): void {
    this.buffer += chunk;
    this.parse();
  }

  private parse(): void {
    // Continue processing from where we left off (this.cursor)
    while (this.cursor < this.buffer.length) {
      const char = this.buffer[this.cursor];
      
      if (this.inString) {
        // Inside a string, we only care about closing quote and escapes
        if (this.isEscaped) {
          // Current char is escaped (e.g. \"), so it's a literal.
          // Reset escape flag.
          this.isEscaped = false;
        } else if (char === '\\') {
          // Start of escape sequence
          this.isEscaped = true;
        } else if (char === '"') {
          // Closing quote
          this.inString = false;
        }
      } else {
        // Outside string, we process structural characters
        if (char === '"') {
          this.inString = true;
        } else if (char === '{') {
          this.depth++;
          // Optimization: If we are starting a root object (depth 1),
          // we might want to mark the start index if we weren't depending on processedIndex.
        } else if (char === '[') {
            this.depth++;
        } else if (char === '}') {
          this.depth--;
          
          // Check if we just closed a top-level object in an array
          // Scenario: `[ { ... }` 
          // [ -> depth 1
          // { -> depth 2
          // } -> depth 1 => Item complete!
          
          // Also handle: ` { ... } ` (Single root object)
          // { -> depth 1
          // } -> depth 0 => Root object complete!
          
          if (this.depth === 1 || this.depth === 0) {
             const found = this.attemptExtractItem(this.cursor);
             if (found) {
                // If we found and parsed an item, we could potentially trim the buffer
                // but for now we just keep the cursor moving.
             }
          }
        } else if (char === ']') {
            this.depth--;
        }
      }
      
      this.cursor++;
    }
    
    // Cleanup: If the buffer gets too large and we have processed a lot, we could trim it.
    // However, string slicing can be expensive. For LLM outputs (usually < 100k tokens),
    // keeping the full string in memory might be acceptable given V8's optimization.
    // For now, to keep it simple and robust, we don't slice the buffer effectively
    // because `JSON.parse` typically needs context or we'd have to manage indices carefully.
    // 
    // To support huge streams, we would implement:
    // this.buffer = this.buffer.slice(this.processedIndex);
    // this.cursor -= this.processedIndex;
    // this.processedIndex = 0;
    // But this complicates finding the "start" of the next object if there are separators like commas.
    // Let's stick to simplest correct generic solution first.
  }

  /**
   * Attempts to extract and parse a valid JSON object ending at the specified index.
   * Returns true if an item was successfully extracted and emitted.
   */
  private attemptExtractItem(endIndex: number): boolean {
    const searchStart = this.processedIndex;
    
    // Find the first '{' that could be the start of our current object
    const potentialStart = this.buffer.indexOf('{', searchStart);
    
    if (potentialStart === -1 || potentialStart > endIndex) {
      return false;
    }

    const candidate = this.buffer.substring(potentialStart, endIndex + 1);
    
    try {
      const obj = JSON.parse(candidate);
      
      // If success, emit the object
      if (this.onValue) {
        this.onValue(obj);
      }
      
      // CRITICAL: Only advance processedIndex if we actually parsed something.
      this.processedIndex = endIndex + 1;
      return true;
      
    } catch (e) {
      // If parsing fails, it's likely because the JSON is incomplete or 
      // we've misaligned the start (rare but possible with chunking).
      // We don't advance processedIndex, so we'll try again with more data.
      if (this.options.debug) {
        console.warn('JsonStreamParser: Partial parse failed (expected for streaming chunks):', e);
      }
      return false;
    }
  }
}
