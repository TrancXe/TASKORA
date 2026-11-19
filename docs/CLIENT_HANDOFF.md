# TASKORA — Client handoff checklist

## Before the client demo
- [ ] Open the app in local demo mode.
- [ ] Show task creation/editing, project board, calendar, focus timer, reports and themes.
- [ ] Explain that demo data is browser-local and is not a real customer account.
- [ ] Keep `.env`, Supabase service-role keys and Khalti keys out of the ZIP/Git repository.

## Before a real customer pilot
- [ ] Client/business owns the Supabase project and domain.
- [ ] Run `supabase/schema.sql` and verify RLS isolation with two test accounts.
- [ ] Set email confirmation, password reset and redirect URLs.
- [ ] Configure the Node API and server-side environment secrets.
- [ ] Configure an approved Khalti sandbox merchant account and test all payment outcomes.
- [ ] Verify paid access only after server-side lookup returns `Completed` and the exact expected amount.
- [ ] Confirm Pro expiry, manual renewal, and customer support handling.

## Before production sales
- [ ] Obtain the client's written approval for prices, plan limits and product claims.
- [ ] Publish privacy policy, terms, refund/cancellation policy and support details.
- [ ] Confirm data deletion/export process and retention requirements.
- [ ] Obtain merchant approval and live credentials from the payment provider.
- [ ] Deploy over HTTPS, set exact allowed origins, and test production callbacks.
- [ ] Add automated backups, uptime/error monitoring, security review and accessibility tests.
- [ ] Agree in writing on source-code ownership, future maintenance, hosting costs and support scope.

## Scope not included in this starter
- Automatic recurring billing, refunds, invoices/tax calculations and chargeback workflows.
- Team workspaces, invitations, roles and shared task permissions.
- Attachments, file storage, subtasks, recurring tasks and project templates.
- Guaranteed background push reminders after the browser is closed.
- Full admin console, audit log, customer support console and automated test suite.

These should be quoted and scheduled as separate milestones rather than promised as already implemented.
