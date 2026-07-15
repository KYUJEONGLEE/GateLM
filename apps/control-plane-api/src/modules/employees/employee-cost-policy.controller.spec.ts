import { EmployeeCostPolicyController } from './employee-cost-policy.controller';
import { EmployeeCostPolicyService } from './employee-cost-policy.service';

const tenantId = '00000000-0000-4000-8000-000000000100';
const employeeId = '00000000-0000-4000-8000-000000000101';
const adminUserId = '00000000-0000-4000-8000-000000000102';

describe('EmployeeCostPolicyController', () => {
  it('passes the tenant-scoped batch read through to the service', async () => {
    const response = { data: [], pagination: { hasMore: false, limit: 25 } };
    const service = {
      list: jest.fn().mockResolvedValue(response),
    } as unknown as EmployeeCostPolicyService;
    const controller = new EmployeeCostPolicyController(service);

    await expect(controller.list(tenantId, { limit: 25 })).resolves.toBe(response);
    expect(service.list).toHaveBeenCalledWith(tenantId, { limit: 25 });
  });

  it('takes the audit actor from authenticated admin context', async () => {
    const policy = {
      createdAt: null,
      currency: 'USD' as const,
      daily: { enabled: false, limitMicroUsd: 0 },
      employeeId,
      enforcementMode: 'monitor' as const,
      periodTimezone: 'Asia/Seoul',
      tenantId,
      updatedAt: null,
      updatedBy: null,
      version: 0,
      warningThresholdPercent: 80,
      weekly: { enabled: false, limitMicroUsd: 0 },
    };
    const service = {
      update: jest.fn().mockResolvedValue(policy),
    } as unknown as EmployeeCostPolicyService;
    const controller = new EmployeeCostPolicyController(service);
    const body = {
      daily: { enabled: false, limitMicroUsd: 0 },
      enforcementMode: 'monitor' as const,
      expectedVersion: 0,
      warningThresholdPercent: 80,
      weekly: { enabled: false, limitMicroUsd: 0 },
    };

    await expect(
      controller.update(tenantId, employeeId, body, adminUserId),
    ).resolves.toEqual({ data: policy });
    expect(service.update).toHaveBeenCalledWith({
      body,
      employeeId,
      tenantId,
      updatedBy: adminUserId,
    });
  });
});
