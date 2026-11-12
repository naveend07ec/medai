/**
 * Normalizes backend status, model, and error strings so vendor-specific model
 * branding is never surfaced directly in clinician- or user-facing website copy.
 */
export function sanitizeClinicalAiText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/gemini-embedding[^\s),.]*/gi, 'Vector Embedding Index')
    .replace(/gemini-[a-z0-9._-]+/gi, 'Clinical GenAI Engine')
    .replace(/GEMINI_API_KEY/g, 'AI service configuration')
    .replace(/\bnon-?gemini\b/gi, 'rule-based')
    .replace(/\bgemini\b/gi, 'Clinical AI')
}

