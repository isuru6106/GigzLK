# Browser authentication delivery protocol

Status: PROPOSED - not approved or implemented

Owners: Members 1 and 2

Infrastructure/security reviewer: Member 4

## Purpose

Choose a browser credential-delivery protocol that prevents delayed
responses from restoring an older authenticated state.

This proposal evaluates an opaque BFF context cookie with authoritative
server-side session selection.

It changes the existing browser access/refresh cookie contract and
credential-storage boundary. Explicit joint acceptance is required.

## Proposed architecture

The browser holds an opaque HttpOnly BFF context cookie.

Access and refresh credentials remain server-side. The browser does not
receive rotating access or refresh cookies under this alternative.

The BFF resolves the context against shared authoritative storage.
It never selects credentials solely from a browser-supplied generation,
attempt identifier, account ID or cached response.

Every authenticated context must trace to successful Auth authentication.
An anonymous or recovery context never grants account access.

## Contexts and fixation protection

Separate anonymous/recovery contexts from authenticated contexts.

Successful authentication must create a fresh authenticated identifier
using at least 256 bits of cryptographically secure randomness.

Never upgrade a known anonymous identifier into an authenticated session.
Never accept context identifiers in URLs or browser request bodies.

Production cookies are Secure, HttpOnly, host-only, Path=/ and SameSite=Lax.
Exact names and development behavior require Member 1 agreement.

Store hashes of bearer identifiers for lookup rather than raw bearers.
Reconciliation records use internal record IDs, never raw cookie bearers.

## Concurrent bootstrap

Bootstrap creates anonymous contexts only and never changes an existing
authenticated context into an anonymous one.

Use separate anonymous and authenticated cookie names under this proposal,
so delayed anonymous bootstrap cannot overwrite the authenticated cookie.

Reuse an existing valid anonymous context without reissuing its cookie.

Concurrent requests without a valid anonymous cookie create independent
contexts. Bootstrap must not invalidate other contexts.

Before login reservation, the BFF validates supplied CSRF state against
the anonymous cookie actually received.

A mismatch returns proposed 409 CONTEXT_CHANGED, with no Auth admission,
password verification or authenticated-cookie changes. The UI discards
the password and offers an explicit restart.

Concurrent bootstrap responses may still overwrite anonymous cookies.
Lost or mismatched binding must not fall back to another context.

How recovery survives delayed bootstrap and browser reload remains OPEN.

## Authentication-boundary rotation

A successful login creates a fresh authenticated context.

Before emitting an authenticated cookie, persist its context and selected
Auth session in shared authoritative storage.

Changing accounts, explicit recovery and logout must fence earlier
operations within their demonstrated authorization boundary.

Rotation alone does not solve delayed Set-Cookie responses.
A late response may replace the browser cookie with an older identifier.

A superseded identifier must be unusable. Never alias an old bearer to a
newer authenticated context.

An unusable late cookie may cause loss of availability and require
sign-in. This proposal does not promise uninterrupted login.

## Critical unresolved ordering requirement

Invalidating an older context requires trustworthy evidence that the old
and new contexts belong to a flow over which the caller has authority.

Independent anonymous contexts are not assumed to share one trusted flow.

An anonymous bearer known before login must never become a persistent
capability to select or retrieve later authenticated credentials.

Before acceptance, specify:

- What proof survives concurrent bootstrap and browser reload.
- How that proof is established and validated.
- Which operations it authorizes.
- How distinct tabs and BFF replicas use it.
- How competing contexts are linked or explicitly kept separate.
- How newer authorized operations fence older activation or responses.
- How lost-cookie recovery preserves authorization.
- Why anonymous or recovery capabilities cannot authenticate.
- How cancellation and supersession permissions prevent denial-of-service
  or unauthorized account switching.

A generation counter is useful only after this binding is established.

Without a solution, independent-context logins could both create valid
bearers and delayed delivery could restore an older authenticated state.

Browser locks, disabled buttons and process-local coordination do not
establish the required guarantee.

Flow binding, bootstrap recovery and cross-context ordering remain OPEN.

## Authoritative credential selection

For every protected request, resolve the authenticated context through
shared authoritative storage.

Check state, expiry, selected Auth session and applicable generation.

A superseded, cancelled, logged-out or expired context cannot select
credentials.

State-store or required-key failures deny access with an operational
error. Never fall back to stale process-local credentials.

Domain authorization and Auth current-state checks remain separate.
Stored credential selection does not prove current account eligibility.

## Proposed storage boundary

Member 1 owns BFF context management and browser response mapping.
Member 2 owns Auth sessions and credential issuance.

Recoverable BFF access/refresh credential storage is a new responsibility
requiring explicit Members 1/2 agreement and Member 4 review.

Approval of earlier Auth-only response retention does not transfer to
BFF credential retention.

If adopted:

- Use shared, access-controlled authoritative storage.
- Encrypt credentials using authenticated encryption.
- Use dedicated, versioned runtime encryption keys.
- Separate encryption keys from signing and service-assertion keys.
- Bind ciphertext to context, audience, session, generation and expiry.
- Enforce expiry on reads independently of cleanup.
- Define key rotation, key loss, backups, restore and deletion.
- Exclude plaintext credentials from logs, traces and general-purpose
  caches.

No BFF credential store is approved by this document.

## Consolidated transition and failure review

All states, transitions, ownership assignments and limits below remain
PROPOSED.

Member 1 confirmed consolidation accuracy and the stated cookie-expiry
and conditional-deletion proposals. Member 4 supports the security and
operational requirements as proposals.

These confirmations do not approve the delivery mechanism.

### Trust and authorization boundaries

A context is a server-created anonymous or authenticated record.
An attempt represents one explicit login operation.

Browser-supplied account IDs, attempt IDs, flow IDs or generations do not
establish authentication or transition authority.

Browser mutations require validated context binding, context-bound CSRF
protection and exact-Origin validation.

Auth requests additionally require independently authenticated BFF identity
and operation permissions.

Service assertions do not replace audience, context or attempt binding.

An anonymous or recovery capability cannot select authenticated
credentials. Cancellation, fencing and supersession also require explicit
authorization.

### Proposed state vocabulary

These names describe review semantics, not an accepted database schema.

| Record | Proposed states |
| --- | --- |
| BFF operation | PENDING, ACTIVATED, FENCED, CLOSED |
| Authenticated BFF context | ACTIVE, DISABLED, EXPIRED |
| Auth attempt | ADMITTED, COMMITTED, REJECTED, EXPIRED, CANCELLED |
| Reconciliation work | PENDING, PROCESSING, CONFIRMED, ESCALATED |

Verification ownership is durable attempt metadata, not permission for
another worker to restart verification.

FENCED, DISABLED and EXPIRED records cannot return to authenticated use.
Reconciliation cannot authorize activation or credential replay.

### Proposed transition and commit table

Each transaction is local to its owning store.
Auth and BFF writes are not one atomic transaction.

| Step | Authorization and conditions | Durable transition / commit point | Proposed owner | Failure boundary |
| --- | --- | --- | --- | --- |
| Bootstrap | Server-created context; reuse an existing valid context | Create an independent anonymous context when needed; write only the anonymous cookie | Member 1 | Never invalidate other contexts or overwrite the authenticated cookie |
| B1: reserve | Valid original context, CSRF, exact Origin and login eligibility | Conditionally reserve one PENDING operation and persist its attempt ID before Auth calls | Member 1 | Losing submissions do not contact Auth or verify passwords; uncertain reservation does not authorize issuance |
| A1: admit | Permitted authenticated BFF; bound audience, operation, context and attempt; valid one-time admission authorization | Atomically consume authorization and create ADMITTED attempt | Member 2 | Same-binding duplicates may return safe metadata; no verification restart or deadline extension |
| A2: claim verification | Bound admitted attempt; eligible deadline; no cancellation; no existing verification owner | Conditionally record durable verification ownership before password verification | Member 2 | No implicit takeover or automatic verification retry |
| A3: issue | Verification owner; valid credentials; active verified account; unchanged credential version under account lock; eligible attempt | Atomically persist session, refresh hash and COMMITTED attempt/session association; signing failure aborts the transaction | Member 2 | Return the complete envelope only after confirmed commit; uncertain acknowledgement is an operational error |
| B2: activate | Valid complete envelope; same operation owner; eligible deadlines; no fence; authorized flow binding | Atomically persist encrypted credentials, fresh ACTIVE bearer record, attempt/session association and reconciliation tracking; operation becomes ACTIVATED | Member 1 | Emit cookie only after confirmed commit; uncertainty sends no cookie |
| B3: recover | Explicit recovery; original validated binding; CSRF, exact Origin and recovery deadline | Atomically FENCE operation, DISABLE associated contexts, conditionally delete associated ciphertext and persist reconciliation work before Auth calls | Member 1 | Failed or uncertain fencing cannot establish confirmed recovery |
| A4: cancel | Permitted authenticated BFF; original attempt binding; validated recovery authority | Lock attempt; CANCEL admitted work, or atomically revoke its associated session and CANCEL committed work | Member 2 | Late verification workers cannot commit; repeats require reviewed idempotent semantics |
| B4: disable | Authenticated bearer, CSRF, exact Origin and demonstrated association to affected operations | Atomically DISABLE selected context, FENCE authorized linked operations, conditionally delete associated ciphertext and persist revocation work | Member 1 | Unconfirmed commit means logout is uncertain |
| A5: revoke | Permitted authenticated BFF and authorized audience/session association | Durably revoke associated Auth session | Member 2 | Auth failure leaves revocation pending and cannot undo BFF disabling |
| Reconcile | Authorized worker; durable action/binding; conditional claim with fenced completion | Record confirmed outcome or preserve pending/escalated work | Member 1 against Member 2 contracts | Never activate a context, replay credentials or lift a fence |
| Restore | Controlled infrastructure recovery | Keep authentication unavailable until restored state is invalidated or reconciled against separately protected recovery authority | Members 1/2/4 | Old backups must not restore revoked access |

Atomic ciphertext deletion in B3/B4 depends on the reviewed reference-based
Auth cancellation/revocation contract described below.

A3 checks expiry using an authoritative database clock that advances
during the transaction, immediately before the conditional COMMITTED
transition. This does not guarantee the time of commit acknowledgement.

Lock ordering, isolation and conditional-update schemas require concrete
specification and testing.

Credential-version capture and locked comparison are implemented Auth
building blocks. Complete admission, issuance, cancellation and revocation
are not established by those building blocks.

### Proposed partial-failure outcomes

| Failure | Required proposed outcome |
| --- | --- |
| Auth commits; credentials never reach BFF | No BFF activation; explicit recovery resolves the bound attempt |
| Credentials arrive; BFF persistence fails | No cookie; reconcile/cancel the associated Auth attempt/session |
| BFF commit acknowledgement is lost | No cookie on uncertainty; resolve durable state without claiming rollback |
| BFF activates; browser misses cookie | Explicit recovery; no automatic credential replay |
| Durable disabling fails or is uncertain | Operational error; no successful-logout claim |
| BFF disabling succeeds; Auth revocation fails | Context stays disabled; Auth revocation pending |
| Credentials arrive after a fence | Reject activation and reconcile associated Auth session |
| Superseded cookie arrives late within an authorized flow | Disabled identifier cannot authenticate or alias newer credentials |
| Independent-context cookie arrives late | Ordering remains unresolved; cookie installation stays blocked |
| Required key or authoritative store unavailable | Deny credential selection; no stale-cache fallback |
| Admission not yet visible during recovery | Pending/unresolved; no confirmed cancellation or replacement issuance |
| Attempt metadata unknown or cleaned up | Unresolved; unknown does not mean cancelled or reusable |
| Reconciliation worker restarts | Resume durable work, preserve fences and use reviewed idempotent actions |
| Backup restoration | Keep authentication unavailable until restored contexts are invalidated or reconciled against separately protected recovery authority |

A COMMITTED attempt requires recovery even after issuance eligibility
expires. Expiry does not prove that no session was issued.

Attempt-state details are disclosed only after caller/context validation.
Browser responses expose only allowlisted fields needed for recovery.

### Explicit recovery

The UI offers:

"Cancel this sign-in attempt and start again."

Require original BFF identity, validated original context, CSRF protection,
exact Origin and the recovery deadline.

B3 must commit fencing and reconciliation work before external Auth calls.

Cancellation during password verification must durably reject late workers.
Cancellation after issuance revokes only the associated session.

Only confirmed cancellation and associated-session revocation permit
replacement issuance with freshly entered and verified credentials.

If admission is not visible, cancellation is uncertain or Auth is
unavailable, report:

"Sign-in recovery is pending."

Preserve fences and unrelated sessions. Do not authorize replacement
issuance while recovery remains unresolved.

Lost or unverifiable context remains unresolved.
Recovery writes no authentication cookie and retains no password.

### Browser delivery and logout

After confirmed B2, the UI obtains authoritative session state before
entering the authenticated application. Earlier UI responses are advisory.

Logout requires the authenticated bearer, CSRF protection and exact Origin.

B4 disables selected BFF access before external Auth revocation.
Only demonstrably authorized linked operations may be fenced.

| Confirmed state | Browser-safe meaning |
| --- | --- |
| B4 not confirmed | Logout outcome uncertain |
| B4 confirmed; Auth revocation unconfirmed | BFF access disabled; Auth revocation pending |
| B4 and Auth revocation confirmed | Logout complete for the associated context/session |

Under this proposal, logout sends no authenticated-cookie deletion or
replacement header. A disabled bearer may remain in the browser until
expiry or replacement by a later approved login.

This avoids delayed logout deletion erasing a newer login cookie.
It does not solve independent-context ordering or logout-all.

A late disabled cookie may cause loss of availability but cannot
authenticate or alias a newer context.

### Proposed cookie expiry and credential deletion

Authenticated cookies carry an absolute Expires value no later than the
linked Auth session's absolute deadline.

Delayed delivery cannot extend server-side validity.
Server-side expiry remains authoritative. Any additional cookie lifetime
attribute must not permit a later deadline.

Proposed ciphertext deletion is atomic with BFF fencing/disabling.

This depends on a reviewed Auth cancellation/revocation contract that:

- Uses bound audience and attempt/session references without requiring
  the user's access or refresh credential.
- Independently authenticates the BFF and validates its authority over
  the referenced audience and attempt/session.
- Provides idempotent cancellation/revocation semantics.
- Distinguishes confirmed revocation from unknown or unavailable state.
- Never treats possession of a reference as authorization.
- Prevents late issuance workers from bypassing attempt cancellation.

If issuance is uncertain, resolve the authorized attempt association
through the reviewed contract. Unknown references cannot establish
confirmed revocation.

Reconciliation retains only non-secret references and processing metadata.
It never retains raw access tokens, refresh tokens, cookie bearers or
passwords.

Until the contract is reviewed, the atomic-deletion rule remains
conditional. This does not authorize indefinite credential retention.

### Proposed expiry and retention

All limits remain proposals requiring review and boundary/failure testing.

| Record | Proposed expiry / retention | Owner to confirm |
| --- | --- | --- |
| Anonymous login context | 30-minute absolute login eligibility; recovery binding handled separately | Members 1/2 |
| Auth attempt | Five-minute issuance eligibility; fixed 24-hour browser-recovery window from admission; preserve associations required for unresolved reconciliation beyond that window | Members 2/4 |
| Authenticated BFF context | No later than linked Auth session absolute deadline; no sliding extension | Members 1/2 |
| Recoverable credentials | Usable only while context and credential deadlines permit; conditional atomic deletion on fencing/disabling; expiry cleanup within the bounds below | Members 1/4 |
| Disabled-context tombstone | Through latest possible associated session/cookie expiry plus proposed 24-hour margin | Members 1/4 |
| Unresolved reconciliation | Escalate after 24 hours; do not automatically delete unresolved work or lift fences | Members 2/4 |

The earlier "subject to reconciliation needs" credential-retention wording
is superseded by the conditional atomic-deletion and bounded expiry-cleanup
rules. It permits neither indefinite retention nor raw credentials in
reconciliation records.

The tombstone margin needs validation against cookie lifetimes, delayed
delivery and restore behavior.

Anonymous login eligibility must not silently shorten recovery binding.
How that binding survives bootstrap and reload remains OPEN.

Cleanup must not permit admission authorization or attempt reuse.

### Proposed operational cleanup and reconciliation requirements

These are proposed requirements, not implemented guarantees.

- Credential and context expiry block reads immediately.
- Delete each expired credential's ciphertext within a maximum of one
  hour after that credential expires.
- Delete expired access-token ciphertext independently of any still-valid
  refresh token.
- Context expiry requires ciphertext deletion within one hour, with any
  earlier credential-expiry cleanup deadline taking precedence.
- Fencing/disabling atomically deletes associated ciphertext, conditional
  on the reviewed Auth cancellation/revocation contract.
- Cleanup must be durable, restart-safe and coordinated across replicas.
- Monitor overdue ciphertext and alert on missed deadlines.
- Cleanup failure must never extend credential validity.

Member 4 supports the operational requirements as proposals.
Member 1 confirmed the proposed context-expiry deletion bound.

Preserve required non-secret associations and fences until reconciliation
is resolved. The 24-hour browser-recovery deadline must not erase pending
work or permit late issuance.

The durable retention/cleanup mechanism must prevent cancelled attempts
or consumed admission authorizations from becoming reusable.

Reconciliation stores internal context-record IDs, never raw cookie
bearers. Bearer lookup uses hashes. References alone grant no authority.

Backup retention is separate from operational ciphertext deletion and
remains OPEN.

### Proposed ownership

| Responsibility | Proposed owner |
| --- | --- |
| BFF context logic, schema/migrations, cookies and safe response mapping | Member 1 |
| Auth attempts, issuance, session state, cancellation and revocation | Member 2 |
| Infrastructure provisioning; encryption/key controls, retention and restore review | Member 4 |
| BFF reconciliation producer/worker | Member 1 against Member 2's reviewed idempotent Auth contracts |
| Cross-store failure and concurrency tests | Members 1/2, with Member 4 reviewing infrastructure failures |

BFF credential retention remains a new, unapproved responsibility.
This table does not approve a store or transfer earlier retention approval.

### Durable reconciliation requirements

Persist reconciliation work atomically with BFF fencing.

B1 must preserve enough durable identity to discover uncertain Auth
outcomes after a crash.

B2 must retain association/tracking sufficient for uncertain persistence
or browser delivery. B2 alone cannot cover failures before it commits.

Proposed work records contain:

- Operation ID, audience, internal context-record ID and generation.
- Auth attempt/session references when known.
- Requested action, processing state and outcome reference.
- Claim/version and timing information for cross-replica processing.

No raw credentials, cookie bearers or passwords belong in these records.

Worker claims and completion require durable conditional updates and
versioned claims that reject stale workers.

Expired claims cannot authorize activation or undo cancellation.
Exact leases, retry bounds, escalation handling and cleanup remain OPEN.

Business issuance is not automatically retried at the UI, BFF or gateway.
A fresh service assertion does not authorize another login attempt.

Cancellation, revocation and safe status retrieval require separately
reviewed retry semantics.

Resolve missing session references through authorized attempt association,
not browser-supplied guesses.

### Storage, keys and restore review

PostgreSQL is a suitable proposed store.

Separate marketplace/admin runtime roles require enforced data isolation.
The exact store, schema ownership, permissions and transaction rules must
be specified before implementation.

If BFF credential storage is accepted:

- Use shared authoritative storage with least-privilege runtime access.
- Use authenticated encryption and dedicated versioned runtime keys.
- Separate encryption keys from signing, assertion and other purposes.
- Bind ciphertext to context, audience, session, generation and expiry.
- Enforce context and credential expiry on reads independently of cleanup.
- Deny selection on missing keys, authentication-tag failure or unavailable
  authoritative state.
- Never fall back to stale credentials.
- Define key distribution, rotation, retirement and loss behavior.
- Define encrypted backup access, retention and deletion.
- Keep restored authentication unavailable until revoked access cannot
  be restored.

Recovery authority must be separately protected.
An epoch restored from the same old backup is insufficient protection.

Encryption details, key lifecycle, worker leases, retry bounds, backup
retention and restore authority remain OPEN and require concrete
specifications and tests.

### Refresh

Refresh credentials remain server-side under this alternative.

Refresh requires cross-replica atomic coordination and a reviewed Auth
rotation contract.

A stale result cannot replace newer selected credentials or reactivate
disabled contexts.

Stable cookies do not solve rotation concurrency, lost-response recovery
or reuse detection.

Refresh, logout-all and password-change revocation require separate
reviewed contracts and ordering rules.

## Browser responses and failures

Return only explicitly allowlisted browser-safe state.
Never return access or refresh credentials to browser JavaScript.

All authentication, bootstrap, recovery and logout responses require:

Cache-Control: no-store

Operational errors preserve unrelated existing cookies.
Uncertain activation must not install a new authenticated cookie.

Origin and CSRF validation remain mandatory for browser mutations.
Context cookies do not replace CSRF protection.

## Required tests before acceptance

- Concurrent anonymous bootstrap responses arriving in reverse order.
- Delayed bootstrap after successful authentication.
- Anonymous/recovery contexts cannot select authenticated credentials.
- Fresh authenticated bearer creation and fixation protection.
- Superseded identifiers cannot select or alias newer credentials.
- Concurrent logins across tabs and replicas.
- Older login responses arriving after newer login or logout.
- Reload during login and recovery.
- Auth commit followed by BFF storage failure.
- Lost acknowledgements at Auth, BFF storage and browser delivery.
- Recovery racing with persistence, activation and password verification.
- Logout racing with login and refresh.
- Disabled contexts remain unusable after delayed Set-Cookie.
- Cancellation and revocation authorization, idempotency and unknown states.
- Expiry boundaries and independent access/refresh ciphertext cleanup.
- Context-expiry cleanup within the proposed bound.
- Cleanup restart recovery, overdue alerts and missed deadlines.
- Pending reconciliation survives browser-recovery expiry.
- Admission consumption and attempt cleanup prevent reuse.
- Stale workers cannot complete transitions.
- Marketplace/admin runtime data isolation.
- State-store outages and stale-cache rejection.
- Encryption authentication, key rotation and key loss.
- Backup restoration cannot restore revoked access.
- No-store, safe response mapping and secret exclusion.

## Decision required

The following remain OPEN:

- Trusted flow-binding proof and its precise transition permissions.
- Concurrent-bootstrap and reload recovery.
- Cross-context ordering and supersession.
- Explicit acceptance of recoverable BFF credential storage.
- Concrete schemas, lock ordering and cross-replica conditional updates.
- Authorized idempotent Auth cancellation/revocation contracts.
- Reconciliation leases, retry bounds and durable retention rules.
- Encryption/key lifecycle, backup retention and restore authority.
- Tombstone bounds and cleanup safety.

Members 1 and 2 must select and demonstrate the flow-binding protocol.
Member 4 must review the concrete storage and operational specifications.

If the required properties cannot be demonstrated, revise or reject this
alternative rather than declaring ordering solved.

Documentation accuracy and support for requirements do not approve the
mechanism.

Cookie installation, login issuance, refresh and live integration remain
disconnected.