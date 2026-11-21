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