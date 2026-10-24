// Import this before anything that loads AppModule. ConfigModule snapshots the
// environment when the module file is first imported, so values pinned later
// would be ignored. The developer .env can carry these two settings and they
// change order totals and payment instructions.
process.env.DELIVERY_FEE_ENABLED = 'true';
process.env.BANK_ACCOUNTS = '';

export {};
