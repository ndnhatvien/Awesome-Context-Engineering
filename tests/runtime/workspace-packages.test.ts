import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

type PackageDefinition = {
  dir: string;
  name: string;
};

const actualPkgAll = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'packages/lang-all/package.json'), 'utf8'),
) as { name: string };
const scope = actualPkgAll.name.split('/')[0];

const packageDefinitions: PackageDefinition[] = [
  { dir: 'lang-all', name: `${scope}/ace-lang-all` },
  { dir: 'lang-typescript', name: `${scope}/ace-lang-typescript` },
  { dir: 'lang-kotlin', name: `${scope}/ace-lang-kotlin` },
  { dir: 'lang-csharp', name: `${scope}/ace-lang-csharp` },
  { dir: 'lang-cpp', name: `${scope}/ace-lang-cpp` },
  { dir: 'lang-java', name: `${scope}/ace-lang-java` },
  { dir: 'lang-ruby', name: `${scope}/ace-lang-ruby` },
  { dir: 'lang-c', name: `${scope}/ace-lang-c` },
  { dir: 'lang-php', name: `${scope}/ace-lang-php` },
  { dir: 'lang-rust', name: `${scope}/ace-lang-rust` },
  { dir: 'lang-swift', name: `${scope}/ace-lang-swift` },
];

const requiredFiles = ['pnpm-workspace.yaml'];
for (const packageDefinition of packageDefinitions) {
  requiredFiles.push(`packages/${packageDefinition.dir}/package.json`);
  requiredFiles.push(`packages/${packageDefinition.dir}/tsconfig.json`);
  requiredFiles.push(`packages/${packageDefinition.dir}/src/index.ts`);
}

for (const relativePath of requiredFiles) {
  const filePath = path.resolve(process.cwd(), relativePath);
  assert.equal(fs.existsSync(filePath), true, `缺少文件: ${relativePath}`);
}

const workspaceContent = fs.readFileSync(
  path.resolve(process.cwd(), 'pnpm-workspace.yaml'),
  'utf8',
);
assert.equal(
  workspaceContent.includes('packages/*'),
  true,
  'pnpm-workspace.yaml 必须包含 packages/*',
);

for (const packageDefinition of packageDefinitions) {
  const pkg = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), `packages/${packageDefinition.dir}/package.json`),
      'utf8',
    ),
  ) as {
    name: string;
    exports?: {
      '.': string | { default?: string };
    };
  };

  assert.equal(pkg.name, packageDefinition.name);

  const packageExport = pkg.exports?.['.'];
  assert.equal(
    typeof packageExport === 'string' ? packageExport : packageExport?.default,
    './dist/index.js',
  );
}
