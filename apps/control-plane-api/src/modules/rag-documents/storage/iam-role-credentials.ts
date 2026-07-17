import {
  fromContainerMetadata,
  fromInstanceMetadata,
  fromTokenFile,
} from '@aws-sdk/credential-providers';

type IamRoleCredentialProvider = ReturnType<typeof fromContainerMetadata>;
type CredentialFactories = Readonly<{
  container: typeof fromContainerMetadata;
  instance: typeof fromInstanceMetadata;
  webIdentity: typeof fromTokenFile;
}>;

const defaultFactories: CredentialFactories = {
  container: fromContainerMetadata,
  instance: fromInstanceMetadata,
  webIdentity: fromTokenFile,
};

export function createIamRoleCredentialProvider(
  env: Readonly<Record<string, string | undefined>>,
  region: string,
  factories: CredentialFactories = defaultFactories,
): IamRoleCredentialProvider {
  const tokenFile = env.AWS_WEB_IDENTITY_TOKEN_FILE?.trim();
  const roleArn = env.AWS_ROLE_ARN?.trim();
  if (tokenFile || roleArn) {
    if (!tokenFile || !roleArn) {
      throw new Error('RAG IAM role credential configuration is incomplete');
    }
    return factories.webIdentity({
      clientConfig: { region },
      roleArn,
      webIdentityTokenFile: tokenFile,
    });
  }

  if (
    env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI?.trim() ||
    env.AWS_CONTAINER_CREDENTIALS_FULL_URI?.trim()
  ) {
    return factories.container({ maxRetries: 2, timeout: 1_000 });
  }

  // EC2 IMDS is the only fallback. The default Node chain is intentionally
  // excluded so shared files, profiles, credential_process and static env
  // credentials cannot silently become production RAG credentials.
  return factories.instance({ maxRetries: 2, timeout: 1_000 });
}
