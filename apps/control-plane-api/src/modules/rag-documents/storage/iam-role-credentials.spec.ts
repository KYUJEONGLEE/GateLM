import type { fromContainerMetadata } from '@aws-sdk/credential-providers';

import { createIamRoleCredentialProvider } from './iam-role-credentials';

describe('RAG IAM-role credential selection', () => {
  const provider = jest.fn() as unknown as ReturnType<
    typeof fromContainerMetadata
  >;

  it('selects web identity, ECS, and EC2 role sources without the default chain', () => {
    const webIdentity = jest.fn().mockReturnValue(provider);
    const container = jest.fn().mockReturnValue(provider);
    const instance = jest.fn().mockReturnValue(provider);
    const factories = { webIdentity, container, instance };

    expect(
      createIamRoleCredentialProvider(
        {
          AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/rag',
          AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/secrets/token',
        },
        'ap-northeast-2',
        factories,
      ),
    ).toBe(provider);
    expect(webIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        clientConfig: { region: 'ap-northeast-2' },
      }),
    );

    createIamRoleCredentialProvider(
      { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/credentials/id' },
      'ap-northeast-2',
      factories,
    );
    expect(container).toHaveBeenCalledTimes(1);

    createIamRoleCredentialProvider({}, 'ap-northeast-2', factories);
    expect(instance).toHaveBeenCalledTimes(1);
  });

  it('fails fast for a partial IRSA configuration', () => {
    expect(() =>
      createIamRoleCredentialProvider(
        { AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/rag' },
        'ap-northeast-2',
      ),
    ).toThrow('RAG IAM role credential configuration is incomplete');
  });
});
