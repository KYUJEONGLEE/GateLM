import { resolve } from 'node:path';

import { controlPlaneEnvFilePaths } from './env-file-paths';

describe('controlPlaneEnvFilePaths', () => {
  it('keeps app-local env before repository root env', () => {
    expect(controlPlaneEnvFilePaths().slice(0, 2)).toEqual([
      resolve(__dirname, '../../.env'),
      resolve(__dirname, '../../../../.env'),
    ]);
  });

  it('includes the current working directory env file as a fallback', () => {
    expect(controlPlaneEnvFilePaths()).toContain(resolve(process.cwd(), '.env'));
  });

  it('deduplicates env file paths', () => {
    const paths = controlPlaneEnvFilePaths();

    expect(paths).toHaveLength(new Set(paths).size);
  });
});
