# Browser authentication delivery protocol

Status: PROPOSED — not approved or implemented

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
attempt identifier, account ID, or cached response.

Every authenticated context must trace to successful Auth authentication.
An anonymous or recovery context never grants account access.

## Contexts and fixation protection

Separate anonymous/recovery contexts from authenticated contexts.

Successful authentication must create a fresh authenticated identifier
using at least 256 bits of cryptographically secure randomness.

Never upgrade a known anonymous identifier into an authenticated session.
Never accept context identifiers in URLs or browser request bodies.

Production cookies are Secure, HttpOnly, host-only, Path=/, and SameSite=Lax.
Exact names and development behavior require Member 1 agreement.

Store a hash of each bearer identifier, rather than its raw value, wherever
lookup does not require recovering the identifier.

## Concurrent bootstrap

Bootstrap creates anonymous contexts only and never changes an existing
authenticated context into an anonymous one.

Prefer separate cookie names for anonymous and authenticated contexts so
a delayed anonymous bootstrap response cannot overwrite authentication.

Concurrent anonymous bootstrap responses may still overwrite one another.
Therefore an attempt must bind to its original context, and a mismatch must
produce an unresolved state rather than falling back to another context.

This fallback preserves binding but may interrupt recovery.
Members 1 and 2 must decide how reload recovery remains usable when
anonymous bootstrap responses arrive out of order.

Anonymous bootstrap must not invalidate other contexts merely because
another bootstrap response was generated.

## Authentication-boundary rotation

A successful login creates a fresh authenticated context.

Before any authenticated cookie response is emitted, record its context
and selected Auth session in shared authoritative storage.

Changing accounts, explicit recovery, and logout must fence earlier
operations so they cannot activate an obsolete context afterward.

Rotation alone does not solve delayed Set-Cookie responses.
A late response may still replace the browser cookie with an older
identifier.

The authoritative store must ensure any superseded identifier is unusable.
Do not alias an old bearer identifier to a newer authenticated context:
that would defeat the authentication-boundary rotation.

An unusable late cookie may cause loss of availability and require sign-in.
This proposal does not promise uninterrupted login.

## Critical unresolved ordering requirement

Invalidating an older context requires a trustworthy way to identify the
browser flow to which both old and new contexts belong.

An anonymous bearer known before login must not become a persistent
capability to select or retrieve later authenticated credentials.

Before acceptance, specify:
- The authoritative flow identity and its trust boundary.
- How distinct tabs and BFF replicas share that identity.
- How concurrent bootstrap establishes it safely.
- How a newer attempt fences an older response or activation.
- Why possession of the old anonymous context cannot authenticate.
- How reload and lost-cookie recovery preserve these properties.

A generation counter is useful only after this binding is established.
This document does not claim that this binding problem is solved.

## Authoritative credential selection

For every protected request, resolve the authenticated context through
shared server-side storage.

Check its state, expiry, selected Auth session, and applicable generation.
A superseded, cancelled, logged-out, or expired context cannot select
credentials.

State-store failures deny access with an operational error.
Do not fall back to credentials held in a process-local stale cache.

Domain authorization and Auth current-state checks remain separate.
Selecting a stored credential does not prove current account eligibility.

## Proposed storage boundary

Member 1 owns BFF context management and browser response mapping.
Member 2 owns Auth sessions and credential issuance.

This alternative may require the BFF to retain recoverable access and
refresh credentials. That is a new storage boundary requiring explicit
Members 1/2 agreement and Member 4 review.

If adopted:
- Use shared, access-controlled storage.
- Encrypt credentials using authenticated encryption.
- Use dedicated versioned runtime encryption keys.
- Bind ciphertext to context, audience, session, generation, and expiry.
- Enforce expiry on reads independently of cleanup.
- Define rotation, key loss, backups, restore, and deletion behavior.
- Exclude plaintext credentials from logs, traces, and general-purpose caches.

No BFF credential store is approved by this document.

## Auth-to-BFF delivery uncertainty

Auth commit and BFF credential persistence are separate operations.
A stable browser cookie does not make them one atomic transaction.

Specify behavior when:
- Auth commits but the BFF never receives the credentials.
- The BFF receives credentials but its storage write fails.
- BFF storage commits but its acknowledgement is lost.
- The browser never receives the authenticated context cookie.

Do not retry issuance or recreate credentials automatically.
Do not claim rollback without confirmed durable state.

Recovery must reconcile the bound Auth attempt and any associated BFF
context. It must not leave a context active after its session is cancelled.

## Explicit recovery

Recovery is an explicit CSRF-protected action with exact-Origin validation.

Require the original BFF identity and validated context binding.
Attempt identifiers and safe status responses never authenticate users.

Cancel the bound attempt and revoke only its associated session.
Fence corresponding BFF activations and disable associated contexts.

Require fresh credential entry after confirmed cancellation.
Retain no password for recovery.

Lost or unverifiable context produces an unresolved state.
Preserve unrelated sessions and cookies.

The cross-store cancellation order and partial-failure recovery require
a concrete protocol before implementation.

## Logout

Logout must first durably disable the selected BFF context and fence
pending activations for its flow.

Revoke the associated Auth session through its reviewed operation contract.

Clearing a browser cookie alone does not confirm server revocation.
An Auth storage failure must not be reported as confirmed Auth logout.

A late response may restore an old cookie value, but that context must
remain disabled and must not authenticate.

A fresh explicit login after logout requires a new authorized flow.
An old in-flight operation cannot reactivate a logged-out context.

Logout-all and password-change revocation require separate ordering rules.

## Refresh

Refresh credentials remain server-side under this alternative.

Refresh must use atomic coordination across BFF replicas and the reviewed
Auth rotation contract.

A stale refresh result cannot replace credentials selected by a newer
generation or reactivate a disabled context.

Stable browser cookies do not solve Auth refresh concurrency, lost-response
recovery, or reuse detection.

Refresh remains disconnected.

## Browser responses and failures

Return only explicitly allowlisted browser-safe state.
Never return access or refresh credentials to browser JavaScript.

All authentication, bootstrap, recovery, and logout responses require
Cache-Control: no-store.

Operational errors preserve unrelated existing cookies.
Do not install a new authenticated cookie on uncertain activation.

Origin and CSRF validation remain required for browser mutations.
A context cookie is not a substitute for CSRF protection.

## Required tests before acceptance

- Concurrent anonymous bootstrap responses arriving in reverse order.
- Delayed bootstrap arriving after successful authentication.
- Anonymous context cannot authenticate after login.
- Authentication creates a fresh bearer identifier.
- Superseded identifiers cannot select or alias newer credentials.
- Concurrent logins across tabs and BFF replicas.
- Older login response arriving after newer login or logout.
- Browser reload during login and recovery.
- Auth commit followed by BFF storage failure.
- Lost acknowledgement at Auth, BFF storage, and browser delivery.
- Recovery racing with credential persistence and context activation.
- Logout racing with login and refresh.
- Disabled contexts remain unusable after delayed Set-Cookie.
- State-store outages and stale-cache rejection.
- Encryption expiry, key rotation, key loss, and backup restoration.
- No-store, safe response mapping, and secret exclusion.

## Decision required

Members 1 and 2 must select and specify the flow-binding and delivery
protocol, including its availability tradeoffs.

Member 4 must review storage ownership, encryption, runtime keys,
deployment coordination, and recovery procedures.

If these properties cannot be demonstrated, revise or reject this
alternative rather than declaring ordering solved.

Cookie installation, login issuance, refresh, and live integration remain
disconnected.

## Consolidated transition and failure review

Status: PROPOSED - not approved or implemented.

This section consolidates Member 1's discussion sequences and Member 2's
proposed Auth mapping for Member 4 review. It refines the procedural
sections above without resolving the architecture's acceptance blockers.

All states, transitions, ownership assignments and retention limits below
remain proposed. Existing issuance-direction acceptance and support for
security requirements do not approve this delivery mechanism.

### Trust and authorization boundaries

A context is a server-created anonymous or authenticated record.
An attempt represents one explicit login operation.

Independent anonymous contexts are not assumed to belong to one trusted
browser flow. A browser-supplied flow ID, account ID, attempt ID or
generation cannot establish that relationship.

An anonymous or recovery capability cannot select or retrieve authenticated
credentials. Permission to cancel, fence or supersede operations also
requires explicit authorization; being non-authenticating is insufficient.

Browser mutations require validated context binding, context-bound CSRF
protection and exact-Origin validation.

Auth requests additionally require the authenticated BFF identity and
operation permissions. Service assertions do not replace context or
attempt binding.

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

DISABLED, EXPIRED and FENCED records cannot transition back to authenticated
use. Reconciliation never authorizes activation or credential replay.

### Proposed transition and commit table

Each transaction is local to its owning store. Auth and BFF commits are
not one atomic transaction.

| Step | Authorization and conditions | Durable transition / commit point | Owner | Failure boundary |
| --- | --- | --- | --- | --- |
| Bootstrap | Server-created context; reuse an existing valid context without reissuing its cookie | Create an independent anonymous context when needed; write only the anonymous cookie | Member 1 | Never invalidate other contexts or overwrite the authenticated cookie |
| B1: reserve | Valid original context, CSRF, exact Origin and login eligibility | Conditional reservation creates one PENDING operation and persists attempt ID before Auth calls | Member 1 | Losing submissions do not contact Auth or verify passwords; uncertain reservation does not authorize issuance |
| A1: admit | Authenticated permitted BFF; bound audience, operation, context and attempt; valid one-time admission authorization | Atomically consume authorization and create ADMITTED attempt | Member 2 | Same-binding duplicates may return safe metadata; no restart or deadline extension |
| A2: claim verification | Bound admitted attempt; eligible deadline; no cancellation; no existing verification owner | Conditionally record durable verification ownership before password verification | Member 2 | No implicit worker takeover or automatic password-verification retry |
| A3: issue | Verification owner; successful credentials; active verified account; unchanged credential version under account lock; eligible attempt | In one Auth transaction persist session, refresh hash and COMMITTED attempt/session association; signing failure aborts the transaction | Member 2 | Return the complete envelope only after confirmed commit; uncertain acknowledgement is an operational error |
| B2: activate | Complete validated envelope; same operation owner; eligible deadlines; no fence; authorized flow binding | Atomically persist encrypted credentials, fresh ACTIVE bearer record, attempt/session association and durable reconciliation tracking; operation becomes ACTIVATED | Member 1 | Emit authenticated cookie only after confirmed commit; uncertain commit sends no cookie |
| B3: recover | Explicit recovery action; original validated binding; CSRF, exact Origin and recovery deadline | Atomically FENCE the operation, DISABLE associated contexts and persist reconciliation work before calling Auth | Member 1 | Failed or uncertain fencing cannot be reported as confirmed recovery |
| A4: cancel | Authenticated permitted BFF and original attempt binding; validated recovery authority | Lock attempt; CANCEL admitted work, or atomically revoke its associated session and CANCEL a committed attempt | Member 2 | Late verification workers cannot commit; repeat requests need an agreed idempotent contract |
| B4: disable | Authenticated bearer, CSRF, exact Origin; demonstrable association to affected operations | Atomically DISABLE selected context, FENCE authorized linked operations and persist Auth revocation work | Member 1 | Unconfirmed local commit means logout is uncertain |
| A5: revoke | Authenticated permitted BFF; authorized audience/session association | Durably revoke the associated Auth session; repeated revocation must have reviewed idempotent semantics | Member 2 | Auth failure leaves revocation pending; it cannot undo BFF disabling |
| Reconcile | Authorized worker; durable action and binding; conditional claim with fenced completion | Record confirmed outcome or preserve pending/escalated work | Member 1 with Member 2 contracts | Never activate a context, replay credentials or lift a fence |
| Restore | Controlled infrastructure recovery procedure | Keep authentication unavailable until restored state is invalidated or reconciled against separately protected recovery authority | Members 1/2/4 | An old backup must not restore authenticated access |

A3 checks expiry using an authoritative database time source that advances
during the transaction, immediately before the conditional committed
transition. This is not a guarantee about the time at which commit
acknowledgement arrives.

Lock ordering, transaction isolation and exact conditional-update schemas
must be specified and tested before implementation.

Credential-version capture and locked comparison are implemented Auth
building blocks. That does not mean A1-A5 or complete issuance exist.

### Bootstrap and competing submissions

Concurrent bootstrap requests without a valid anonymous cookie create
independent contexts. Before B1, supplied CSRF state must match the cookie
actually received.

A mismatch returns proposed 409 CONTEXT_CHANGED with no admission,
verification or authenticated-cookie change. The UI discards the password
and offers an explicit restart.

Within one validated context, B1 admits only one pending operation.
A generation is useful only within a proven authorization boundary.

Across independent contexts, both logins could otherwise produce valid
bearers. A delayed response could overwrite a newer cookie with an older
valid bearer. Therefore newest-login-wins and cross-context supersession
are not established by this proposal.

Delayed anonymous bootstrap may also replace recovery binding after an
attempt starts. Recovery that survives this safely remains OPEN.

### Proposed partial-failure outcomes

| Failure | Required proposed outcome |
| --- | --- |
| Auth commits; credentials never reach BFF | No BFF activation; explicit recovery resolves the bound attempt |
| Credentials arrive; BFF persistence fails | No cookie; reconcile/cancel the associated Auth attempt/session |
| BFF commit acknowledgement is lost | No cookie on uncertainty; resolve durable operation state without claiming rollback |
| BFF activates; browser misses cookie | Explicit recovery; no automatic credential replay |
| Durable disabling fails or is uncertain | Operational error; no successful-logout claim |
| BFF disabling succeeds; Auth revocation fails | Context remains disabled; Auth revocation pending |
| Credentials arrive after a fence | Reject activation and reconcile the associated Auth session |
| Superseded authenticated cookie arrives late within an authorized flow | Disabled identifier cannot authenticate or alias newer credentials |
| Independent-context login cookie arrives late | Ordering guarantee unresolved; cookie installation remains blocked |
| Required key or authoritative store unavailable | Deny credential selection; no stale-cache fallback |
| Admission is not yet visible during recovery | Pending/unresolved; do not claim cancellation or authorize replacement |
| Attempt metadata is unknown or cleaned up | Unresolved; unknown does not mean cancelled or reusable |
| Worker restarts during reconciliation | Resume from durable work; preserve fences and use reviewed idempotent actions |
| Backup restoration | Keep authentication unavailable until restored contexts are invalidated or reconciled against a separately protected recovery epoch |

A COMMITTED attempt requires recovery even after issuance eligibility
expires. Expiry does not prove that no session was issued.

Only confirmed cancellation and associated-session revocation permit
replacement issuance, with fresh credential entry and verification.
Lost binding remains unresolved. Unrelated sessions and cookies are
preserved.

### Browser delivery and logout

After B2 confirmation, the UI obtains authoritative session state.
Earlier UI success/error responses are advisory.

Recovery writes no authentication cookie.

Proposed logout behavior sends no authenticated-cookie deletion or
replacement header. A disabled bearer remains until expiry or a later
approved login replaces it, avoiding a delayed deletion erasing a newer
login cookie. Member 1 must confirm cookie lifetime and behavior.

| Confirmed state | Browser-safe meaning |
| --- | --- |
| B4 not confirmed | Logout outcome uncertain |
| B4 confirmed; Auth revocation unconfirmed | BFF access disabled; Auth revocation pending |
| B4 and Auth revocation confirmed | Logout complete for the associated context/session |

A late disabled cookie may cause loss of availability but cannot
authenticate. This does not solve independent-context ordering,
logout-all or password-change revocation.

### Proposed expiry and retention

All limits below remain proposals requiring joint review.

| Record | Proposed expiry / retention | Owner to confirm |
| --- | --- | --- |
| Anonymous login context | 30-minute absolute login eligibility; recovery binding handled separately | Members 1/2 |
| Auth attempt | Five-minute issuance eligibility; fixed 24-hour metadata/recovery window from admission | Members 2/4 |
| Authenticated BFF context | No later than the linked Auth session's absolute deadline; no sliding extension | Members 1/2 |
| Recoverable credentials | Usable only while context and credential deadlines permit. Delete atomically with BFF fencing/disabling, conditional on the reviewed reference-based Auth cancellation/revocation contract described below. | Members 1/4 |
| Disabled-context tombstone | Through the latest possible associated session/cookie expiry, plus a proposed 24-hour margin | Members 1/4 |
| Unresolved reconciliation | Escalate after 24 hours; do not automatically delete unresolved work or lift fences | Members 2/4 |

The earlier credential-retention wording, "subject to reconciliation
needs", is superseded by the conditional atomic-deletion rule in
"Proposed cookie expiry and credential deletion clarification".
It does not authorize indefinite retention or raw credentials in
reconciliation records.

The cancellation/revocation contract and deletion rule remain proposed,
not implemented guarantees. Auth must independently validate the BFF's
authority over the referenced audience and attempt/session. A reference
alone grants no authority.

The proposed tombstone margin requires validation against cookie
lifetimes, delayed delivery and restore behavior.

Anonymous login eligibility must not silently shorten the separate
recovery window. The mechanism for preserving that binding remains OPEN.

Metadata cleanup must not permit reuse of an admission authorization or
attempt. Proof expiry, durable consumption and cleanup ordering still
require a concrete contract.

### Proposed ownership

| Responsibility | Proposed owner |
| --- | --- |
| BFF context logic, schema/migrations, cookie behavior and safe response mapping | Member 1 |
| Auth attempts, credential issuance, session state, cancellation and revocation | Member 2 |
| Infrastructure provisioning; encryption/key controls, retention and restore review | Member 4 |
| BFF reconciliation producer/worker | Member 1 against Member 2's reviewed idempotent Auth contracts |
| Cross-store failure and concurrency tests | Members 1/2 with Member 4 reviewing infrastructure failures |

BFF recoverable credential retention remains a new, unapproved
responsibility. This table does not approve a store or transfer approval
from earlier Auth-only response-retention discussions.

### Durable reconciliation requirements

Persist work atomically with BFF fencing. B1 must leave enough durable
operation identity to discover uncertain Auth outcomes after a crash.
B2 must retain association/tracking sufficient for uncertain persistence
or browser delivery; B2 alone cannot cover failures before it commits.

Proposed work records contain:

- Operation ID, audience, context ID and generation.
- Auth attempt/session references when known.
- Requested action, processing state and outcome reference.
- Claim/version and timing information needed for cross-replica processing.

No passwords or raw credentials belong in reconciliation records.

Worker claims and completion require durable conditional updates.
Expired worker claims cannot authorize activation or undo cancellation.
Exact claim leases, retry bounds, escalation and cleanup remain OPEN.

Business issuance is not automatically retried. Cancellation, revocation
and safe status retrieval require separately reviewed retry semantics.
Missing session references must be resolved through authorized attempt
association, not guessed from browser input.

### Storage, keys and restore review

If BFF credential storage is accepted:

- Use shared authoritative storage with dedicated least-privilege runtime
  access. Identify the store, schema owner and service roles explicitly.
- Use authenticated encryption and dedicated versioned runtime keys,
  separate from signing, assertion and other cryptographic purposes.
- Bind ciphertext to context, audience, session, generation and expiry.
- Enforce context and credential expiry on reads independently of cleanup.
- Deny selection on missing keys, authentication-tag failure or unavailable
  authoritative state; never fall back to stale credentials.
- Define key distribution, rotation, retirement and loss behavior.
- Define encrypted backup access, retention and deletion.
- Keep restored authentication unavailable until cancelled/logged-out
  contexts cannot regain access.

The recovery epoch's authority, storage, restore procedure and relationship
to Auth session validity remain OPEN. An epoch restored from the same old
backup is insufficient protection.

### Acceptance blockers and review status

Member 4 supports the security requirements only.

The following remain OPEN:

- Trusted cross-context flow identity and transition authorization.
- Concurrent-bootstrap and reload recovery binding.
- Explicit acceptance of BFF recoverable credential storage.
- Concrete schemas, lock ordering and cross-replica conditional updates.
- Idempotent Auth cancellation/revocation and reconciliation contracts.
- Credential deletion timing, tombstone bounds and cleanup safety.
- Runtime-key lifecycle and independently protected restore authority.

Required tests above remain prerequisites, including restart recovery,
cross-replica races, delayed cookie delivery and restore invalidation.

Documentation consolidation does not approve or implement this mechanism.
Cookie installation, login issuance, refresh and live integration remain
disconnected.
### Proposed cookie expiry and credential deletion clarification

Member 1 confirms that the following accurately records the proposals
and their conditions. This is not acceptance of the delivery mechanism.

Authenticated cookies must carry an absolute Expires value no later than
the linked Auth session's absolute deadline. Delayed delivery must not
extend server-side validity. Server-side expiry remains authoritative.
Any additional cookie lifetime attribute must not permit a later deadline.

Under this proposal, logout sends no authenticated-cookie deletion or
replacement header.

Proposed credential deletion is atomic with BFF fencing/disabling.
Reconciliation retains only non-secret references and processing metadata,
never raw access tokens, refresh tokens or passwords.

This deletion rule depends on a reviewed Auth revocation contract that:

- Uses bound audience and attempt/session references without requiring
  the user's access or refresh credential.
- Independently authenticates the BFF and validates its authority over
  the referenced audience and attempt/session.
- Provides idempotent revocation.
- Distinguishes confirmed revocation from unknown or unavailable state.
- Does not treat possession of a reference as authorization.
- Prevents cancellation of an admitted attempt from being bypassed by
  a late issuance worker.

If session issuance is uncertain, the authorized attempt association must
be resolved through the reviewed cancellation/revocation contract.
An unknown reference cannot establish confirmed revocation.

Until this contract is reviewed, the deletion rule remains conditional;
this paragraph does not authorize indefinite credential retention.

Member 4's review, flow binding, bootstrap recovery and implementation
tests remain pending. Storage ownership and the delivery mechanism remain
unapproved. Cookie installation, login issuance, refresh and live
integration remain disconnected.