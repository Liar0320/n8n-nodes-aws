# Redis, regenerated HTML and CloudFront ordering

This guide is a design for an independently reviewed workflow, not an instruction to modify, execute or deploy the existing production Redis cleanup workflow. There is no production connection, Redis credential, domain or resource ID in the supplied example. CloudFront invalidation alone does not rebuild stale origin HTML or make underlying data consistent.

## Required order

For one durable content-change event:

1. **Commit authoritative data.** Complete the database/object-store update and record a stable event identity, affected URL paths and a content version. Do not invalidate a cache before the origin can serve the new data.
2. **Clean affected Redis/data caches.** Delete or replace only the keys for that content/version using the application's documented key convention. Avoid `FLUSHALL`, guessed prefix scans, and broad cleanup. If cleanup fails, stop: do not invalidate the CDN and allow it to refill from stale data.
3. **Regenerate or evict origin HTML.** Rebuild affected prerendered pages, or evict the HTML cache so the next origin request regenerates them from committed data. Await the actual write/refresh completion, including any asynchronous job, before proceeding. Where feasible, read the origin directly and verify a content version rather than inferring freshness from an HTTP 200. If fresh HTML cannot be verified, report an error and stop.
4. **Create the CloudFront invalidation.** Only after the data/HTML dependency is ready, submit the reviewed distribution-relative paths. Include alternate URLs, slash variants and rewritten viewer/origin paths as appropriate. Invalidate only the required scope, not `/*` as a convenience.
5. **Wait, then Get Invalidation.** Preserve the returned invalidation ID and stable event state. Poll until AWS returns exactly `Completed`, with a finite absolute deadline. Keep `InProgress`, timeout and errors distinct. See the [sanitized workflow](../examples/cloudfront-invalidation.json).
6. **Record the outcome.** Mark the event's CDN phase completed only after AWS confirms completion. Store the distribution ID, invalidation ID, stable CallerReference, requested paths, content version, completion/timeout/error outcome and safe diagnostics. AWS invalidation completion confirms that invalidation request, not a test of your application correctness or a purge of every other cache.

A useful state sequence is:

```text
data committed → Redis/data cache ready → origin HTML fresh
              → CloudFront request accepted → AWS Completed
```

Every arrow is gated on a successful result. A failed earlier phase must not fall through to a success node. A timeout means observation stopped, not that AWS cancelled or failed the invalidation. An accepted invalidation can still complete after your workflow times out; reconciliation can query the saved invalidation ID without creating another request.

## Idempotency and concurrency

Derive CallerReference from the durable upstream event ID and phase, for example `content-event-<stable-event-id>-cdn-v1`. Do not use a new timestamp, execution ID or random value when retrying the same logical event. Persist the exact original path batch with that reference. The same CallerReference and same batch identifies the same invalidation; reusing it with changed paths can raise `InvalidationBatchAlreadyExists`. A genuinely different batch must have a different durable identity. CallerReference is not a secret store.

Persist state before entering Wait so a worker restart does not lose the request ID, reference, original paths or deadline. The example keeps these fields in execution state; a production integration should also maintain the event record in a durable application store. Keep the original deadline across poll loops rather than resetting it after every wait. Use n8n credential storage, not workflow JSON, for AWS access keys.

Order changes for the **same content identity** with an application-level queue/lock or monotonically versioned content writes. Two concurrent workflow executions are not serialized by this node, and AWS completion order is not an application version order. A delayed regeneration from an older event must not overwrite newer HTML. Immutable/versioned assets and atomic manifest/HTML changes can reduce the scope of invalidations.

## Cache-key review

* `/page` and `/page/` can be distinct. Enumerate both if both are public.
* Query-string cache variants may need explicit paths (`/page?lang=en`) or a reviewed trailing wildcard. `/page*` also matches longer unrelated path names sharing that prefix.
* Header/device cache-key variants are invalidated by the path, not by specifying header values. Different device-specific paths must still be included.
* If a viewer-request function rewrites a path, review both the viewer-facing and rewritten path in accordance with AWS guidance. Do not assume the URL pasted into a browser is the only cache key.
* CloudFront invalidation does not clear Redis, browser caches, service workers or other CDNs. Fresh CDN HTML is not evidence those other layers were purged.

## Safe adaptation checklist

Use a disposable non-production distribution first, with least-privilege Create/Get permissions and a known harmless path. Configure the example's explicit placeholders and credentials yourself; leave the imported workflow inactive until reviewed. Retain timeout and error branches. Do not attach the manual example directly to production cleanup, automatically retry a changed invalidation batch, log secrets or silently swallow cleanup failures. Real AWS tests incur requests and potentially charges; they require separate authorization and recorded results. The repository's offline tests are not a production rollout or live AWS verification.
