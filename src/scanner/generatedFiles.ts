/**
 * Generated-file detection regex patterns.
 * Identifies tool-generated or compiled file paths across multiple languages.
 */
const GENERATED_PATTERNS = [
  // Go
  /\.pb\.go$/,
  /_grpc\.pb\.go$/,
  /_mock\.go$/,
  /mock_[^/\\]+\.go$/,
  /_string\.go$/,
  /_gen\.go$/,
  /wire_gen\.go$/,
  /ent\/[^/\\]+\.go$/,
  /zzgenerated[^/\\]*\.go$/,
  /zz_generated[^/\\]*\.go$/,
  // TS/JS
  /\.generated\.(ts|js|tsx|jsx)$/,
  /\.g\.(ts|js)$/,
  /__generated__/,
  /generated\/[^/\\]+\.(ts|js|tsx|jsx)$/,
  /dist\/[^/\\]+\.(js|mjs|cjs)$/,
  /\.next\//,
  /\.nuxt\//,
  // Python
  /_pb2\.py$/,
  /_pb2_grpc\.py$/,
  /_generated\.py$/,
  // C/C++
  /\.pb\.(h|cc|cpp)$/,
  /\.grpc\.pb\.(h|cc|cpp)$/,
  /moc_[^/\\]+\.cpp$/,
  /ui_[^/\\]+\.h$/,
  /\.tab\.(c|h)$/,
  /lex\.yy\.c$/,
  // C#
  /\.Designer\.cs$/,
  /\.g\.cs$/,
  /\.generated\.cs$/,
  /Migrations\/[^/\\]+\.cs$/,
  // Java
  /generated-sources\//,
  /target\/generated\//,
  /build\/generated\//,
  // Swift
  /\.generated\.swift$/,
  /Generated\/[^/\\]+\.swift$/,
  // Dart
  /\.g\.dart$/,
  /\.freezed\.dart$/,
  // Rust
  /target\/[^/\\]+\/build\//,
  // General vendor / packages
  /vendor\//,
  /node_modules\//,
  /__pycache__\//,
];

/**
 * Returns true if the filePath points to a tool-generated or compiled file.
 */
export function isGeneratedFile(filePath: string): boolean {
  // Normalize Windows backslashes
  const normalized = filePath.replace(/\\/g, '/');
  return GENERATED_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Applies a penalty to the candidate score if it is a generated file.
 */
export function applyGeneratedFilePenalty(filePath: string, score: number): number {
  if (isGeneratedFile(filePath)) {
    // 70% penalty (matches the 0.3 factor in vibervn)
    return score * 0.3;
  }
  return score;
}
