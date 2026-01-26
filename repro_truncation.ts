
import { JsonStreamParser } from './src/utils/jsonStreamParser';

// Simulation of a stream that gets cut off
async function runTest() {
    console.log("Starting Truncated Stream Test...");
    const parser = new JsonStreamParser();
    const collectedItems: any[] = [];
    
    parser.onValue = (value) => {
        console.log("Parser emitted value:", value);
        collectedItems.push(value);
    };

    // Valid JSON array, but cut off in the middle of the 3rd item
    const chunks = [
        '[',
        '{"id": "1", "type": "FRAME"},',
        '{"id": "2", "type": "TEXT"},',
        '{"id": "3", "type": "RECTANG' // TRUNCATED HERE
    ];

    for (const chunk of chunks) {
        parser.feed(chunk);
    }

    console.log("Stream ended.");
    console.log("Collected items:", collectedItems.length);
    
    if (collectedItems.length === 2) {
        console.log("SUCCESS: Recovered 2 valid items from truncated stream.");
    } else {
        console.log("FAILURE: Expected 2 items, got " + collectedItems.length);
    }
}

runTest();
