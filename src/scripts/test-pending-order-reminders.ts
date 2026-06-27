import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { NotificationTriggersJob } from '../notification/jobs/notification-triggers.job';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const job = app.get(NotificationTriggersJob);

  // Email user: ajala4@yopmail.com — order da95efab
  // Phone-only user: 2349019170273 — order e395a723
  const orderIds = [
    'da95efab-4e6b-41c9-a37f-f4458bba3f7a',
    'e395a723-0fb3-4630-b603-ef9a1fda7148',
  ];

  console.log('Sending pending order reminders for:', orderIds);
  const result = await job.sendReminderForOrders(orderIds);
  console.log('Result:', result);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
