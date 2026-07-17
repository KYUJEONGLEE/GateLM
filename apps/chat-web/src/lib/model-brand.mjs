const MODEL_BRANDS = Object.freeze({
  claude: Object.freeze({ key: 'claude', logoSrc: '/claude-provider-icon.svg' }),
  gemini: Object.freeze({ key: 'gemini', logoSrc: '/gemini-provider-icon.webp' }),
  openai: Object.freeze({ key: 'openai', logoSrc: '/openai-streamline.png' }),
});

export function getModelBrand(modelKey) {
  if (typeof modelKey !== 'string') return null;

  const normalized = modelKey.trim().toLowerCase();
  const modelName = normalized.slice(normalized.lastIndexOf(':') + 1);

  if (modelName.includes('gemini')) return MODEL_BRANDS.gemini;
  if (modelName.includes('claude')) return MODEL_BRANDS.claude;
  if (/^(?:chatgpt|gpt)(?:[-._]|$)/.test(modelName)) return MODEL_BRANDS.openai;
  if (/^o[134](?:[-._]|$)/.test(modelName)) return MODEL_BRANDS.openai;

  return null;
}
