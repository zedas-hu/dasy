import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const entryFile = path.join(distDir, 'dasy.d.mts');
const emittedSupportFiles = [
    path.join(distDir, 'html.d.mts'),
    path.join(distDir, 'json_tools.d.mts'),
];

const importPattern = /^import\s+\{[^}]+\}\s+from\s+'(\.\/[^']+\.mjs)';\r?\n/gm;
const exportListPattern = /^export\s+\{[^}]+\};\r?\n?/gm;
const exportedDeclarationPattern = /^export\s+(?=(declare\s+|type\s+|interface\s+|class\s+|function\s+|const\s+|namespace\s+))/gm;

const visitedFiles = new Set();

async function inlineDeclarations(filePath, isEntry = false) {
    const normalizedPath = path.resolve(filePath);
    if (visitedFiles.has(normalizedPath))
        return '';
    visitedFiles.add(normalizedPath);

    const source = await readFile(normalizedPath, 'utf8');
    const dependencies = Array.from(source.matchAll(importPattern), match => match[1]);
    let bundled = '';

    for (const relativeImportPath of dependencies) {
        const dependencyFile = path.resolve(path.dirname(normalizedPath), relativeImportPath.replace(/\.mjs$/, '.d.mts'));
        bundled += await inlineDeclarations(dependencyFile);
    }

    let localSource = source.replace(importPattern, '');
    if (!isEntry) {
        localSource = localSource
            .replace(exportListPattern, '')
            .replace(exportedDeclarationPattern, '');
    }

    return bundled + localSource + (localSource.endsWith('\n') ? '' : '\n');
}

const bundled = await inlineDeclarations(entryFile, true);
await writeFile(entryFile, bundled, 'utf8');
await Promise.all(emittedSupportFiles.map(filePath => rm(filePath, { force: true })));