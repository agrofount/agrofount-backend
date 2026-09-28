import { ComplaintsService } from './complaints.service';
import { ComplaintStatus } from './entities/complaint.entity';

function setup(existing: any = null) {
  const orderRepo = { findOne: jest.fn().mockResolvedValue({ id: 'order-1' }) };
  const adminRepo = { findOne: jest.fn().mockResolvedValue({ id: 'admin-1' }) };
  const repo: any = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    findOne: jest.fn().mockResolvedValue(existing),
    count: jest.fn().mockResolvedValue(0),
  };
  repo.manager = {
    getRepository: jest.fn((entity) =>
      entity.name === 'OrderEntity' ? orderRepo : adminRepo,
    ),
  };
  return { service: new ComplaintsService(repo), repo, orderRepo, adminRepo };
}

describe('ComplaintsService', () => {
  it('files a complaint for the current user', async () => {
    const { service, repo } = setup();
    const complaint = await service.create({ id: 'user-1' } as any, {
      subject: 'Late delivery',
      description: 'My order arrived a week late',
    });
    expect(complaint).toMatchObject({
      subject: 'Late delivery',
      description: 'My order arrived a week late',
      user: { id: 'user-1' },
      order: null,
    });
    expect(repo.save).toHaveBeenCalled();
  });

  it('links the complaint to the caller-owned order when provided', async () => {
    const { service, orderRepo } = setup();
    await service.create({ id: 'user-1' } as any, {
      subject: 'Wrong item',
      description: 'Received the wrong product entirely',
      orderId: 'order-1',
    });
    expect(orderRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'order-1', user: { id: 'user-1' } },
    });
  });

  it('assigns an admin and marks the complaint resolved with a timestamp', async () => {
    const { service } = setup({
      id: 'c-1',
      status: ComplaintStatus.Open,
      resolvedAt: null,
    });
    const updated = await service.updateForAdmin('c-1', {
      status: ComplaintStatus.Resolved,
      assignedAdminId: 'admin-1',
      resolutionNotes: 'Refunded the customer',
    });
    expect(updated.status).toBe(ComplaintStatus.Resolved);
    expect(updated.assignedAdmin).toEqual({ id: 'admin-1' });
    expect(updated.resolutionNotes).toBe('Refunded the customer');
    expect(updated.resolvedAt).toBeInstanceOf(Date);
  });

  it('clears resolvedAt when a complaint is reopened', async () => {
    const { service } = setup({
      id: 'c-1',
      status: ComplaintStatus.Resolved,
      resolvedAt: new Date('2026-01-01'),
    });
    const updated = await service.updateForAdmin('c-1', {
      status: ComplaintStatus.Open,
    });
    expect(updated.resolvedAt).toBeNull();
  });

  it('reports whether a customer has an unresolved complaint', async () => {
    const { service, repo } = setup();
    repo.count.mockResolvedValue(1);
    await expect(service.hasUnresolvedComplaint('user-1')).resolves.toBe(true);
  });
});
