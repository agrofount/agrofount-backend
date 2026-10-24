## Summary

<!-- What changed and why. Link the ticket/issue if there is one. -->

## Test plan

- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm test` (relevant suites) or `npm run test:ci` (full suite)
- [ ] Manually verified against a running dev server where applicable

## Migrations

- [ ] No entity/schema changes in this PR
- [ ] Entity changes are covered by a generated migration (`npm run migration:generate`)
- [ ] `npm run migration:check` passes locally (CI's `check-migrations` job will also fail the build if an entity change has no matching migration)
- [ ] Migration is additive/backward-compatible, or any destructive step (column drop, rename, not-null backfill) is called out below

## Reviewer notes

- Breaking changes:
- New/changed env vars:
- Deployment steps beyond the normal `dev`/`main` auto-deploy (manual backfill, feature flag, cache clear, etc.):
