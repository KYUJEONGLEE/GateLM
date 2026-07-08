import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const packageRoot = process.cwd();
const sourceSchemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');

function normalizeSchema(value) {
  return value.replace(/\r\n/g, '\n').trimEnd();
}

function runPrisma(args, options = {}) {
  return spawnSync('prisma', args, {
    cwd: packageRoot,
    shell: process.platform === 'win32',
    ...options,
  });
}

function readFormattedSourceSchema() {
  const tempDir = mkdtempSync(
    path.join(tmpdir(), 'gatelm-control-plane-prisma-'),
  );
  const tempSchemaPath = path.join(tempDir, 'schema.prisma');

  try {
    copyFileSync(sourceSchemaPath, tempSchemaPath);

    const result = runPrisma(['format', '--schema', tempSchemaPath], {
      encoding: 'utf8',
    });

    if (result.error) {
      throw new Error(`Failed to run prisma format: ${result.error.message}`);
    }

    if (result.status !== 0) {
      throw new Error(
        [
          'prisma format failed while checking generated client freshness.',
          result.stdout,
          result.stderr,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    return readFileSync(tempSchemaPath, 'utf8');
  } finally {
    if (tempDir.startsWith(tmpdir())) {
      rmSync(tempDir, { force: true, recursive: true });
    }
  }
}

function resolveGeneratedClientPath() {
  try {
    const requireFromPackage = createRequire(
      path.join(packageRoot, 'package.json'),
    );
    const clientPackageJson = requireFromPackage.resolve(
      '@prisma/client/package.json',
    );
    return path.resolve(
      path.dirname(clientPackageJson),
      '..',
      '..',
      '.prisma',
      'client',
    );
  } catch {
    return null;
  }
}

function getGenerateReason() {
  if (!existsSync(sourceSchemaPath)) {
    throw new Error(`Prisma schema not found at ${sourceSchemaPath}`);
  }

  const generatedClientPath = resolveGeneratedClientPath();
  if (!generatedClientPath) {
    return '@prisma/client is not installed';
  }

  const generatedSchemaPath = path.join(generatedClientPath, 'schema.prisma');
  const generatedTypesPath = path.join(generatedClientPath, 'index.d.ts');

  if (!existsSync(generatedSchemaPath) || !existsSync(generatedTypesPath)) {
    return 'Prisma client files are missing';
  }

  const sourceSchema = normalizeSchema(readFormattedSourceSchema());
  const generatedSchema = normalizeSchema(
    readFileSync(generatedSchemaPath, 'utf8'),
  );

  if (sourceSchema !== generatedSchema) {
    return 'Prisma schema changed since the client was generated';
  }

  return null;
}

const reason = getGenerateReason();

if (!reason) {
  console.log('[prisma] Client is up to date.');
  process.exit(0);
}

console.log(`[prisma] ${reason}; running prisma generate.`);

const result = runPrisma(['generate'], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[prisma] Failed to run prisma generate: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(
    '[prisma] prisma generate failed. On Windows, stop running Node dev servers if you see an EPERM rename error, then rerun the command.',
  );
  process.exit(result.status ?? 1);
}
