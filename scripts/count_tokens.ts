import * as fs from 'fs';

const data = JSON.parse(fs.readFileSync('Theme A.tokens.json', 'utf8'));

function countTokens(obj: any) {
    let count = 0;
    function walk(curr: any) {
        if (curr.$value !== undefined) {
            count++;
            return;
        }
        for (const key in curr) {
            if (key.startsWith('$')) continue;
            walk(curr[key]);
        }
    }
    walk(obj);
    return count;
}

const stats: any = {};
for (const key in data) {
    if (key.startsWith('$')) continue;
    stats[key] = countTokens(data[key]);
}

console.log(JSON.stringify(stats, null, 2));
