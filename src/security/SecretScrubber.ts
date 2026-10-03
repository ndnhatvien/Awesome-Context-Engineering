/**
 * SecretScrubber - 企业级代码敏感信息与密钥清洗器
 *
 * 灵感来源于 elara-labs/code-context-engine: "Secure by default"
 * 在代码分片、构建向量索引以及向 LLM 返回上下文时，
 * 自动识别并擦除敏感凭据与 API Key，避免泄露至向量数据库或对话上下文中。
 */

export interface ScrubResult {
  cleanText: string;
  redactedCount: number;
  detectedTypes: string[];
}

interface SecretPattern {
  type: string;
  regex: RegExp;
  replacement: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // 1. AWS Access Key ID
  {
    type: 'AWS_ACCESS_KEY',
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    replacement: '[REDACTED_AWS_ACCESS_KEY]',
  },
  // 2. GitHub Personal Access Token (classic & fine-grained)
  {
    type: 'GITHUB_PAT',
    regex: /\b(ghp_[0-9a-zA-Z]{36}|github_pat_[0-9a-zA-Z_]{82})\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  // 3. Slack Token
  {
    type: 'SLACK_TOKEN',
    regex: /\b(xox[baprs]-[0-9a-zA-Z]{10,48})\b/g,
    replacement: '[REDACTED_SLACK_TOKEN]',
  },
  // 4. OpenAI / Anthropic API Key
  {
    type: 'AI_PROVIDER_KEY',
    regex: /\b(sk-(?:proj-)?[a-zA-Z0-9_-]{20,})\b/g,
    replacement: '[REDACTED_AI_API_KEY]',
  },
  // 5. Google API Key
  {
    type: 'GOOGLE_API_KEY',
    regex: /\b(AIza[0-9A-Za-z\\-_]{35})\b/g,
    replacement: '[REDACTED_GOOGLE_API_KEY]',
  },
  // 6. Stripe API Key
  {
    type: 'STRIPE_KEY',
    regex: /\b([rs]k_(?:live|test)_[0-9a-zA-Z]{24,})\b/g,
    replacement: '[REDACTED_STRIPE_KEY]',
  },
  // 7. Private Keys (RSA, EC, OpenSSH, etc.)
  {
    type: 'PRIVATE_KEY',
    regex:
      /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    replacement: '/* [REDACTED_PRIVATE_KEY] */',
  },
  // 8. JWT Token (header.payload.signature)
  {
    type: 'JWT_TOKEN',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: '[REDACTED_JWT_TOKEN]',
  },
  // 9. Generic hardcoded password/secret in code assignments
  {
    type: 'HARDCODED_CREDENTIAL',
    regex:
      /(?<=\b(?:password|passwd|secret|api_key|apikey|access_token)\s*[:=]\s*['"])[^'"]{8,}(?=['"])/gi,
    replacement: '[REDACTED_SECRET]',
  },
];

// biome-ignore lint/complexity/noStaticOnlyClass: utility namespace for secret scrubbing
export class SecretScrubber {
  /**
   * 清洗文本中的所有敏感凭据
   */
  public static scrub(text: string): ScrubResult {
    if (!text || text.length === 0) {
      return { cleanText: text, redactedCount: 0, detectedTypes: [] };
    }

    let cleanText = text;
    let redactedCount = 0;
    const detectedTypes = new Set<string>();

    for (const pattern of SECRET_PATTERNS) {
      // 检查是否有匹配
      pattern.regex.lastIndex = 0;
      const matches = cleanText.match(pattern.regex);
      if (matches && matches.length > 0) {
        redactedCount += matches.length;
        detectedTypes.add(pattern.type);
        cleanText = cleanText.replace(pattern.regex, pattern.replacement);
      }
    }

    return {
      cleanText,
      redactedCount,
      detectedTypes: Array.from(detectedTypes),
    };
  }

  /**
   * 快速检测文本是否包含敏感凭据
   */
  public static containsSecrets(text: string): boolean {
    if (!text) return false;
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(text)) {
        return true;
      }
    }
    return false;
  }
}
