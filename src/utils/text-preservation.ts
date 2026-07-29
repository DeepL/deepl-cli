/**
 * Text preservation utilities
 * Preserves code blocks and variables during translation by replacing them with placeholders
 */

export function preserveCodeBlocks(text: string, preservationMap: Map<string, string>): string {
  let processed = text;
  let counter = 0;

  // Preserve multi-line code blocks (```)
  processed = processed.replace(/```[\s\S]*?```/g, (match) => {
    const placeholder = `__CODE_${counter++}__`;
    preservationMap.set(placeholder, match);
    return placeholder;
  });

  // Preserve inline code blocks (`)
  processed = processed.replace(/`[^`]+`/g, (match) => {
    const placeholder = `__CODE_${counter++}__`;
    preservationMap.set(placeholder, match);
    return placeholder;
  });

  return processed;
}

export function preserveVariables(text: string, preservationMap: Map<string, string>): string {
  let processed = text;
  let counter = 0;

  // Preserve various variable formats (order matters - longest match first)
  const patterns = [
    /\$\{[\p{L}\p{N}_]+\}/gu,       // ${name}, ${имя}
    /\{\{[\p{L}\p{N}_]+\}\}/gu,     // {{name}}, {{имя}} — must precede {name}
    /\{[\p{L}\p{N}_]+\}/gu,         // {name}, {名前}, {0}
    /%\d+\$[sdfu@]/g,               // %1$s, %2$d
    /%[sdfu@]/g,                     // %s, %d, %f, %u, %@
  ];

  for (const pattern of patterns) {
    processed = processed.replace(pattern, (match) => {
      const placeholder = `__VAR_${counter++}__`;
      preservationMap.set(placeholder, match);
      return placeholder;
    });
  }

  return processed;
}

export function restorePlaceholders(text: string, preservationMap: Map<string, string>): string {
  let restored = text;
  for (const [placeholder, original] of preservationMap.entries()) {
    // Single pass per placeholder. The previous `while (includes(placeholder))`
    // loop never terminated when `original` itself contained the placeholder
    // token — each pass re-inserted it and the string grew without bound. A
    // locale value shaped like `{__VAR_0__}` is enough to trigger it, and
    // because restoration also runs on cached results it hung with no API call.
    // The function form of the replacement keeps `$&`/`$1` in `original`
    // literal instead of being read as substitution patterns.
    restored = restored.replaceAll(placeholder, () => original);
  }
  return restored;
}
