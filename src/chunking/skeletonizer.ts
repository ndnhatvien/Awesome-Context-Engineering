/**
 * AST Skeletonizer - 渐进式骨架压缩器
 *
 * 灵感来源于 elara-labs/code-context-engine: "Chunk Compression (89% additional savings)"
 * 将长函数、类或模块内部的实现细节按需折叠为声明签名与注释文档，
 * 并提供 expand_chunk 占位符，使 AI Agent 能够以极小 Token 预算通览架构，
 * 仅在需要修改或深入单行排查时调用 expand_chunk 展开完整源码。
 */

export interface SkeletonizeOptions {
  /** 触发折叠的最小行数（默认 12 行） */
  minLines?: number;
  /** Chunk 唯一标识（用于生成 expand_chunk 调用提示） */
  chunkId?: string;
  /** 文件路径 */
  filePath?: string;
}

export interface SkeletonResult {
  code: string;
  isSkeletonized: boolean;
  originalLines: number;
  skeletonLines: number;
  hiddenLines: number;
}

/**
 * 针对代码块生成骨架签名（支持 TS/JS, Python, Go, Rust, Java, C#, PHP 等）
 */
export function skeletonizeCode(
  code: string,
  language = 'typescript',
  options: SkeletonizeOptions = {},
): SkeletonResult {
  const minLines = options.minLines ?? 12;
  const chunkId = options.chunkId || 'chunk_ref';
  const lines = code.split('\n');
  const originalLines = lines.length;

  if (originalLines < minLines) {
    return {
      code,
      isSkeletonized: false,
      originalLines,
      skeletonLines: originalLines,
      hiddenLines: 0,
    };
  }

  const lang = language.toLowerCase();
  let resultLines: string[] = [];
  let isSkeletonized = false;

  if (lang.includes('python')) {
    resultLines = skeletonizePython(lines, chunkId);
  } else {
    // 默认大括号类语言（TS, JS, Go, Rust, Java, C#, C++, PHP 等）
    resultLines = skeletonizeBraceLanguage(lines, chunkId);
  }

  const skeletonLines = resultLines.length;
  const hiddenLines = Math.max(0, originalLines - skeletonLines);
  isSkeletonized = hiddenLines > 0;

  return {
    code: isSkeletonized ? resultLines.join('\n') : code,
    isSkeletonized,
    originalLines,
    skeletonLines: isSkeletonized ? skeletonLines : originalLines,
    hiddenLines,
  };
}

/**
 * 针对大括号语系（TS/JS/Go/Rust/Java/C#）的骨架提取
 */
function skeletonizeBraceLanguage(lines: string[], chunkId: string): string[] {
  const output: string[] = [];
  let inFunction = false;
  let braceDepth = 0;
  let skippedInCurrentFunc = 0;
  let funcIndent = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 统计当前行大括号增减
    let openBraces = 0;
    let closeBraces = 0;
    for (const char of line) {
      if (char === '{') openBraces++;
      if (char === '}') closeBraces++;
    }

    if (!inFunction) {
      // 类、接口、枚举等是容器，保持结构可见，不直接折叠
      const isContainer = /^(?:export\s+)?(?:default\s+)?(?:class|interface|namespace|enum)\b/.test(
        trimmed,
      );

      // 检查是否包含函数/方法声明（需包含参数列表括号）
      const isFuncDecl =
        !isContainer &&
        trimmed.includes('(') &&
        /(?:function\b|const\s+\w+\s*=\s*(?:async\s*)?\(|constructor\b|def\b|fn\b|func\b|\b(?:public|private|protected|async|static|\*)\s+[a-zA-Z0-9_]+|[a-zA-Z0-9_]+\s*\([^)]*\))/.test(
          trimmed,
        );

      output.push(line);

      if (isFuncDecl && openBraces > closeBraces) {
        inFunction = true;
        braceDepth = openBraces - closeBraces;
        skippedInCurrentFunc = 0;
        const match = line.match(/^(\s*)/);
        funcIndent = match ? match[1] : '';
      }
    } else {
      // 处于函数体内
      braceDepth += openBraces - closeBraces;

      if (braceDepth <= 0) {
        // 函数结束
        if (skippedInCurrentFunc > 2) {
          output.push(
            `${funcIndent}  /* ... [${skippedInCurrentFunc} lines hidden. Use expand-chunk(chunk_id: "${chunkId}") to view] ... */`,
          );
        }
        output.push(line);
        inFunction = false;
        braceDepth = 0;
        skippedInCurrentFunc = 0;
      } else {
        // 折叠函数内部行
        skippedInCurrentFunc++;
      }
    }
  }

  return output;
}

/**
 * 针对缩进语系（Python）的骨架提取
 */
function skeletonizePython(lines: string[], chunkId: string): string[] {
  const output: string[] = [];
  let inFunction = false;
  let baseIndent = 0;
  let skippedInCurrentFunc = 0;
  let funcIndentStr = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      if (!inFunction) output.push(line);
      continue;
    }

    const currentIndent = line.search(/\S|$/);

    if (inFunction) {
      if (currentIndent > baseIndent) {
        // 仍属于函数体内部
        // 保留开头的 docstring
        if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
          output.push(line);
        } else {
          skippedInCurrentFunc++;
        }
        continue;
      }
      // 函数体结束（缩进回到等于或小于定义位置）
      if (skippedInCurrentFunc > 1) {
        output.push(
          `${funcIndentStr}    # ... [${skippedInCurrentFunc} lines hidden. Use expand-chunk(chunk_id: "${chunkId}") to view] ...`,
        );
        output.push(`${funcIndentStr}    pass`);
      }
      inFunction = false;
      skippedInCurrentFunc = 0;
    }

    output.push(line);

    if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      inFunction = true;
      baseIndent = currentIndent;
      const match = line.match(/^(\s*)/);
      funcIndentStr = match ? match[1] : '';
    }
  }

  if (inFunction && skippedInCurrentFunc > 1) {
    output.push(
      `${funcIndentStr}    # ... [${skippedInCurrentFunc} lines hidden. Use expand-chunk(chunk_id: "${chunkId}") to view] ...`,
    );
    output.push(`${funcIndentStr}    pass`);
  }

  return output;
}
