import { createRuntime as createCRuntime } from '@alistar.max/ace-lang-c';
import { createRuntime as createCppRuntime } from '@alistar.max/ace-lang-cpp';
import { createRuntime as createCSharpRuntime } from '@alistar.max/ace-lang-csharp';
import { createRuntime as createJavaRuntime } from '@alistar.max/ace-lang-java';
import { createRuntime as createKotlinRuntime } from '@alistar.max/ace-lang-kotlin';
import { createRuntime as createPhpRuntime } from '@alistar.max/ace-lang-php';
import { createRuntime as createRubyRuntime } from '@alistar.max/ace-lang-ruby';
import { createRuntime as createRustRuntime } from '@alistar.max/ace-lang-rust';
import { createRuntime as createSwiftRuntime } from '@alistar.max/ace-lang-swift';
import { createRuntime as createTypeScriptRuntime } from '@alistar.max/ace-lang-typescript';
import type Parser from 'tree-sitter';

export interface LanguageRuntime {
  id: string;
  languages: readonly string[];
  canParse(language: string): boolean;
  getParser(language: string): Promise<Parser | null>;
}

class AllRuntime implements LanguageRuntime {
  id = 'plugin-all';

  private readonly runtimes: LanguageRuntime[] = [
    createTypeScriptRuntime(),
    createKotlinRuntime(),
    createCSharpRuntime(),
    createCppRuntime(),
    createJavaRuntime(),
    createRubyRuntime(),
    createCRuntime(),
    createPhpRuntime(),
    createRustRuntime(),
    createSwiftRuntime(),
  ];

  readonly languages = Array.from(new Set(this.runtimes.flatMap((runtime) => runtime.languages)));

  canParse(language: string): boolean {
    return this.runtimes.some((runtime) => runtime.canParse(language));
  }

  async getParser(language: string): Promise<Parser | null> {
    for (const runtime of this.runtimes) {
      if (!runtime.canParse(language)) continue;

      const parser = await runtime.getParser(language);
      if (parser) return parser;
    }

    return null;
  }
}

export function createRuntime(): LanguageRuntime {
  return new AllRuntime();
}
