// Import this before anything that loads the app. src/config/sms.config.ts
// reads SMS_PROVIDER at import time (and loads the developer's .env), so pin
// the provider to Termii to keep the SMS assertions deterministic.
process.env.SMS_PROVIDER = 'termii';

// The cron monitor falls back to a hard-coded ops phone when this is unset.
// Point it at an obviously fake number so summaries never use the default.
process.env.CRON_SUMMARY_ADMIN_PHONE = '2340000000000';
