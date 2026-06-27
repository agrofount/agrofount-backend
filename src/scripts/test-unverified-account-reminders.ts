import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { NotificationTriggersJob } from '../notification/jobs/notification-triggers.job';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const job = app.get(NotificationTriggersJob);

  // edopolo@yopmail.com (f5450a7e) — email user
  // ajibade2@yopmail.com (9d24b24e) — email user (no phone-only unverified accounts exist)
  const userIds = [
    'f5450a7e-687d-4931-8f99-887a9ac61afa',
    '9d24b24e-6be7-4551-a2d7-8fbed0e90565',
  ];

  console.log('Sending unverified account reminders for:', userIds);
  const result = await job.sendUnverifiedReminderForUsers(userIds);
  console.log('Result:', result);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
