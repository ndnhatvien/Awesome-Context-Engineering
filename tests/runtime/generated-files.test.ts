import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGeneratedFilePenalty, isGeneratedFile } from '../../src/scanner/generatedFiles.js';

test('isGeneratedFile - positive cases (generated files)', () => {
  const generatedFiles = [
    // Go
    'api/service.pb.go',
    'api/service_grpc.pb.go',
    'mocks/mock_store.go',
    'wire_gen.go',
    'pkg/zzgenerated.go',
    // TS/JS
    'src/graphql.generated.ts',
    'src/types.g.ts',
    'src/__generated__/schema.ts',
    'dist/main.js',
    '.next/server/chunk.js',
    // Python
    'pb/user_pb2.py',
    'migrations/versions/001_init_generated.py',
    // C#
    'Views/Main.Designer.cs',
    'Generated/Data.g.cs',
    'Migrations/20260101_init.cs',
    // General
    'vendor/github.com/pkg/errors/errors.go',
    'node_modules/lodash/index.js',
    '__pycache__/server.cpython-311.pyc',
    // Windows path separators
    'pb\\user.pb.go',
    'vendor\\github.com\\pkg\\errors.go',
  ];

  for (const file of generatedFiles) {
    assert.equal(isGeneratedFile(file), true, `Should detect as generated: ${file}`);
  }
});

test('isGeneratedFile - negative cases (handwritten files)', () => {
  const normalFiles = [
    'src/index.ts',
    'src/scanner/filter.ts',
    'cmd/server/main.go',
    'app/models/user.py',
    'src/main.rs',
    'Controllers/UserController.cs',
    'lib/main.dart',
  ];

  for (const file of normalFiles) {
    assert.equal(isGeneratedFile(file), false, `Should NOT detect as generated: ${file}`);
  }
});

test('applyGeneratedFilePenalty - apply 70% penalty to generated files only', () => {
  const originalScore = 100;

  // Generated file
  const genScore = applyGeneratedFilePenalty('src/api/types.generated.ts', originalScore);
  assert.equal(genScore, 30, 'Should apply 70% penalty (100 * 0.3 = 30)');

  // Handwritten file
  const normalScore = applyGeneratedFilePenalty('src/api/types.ts', originalScore);
  assert.equal(normalScore, originalScore, 'Should not apply penalty');
});
