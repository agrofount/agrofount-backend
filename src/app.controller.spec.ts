import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController health endpoints', () => {
  const dataSource = { query: jest.fn().mockResolvedValue([{ one: 1 }]) };
  const cache = {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue('ok'),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new AppController(
    new AppService(),
    dataSource as any,
    cache as any,
  );

  it('keeps liveness independent of downstream dependencies', () => {
    expect(controller.livenessCheck().status).toBe('ok');
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('checks database and cache for readiness', async () => {
    await expect(controller.readinessCheck()).resolves.toMatchObject({
      status: 'ok',
    });
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
  });
});
