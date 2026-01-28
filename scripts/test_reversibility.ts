function toCssName(path: string[]): string {
    const cleanPath = path.map(p => 
        p.toLowerCase()
         .replace(/\s+/g, '-')
         .replace(/[^\w-]/g, '')
    );
    const name = cleanPath.join('-');
    if (name.startsWith('spacing-')) return name.replace('spacing-', 'space-');
    return name;
}

function convertNameToPath(name: string): string {
    if (name.includes('/')) return name;
    return name.replace(/-/g, '/');
}

function backToCss(figmaPath: string): string {
    return '--' + figmaPath.replace(/\//g, '-');
}

// Test cases
const testPaths = [
    ['Colors', 'Accent', 'Accent', '1'],
    ['Typography', 'Font Family', 'Text'],
    ['Panel', 'Background'],
    ['Spacing', 'None', '1'],
    ['Radius', 'Full']
];

console.log('--- Reversibility Test ---');
testPaths.forEach(p => {
    const cssName = toCssName(p);
    const figmaPath = convertNameToPath(cssName);
    const inverseCss = backToCss(figmaPath);
    const expectedCss = '--' + cssName;
    
    console.log(`JSON: ${p.join('/')}`);
    console.log(`CSS:  --${cssName}`);
    console.log(`Figma: ${figmaPath}`);
    console.log(`Match: ${inverseCss === expectedCss ? '✅' : '❌'}`);
    console.log('---');
});
