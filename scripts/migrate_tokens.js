const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../src/ui');

// Match `${tokens.lineHeight[X]}px` or similar patterns
const REGEX = /`\$\{tokens\.lineHeight\[([^\]]+)\]\}px`/g;

function getAllFiles(dirPath, arrayOfFiles) {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });

  return arrayOfFiles;
}

console.log(`Scanning ${ROOT_DIR}...`);

try {
  const files = getAllFiles(ROOT_DIR);
  let totalReplacements = 0;

  files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let hasMatch = false;

    const newContent = content.replace(REGEX, (match, index) => {
      hasMatch = true;
      totalReplacements++;
      console.log(`[Fix] ${path.relative(ROOT_DIR, file)}: ${match} -> tokens.lineHeight[${index}]`);
      return `tokens.lineHeight[${index}]`;
    });

    if (hasMatch) {
      fs.writeFileSync(file, newContent, 'utf8');
    }
  });

  console.log(`\nDone! Replaced ${totalReplacements} instances.`);
} catch(e) {
  console.error(e);
}
