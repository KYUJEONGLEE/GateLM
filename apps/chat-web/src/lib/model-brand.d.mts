export type ModelBrand = Readonly<{
  key: 'claude' | 'gemini' | 'openai';
  logoSrc: string;
}>;

export declare function getModelBrand(modelKey: string | null | undefined): ModelBrand | null;
