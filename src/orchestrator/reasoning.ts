/**
 * Extracts reasoning text from an OpenRouter response at runtime.
 * Works for any model that returns reasoning_details (DeepSeek-R1, Claude 3.7,
 * Gemini 2.0 Flash Thinking, etc.) without hardcoding model names.
 */
export function extractReasoning(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null;
  const r = response as Record<string, unknown>;

  // output[0].content[] with type 'reasoning_text' (OpenRouter native format)
  const output = r['output'];
  if (Array.isArray(output) && output.length > 0) {
    const firstOutput = output[0] as Record<string, unknown>;
    const content = firstOutput['content'];
    if (Array.isArray(content)) {
      const text = (content as Array<Record<string, unknown>>)
        .filter(c => c['type'] === 'reasoning_text' && typeof c['text'] === 'string')
        .map(c => c['text'] as string)
        .join('\n');
      if (text.length > 0) return text;
    }
  }

  // Prefer structured reasoning_details (richer, multi-part)
  if (Array.isArray(r['reasoning_details']) && r['reasoning_details'].length > 0) {
    const text = (r['reasoning_details'] as Array<Record<string, unknown>>)
      .filter(d => d['type'] === 'reasoning.text' && typeof d['text'] === 'string')
      .map(d => d['text'] as string)
      .join('\n');
    if (text.length > 0) return text;
  }

  // Fallback: legacy flat reasoning string (some providers)
  if (typeof r['reasoning'] === 'string' && r['reasoning'].length > 0) {
    return r['reasoning'];
  }

  return null;
}
