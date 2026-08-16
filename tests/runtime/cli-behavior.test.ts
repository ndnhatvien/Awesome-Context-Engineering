import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test(
  'search source_code_only + include_languages 组合不再互斥，取交集后正常进入搜索',
  { concurrency: false },
  () => {
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-cli-language-flags-'));

    try {
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          'src/index.ts',
          'search-context',
          '--repo-path',
          process.cwd(),
          '--information-request',
          '定位测试入口',
          '--technical-terms',
          'AuthService, SearchService',
          '--source-code-only',
          '--include-languages',
          'typescript,python',
          '--exclude-languages',
          'markdown,json',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          env: {
            HOME: fakeHome,
            USERPROFILE: fakeHome,
            PATH: process.env.PATH ?? '',
            NODE_ENV: 'production',
            ACE_TEST: 'true',
          },
        },
      );

      // 不再报互斥错误，正常进入搜索流程（因缺少 API key 而失败）
      assert.doesNotMatch(result.stderr, /互斥/);
      assert.match(result.stdout, /配置缺失/);
    } finally {
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  },
);

test('search 配置缺失时返回非零退出码', { concurrency: false }, () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-cli-missing-env-'));

  try {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/index.ts',
        'search-context',
        '--repo-path',
        process.cwd(),
        '--information-request',
        '定位测试入口',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          HOME: fakeHome,
          USERPROFILE: fakeHome,
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          ACE_TEST: 'true',
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /配置缺失/);
    assert.match(result.stdout, /EMBEDDINGS_API_KEY 或 EMBEDDINGS_API_KEYS/);
  } finally {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('search 在日志目录不可写时不应因 logger 崩溃', { concurrency: false }, () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-cli-readonly-logs-'));
  const logDir = path.join(fakeHome, '.ace', 'logs');

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.chmodSync(logDir, 0o555);

    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/index.ts',
        'search-context',
        '--repo-path',
        process.cwd(),
        '--information-request',
        '定位测试入口',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          HOME: fakeHome,
          USERPROFILE: fakeHome,
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'production',
          ACE_TEST: 'true',
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stderr, /ERR_STREAM_DESTROYED/);
    assert.match(result.stdout, /配置缺失/);
  } finally {
    fs.chmodSync(logDir, 0o755);
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});
