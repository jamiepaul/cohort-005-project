# Does Knock fit Cadence, and what are its limits?

Research for issue #2 (map: #1, in-app and email notifications). Sources were read on 2026-11-13. Claims I could not confirm from a primary source are marked **Unconfirmed**.

## Answer

Knock fits. Its in-app feed, real-time updates, batching, per-workflow and per-channel preferences, Postmark email channel, server-signed user tokens and sandbox mode cover what Cadence needs. The free plan includes every feature Cadence needs, but it is likely to run out of messages as Cadence grows. The next plan up costs a flat $250/month.

There are two gaps that the other tickets must design around:

1. **One-click unsubscribe is all-or-nothing and only for "commercial" messages.** Knock's built-in one-click unsubscribe sets a single `commercial_subscribed = false` flag. It does not unsubscribe a user from one notification kind. Per-kind one-click email unsubscribe needs Cadence's own endpoint plus custom `List-Unsubscribe` headers sent through Postmark. Whether Knock passes those headers through to Postmark is unconfirmed.
2. **Batch emails render at most 10 items on non-Enterprise plans.** Batching works on every plan, but a batch email can show only the first or last 10 activities. `total_activities` still counts all of them. Fixed-schedule (daily or weekly) digests are not what the batch step is for. Knock recommends building them from Cadence's own data.

## Pricing and limits at small scale

Source: <https://knock.app/pricing>, <https://docs.knock.app/manage-your-account/knock-plans>

| | Free | Starter | Enterprise |
|---|---|---|---|
| Price | $0/mo | $250/mo + usage | Custom |
| Messages | 10,000/mo | 50,000 included, then $0.005 each | Volume-based |
| Stored profiles (users) | Unlimited | Unlimited | Unlimited |
| Log retention | 30 days | 30 days | 90 days |

- **What counts as a message:** one notification delivered to one user on one channel. A workflow that sends in-app and email counts as **2 messages**. Steps skipped because of preferences are not billed, and neither are sandboxed or test-run messages. Messages that pass a channel condition may count. (knock-plans page)
- **Free plan overage:** "We don't hard cap your messages." Knock contacts you about billing when you go over. (pricing FAQ)
- **On every plan:** batching, preferences, in-app feeds, the feed API, unlimited channels, environments, and team members.
- **Starter and up only:** removing Knock branding, and email client previews. Free emails or feeds show Knock branding. **Unconfirmed:** exactly where the branding appears.
- **Enterprise only:** per-tenant preferences and branding, translations, batch render limit above 10, and SAML SSO and audit logs.
- **Rough scale check (my own arithmetic):** 10,000 messages is about 5,000 in-app + email notifications a month, or about 165 a day. Batching Instructor comment activity lowers the count, because one batch produces one delivery per channel. **Unconfirmed:** the docs do not state outright how batches are billed. This follows from the "one delivery to one user on one channel" definition.
- **API rate limits:** each endpoint has a tier: 1, 5, 60, 200 or 1,000 requests per second. The workflow trigger endpoint is tier 5. Limits apply per endpoint, per environment. (<https://docs.knock.app/api-reference/overview/rate-limits>, <https://docs.knock.app/api-reference/workflows/trigger>)
- **Idempotency:** `POST /v1/workflows/:key/trigger` accepts an `Idempotency-Key` header of up to 255 characters, kept for 24 hours. It is the only endpoint that does. (<https://docs.knock.app/api-reference/overview/idempotent-requests>)

## In-app feed and real-time

Sources: <https://docs.knock.app/in-app-ui/react/overview>, <https://docs.knock.app/in-app-ui/react/feed>

- **Packages:** `@knocklabs/react` provides the components: `KnockProvider`, `KnockFeedProvider`, `NotificationFeedPopover`, `NotificationFeed` and `NotificationIconButton`. It also has headless hooks (`useNotifications` and others) for building your own UI. It supports React 17, 18 and 19 (`packages/react/package.json`, v0.15.1, <https://github.com/knocklabs/javascript>).
- **Real-time:** the feed updates over a socket. `auto_manage_socket_connection` disconnects inactive tabs. Cross-tab sync is experimental.
- **Read and seen state:** by default, opening the popover marks items as seen. The badge can count unread items instead (`badgeCountType="unread"`).
- **Styling:** importing `@knocklabs/react/dist/index.css` is required unless you override the styles.

## Batching and digests

Source: <https://docs.knock.app/designing-workflows/batch-function>

- **Windows:** fixed or sliding. A sliding window has a max-extension cap, and no batch stays open longer than 90 days.
- **Grouping:** batches are per recipient by default. An optional batch key groups them further, for example by Lesson or course: `{{data.lesson_id}}`.
- **Max activities:** a batch closes when it reaches its limit, which can be set from 2 to 1000.
- **Render limit:** 10 for `activities` and `actors`. Raising it to 100 is Enterprise only. **This matters for Instructor digests.** The email shows 10 comments, then "and N more".
- **Fixed-schedule digests:** batching is "not well-suited" for regular daily or weekly digests. For those, Knock recommends treating your own system as the source of truth for events at send time.

## Preferences and unsubscribe

Sources: <https://docs.knock.app/preferences/overview>, <https://docs.knock.app/preferences/hosted-preference-center>, <https://docs.knock.app/preferences/commercial-unsubscribe>

- **Preference model:** a `PreferenceSet` has `workflows`, `categories`, `channel_types` and `channels` keys. Every key defaults to `true`, meaning opted in.
  - Per-kind, per-channel settings are supported. A workflow entry can carry its own `channel_types`. **Unconfirmed:** the exact nested shape. The overview page lists the keys, and the API reference holds the nested form.
  - A channel preference overrides a channel-type preference.
  - Environment-level defaults can be set, which helps with rollout defaults.
- **Preference center:** you can build your own with the preferences API, or use Knock's hosted page.
  - The hosted page is reached through `{{vars.manage_preferences_url}}`. It is a signed link that never expires, and no login is needed.
  - It covers user preferences only.
  - **Unconfirmed:** whether the hosted page or a custom domain is plan-gated.
- **One-click unsubscribe:**
  - It is tied to marking a workflow "Commercial". Knock "adds required unsubscribe headers". The docs do not name `List-Unsubscribe` or `List-Unsubscribe-Post` (RFC 8058).
  - Clicking it sets `commercial_subscribed = false` on the user's default set. The user then gets no commercial messages but still gets transactional ones.
  - It does not unsubscribe from a single notification kind.
  - **Unconfirmed:** whether non-commercial workflow emails get any unsubscribe headers at all.
- **Per-kind one-click unsubscribe (proposed workaround):**
  1. Cadence hosts its own `POST /unsubscribe?token=…` endpoint. It verifies a signed token and calls Knock's set-preferences API to switch off `workflows.<kind>.channel_types.email`.
  2. The `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers are added through the Postmark channel's payload override, which "merges JSON into the request sent to Postmark".
  - Postmark's API accepts a `Headers` array and sends unsubscribe headers on transactional streams if you supply them (<https://postmarkapp.com/support/article/1299-how-to-include-a-list-unsubscribe-header>).
  - **Unconfirmed:** that a Knock payload override can set `Headers`, and that Liquid works inside it so the link can be per-recipient. Check this in a Knock development environment.

## User identity sync

Source: <https://docs.knock.app/managing-recipients/identifying-recipients>

- **Upserts:** `PUT /v1/users/{id}` and bulk `POST /v1/users/bulk/identify` add or update users. You can also identify users inline in the workflow trigger.
- **Required fields:** only `id` is required. Email delivery needs `email`. Use Cadence's user id as the Knock id.
- **Custom properties:** capped at 256 kB per user.
- **Backfill:** bulk identify covers existing users. Bulk preference updates take up to 1,000 users per job.
- **Not checked:** deleting users and GDPR erasure.

## Fit with React Router 8 SSR

- **Server side:** `@knocklabs/node` (latest release v1.41.1, <https://github.com/knocklabs/knock-node>) triggers workflows and identifies users from loaders and actions or a `*.server.ts` module.
  - **Enhanced security mode** should be on in production. Without it, anyone with the public key can read any feed.
  - In that mode, the server signs an RS256 JWT for the session user with `signUserToken` from `@knocklabs/node/lib/tokenSigner`. The key comes from `KNOCK_SIGNING_KEY`, and tokens last 3600 s by default.
  - Return the token from the root loader and pass it to `KnockProvider userToken`. Clients can refresh it through `onUserTokenExpiring`. (<https://docs.knock.app/in-app-ui/security-and-authentication>)
- **Client side:** `@knocklabs/react` starts with `"use client"` (`packages/react/src/index.ts`) and opens sockets in the browser. The plan is to render the bell and feed client-side only, for example with a lazy or client-only wrapper, so SSR stays clean.
  - **Unconfirmed:** Knock publishes no React Router or Remix guide. Whether it SSR-renders safely without a wrapper was not tested.

## Email via Postmark

Source: <https://docs.knock.app/integrations/email/postmark>

- **Setup:** add Postmark as a Knock email channel in each environment. It needs the Postmark server API key and a From address, which can use Liquid. Optional fields cover From name, Reply-to, Cc and Bcc, and payload overrides.
- **Message stream:** there is no stream field. Postmark's transactional `outbound` stream is the default. Choose another stream with the payload override `{"MessageStream": "…"}`. A separate stream or server for notifications would keep their reputation and stats apart from refund and receipt mail.
- **Delivery webhooks:** an optional Postmark webhook sends delivered, bounced and spam-complaint events back to Knock.
- **Tracking:** open and link tracking are available through Knock or Postmark.
- **Existing mail:** `app/lib/mailer.server.ts` stays as is. Knock calls Postmark directly, so notification email never goes through Cadence's mailer.

## Local dev and test story

Sources: <https://docs.knock.app/version-control/environments>, <https://docs.knock.app/send-notifications/testing-workflows>, <https://docs.knock.app/manage-your-account/knock-plans>

- **Environments:** each one (Development, Production, and optional others such as Staging) has its own API keys, channel credentials, users, and messages.
  - Workflows are committed in Development and promoted to Production.
  - Enabling environments cannot be undone. They are included on every plan.
- **No live sends:**
  - Put the email channel in **sandbox mode** in Development. Messages are rendered for preview but not delivered, and are not billed.
  - Triggers can also pass `settings.sandbox_mode: true` and `settings.skip_delay: true` for one run.
  - **The in-app channel has no sandbox mode.** In-app messages in Development are real feed items, and they count toward usage.
- **DevUI user switching:**
  - Seeded users must be identified in the Knock Development environment. A seed step could bulk-identify them.
  - The root loader signs a token for whichever user the DevUI has selected, so switching users switches the feed.
  - This needs network access to Knock during local dev. There is no offline Knock emulator.
- **Automated tests:** Knock offers no mocking or CI guidance. The likely pattern is a thin `notifier.server.ts` wrapper with a fake in tests, similar to `.outbox/`, so `npm run test` never calls Knock.

## Alternatives

| | Knock | Novu | MagicBell |
|---|---|---|---|
| Free tier | 10k messages/mo | 10k workflow runs/mo, 5 workflows, 24 h activity retention | 1k deliveries/mo, 1 project |
| First paid tier | $250/mo, 50k messages, $0.005 after | Pro from $30/mo, 30k runs, $1.20/1k after. Team from $250 | Startup $249/mo, 50k deliveries, $0.0025 after |
| Postmark | Yes, first-class | Yes (API key + From) | **Not listed.** Providers are SES, Mailgun, Ping Email, SMTP and SendGrid. Postmark SMTP may work (unconfirmed) |
| Batching/digests | Batch step (fixed/sliding, key, 2–1000), render 10 (non-Ent) | Digest step, regular **and scheduled** (daily/weekly in subscriber's time zone). Window max: Free 1 day, Pro 7 days, Team 30 days | **Unconfirmed**, no digest docs found |
| Preferences | Workflow/category/channel-type/channel, hosted page | Global + per-workflow channel prefs, in `<Inbox />` UI. "Critical" workflows bypass | Per category × channel |
| One-click unsubscribe | Commercial only (global flag) | **Unconfirmed**, not on the preferences page | **Unconfirmed** |
| React in-app | `@knocklabs/react`, signed JWT | `@novu/react` `<Inbox />`, HMAC subscriber hash | `@magicbell/react` components |
| Self-host | No | Enterprise only | No |

Sources:

- Novu: <https://novu.co/pricing>, <https://docs.novu.co/platform/integrations/email/postmark>, <https://docs.novu.co/platform/workflow/add-and-configure-steps/configure-action-steps/digest>, <https://docs.novu.co/platform/concepts/preferences>, <https://docs.novu.co/platform/inbox/overview>
- MagicBell: <https://www.magicbell.com/pricing>, <https://www.magicbell.com/docs>, <https://www.magicbell.com/docs/channels/in_app>

**How they compare:**

- **Novu** is the real alternative. It is much cheaper to start ($30/mo), has scheduled digests built in, and ships a preferences UI inside its Inbox component.
  - It has a 5-workflow cap on Free and 20 on Pro.
  - Its free activity log is kept for only 24 hours, and its free digest window is capped at 1 day.
- **MagicBell** is the weakest fit. It has no Postmark integration listed, no digest docs were found, and its free tier is small.
- **Knock** has the most mature batching and preference model, plus a first-class Postmark channel. It costs more once Cadence outgrows the free plan.

## Open risks

1. **Per-kind one-click unsubscribe depends on unconfirmed header passthrough** (Knock payload override → Postmark `Headers`). Spike this first. Fallback: an unsubscribe link in the email body to a Cadence page, with no RFC 8058 header.
2. **Batch render limit of 10.** The Instructor digest design must accept "10 shown + N more".
3. **Daily or weekly digests** do not fit the batch step. If they are wanted, Cadence must build them (cron + query) or choose Novu.
4. **The free plan runs out quickly.** In-app + email counts as 2 messages. The jump to $250/mo is a step cost.
5. **In-app has no sandbox.** Dev and test feed messages are real and billed. Automated tests need a fake.
6. **Branding on the free plan.** Where it appears is unconfirmed.
7. **No React Router guide.** The SSR integration is an assumption, so render the feed client-only.
