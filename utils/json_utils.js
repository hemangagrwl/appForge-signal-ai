/**
 * JSON Utilities
 * Safe parsing with multiple recovery strategies.
 */

export function safeParseJSON(raw, context = 'unknown') {
  if (!raw || typeof raw !== 'string') {
    throw new Error(`[${context}] Received empty or non-string response`);
  }

  // Strategy 1: Direct parse
  try {
    return JSON.parse(raw.trim());
  } catch (_) {}

  // Strategy 2: Strip markdown code fences
  const stripped = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```$/im, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (_) {}

  // Strategy 3: Extract first {...} or [...] block
  const jsonMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (_) {}
  }

  // Strategy 4: Aggressive cleanup (remove trailing commas, fix common issues)
  try {
    const cleaned = raw
      .replace(/,\s*([}\]])/g, '$1')      // trailing commas
      .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // unquoted keys
      .replace(/:\s*'([^']*)'/g, ': "$1"')  // single quotes → double
      .replace(/\n/g, ' ')
      .replace(/\t/g, ' ');
    const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (match) return JSON.parse(match[1]);
  } catch (_) {}

  // Strategy 5: Last resort — return minimal valid object
  console.error(`[${context}] All JSON parse strategies failed. Raw:\n${raw.slice(0, 500)}`);
  throw new Error(`[${context}] Failed to parse JSON after 5 strategies`);
}

export function isValidJSON(str) {
  try {
    JSON.parse(str);
    return true;
  } catch (_) {
    return false;
  }
}

export function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
