
// Mocking the behavior in DesignSystemManager and CanvasOrchestrator

function parseColor(input: any, defaultAlpha: number = 1) {
    // Simulating figma.util.rgba behavior roughly
    return {
        r: 0.5,
        g: 0.5,
        b: 0.5,
        a: 0.9 // Explicit alpha
    };
}

// Simulating the token object
const token = {
    name: "test/color",
    value: "#808080",
    _resolvedColor: parseColor("#808080")
};

console.log("Original _resolvedColor:", token._resolvedColor);

// The logic in CanvasOrchestrator
const resolved = (token as any)._resolvedColor || { r: 0.8, g: 0.8, b: 0.8, a: 1 };
const { a, ...rgb } = resolved;

console.log("Extracted alpha:", a);
console.log("Rest RGB object:", rgb);

// Validation Check
if ('a' in rgb) {
    console.error("FAIL: 'a' property is still present in rgb object!");
    process.exit(1);
} else {
    console.log("PASS: 'a' property successfully removed.");
}

// Check keys explicitly
console.log("Keys in rgb:", Object.keys(rgb));
