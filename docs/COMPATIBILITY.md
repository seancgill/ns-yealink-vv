# Compatibility and validation

## Verified pilot

- Date: 2026-10-05; platform: sedemotwo.
- API core1: `45.0.1`, `core1-iad.sedemotwo.ucaas.tech`.
- API core2: `45.0.3`, `core2-iad.sedemotwo.ucaas.tech` (version verified through the cluster API).
- Handset: Yealink SIP-T57W, firmware `96.87.0.22`, provisioned dynamically from the line-one owner/domain.
- Runtime: Linux Node `24.21.0`; package requires Node 22 or newer.
- Operator reported the deployment working after the issues below were diagnosed. This does not establish compatibility with every handset, firmware or platform build.

## API contract and automated checks

Matching v45 schema/source review confirmed:

- GET `/domains/{domain}/users/{user}/voicemails/{folder}`
- GET `/domains/{domain}/users/{user}/voicemails/{folder}/{filename}`
- PATCH `.../{filename}/save`
- PATCH `.../{filename}/forward`, body `{"voicemail-forward-new-destination":"<extension>"}`
- DELETE `.../{filename}`

Folders are `new`, `save`, `trash`; the adapter also accepts legacy `saved` inputs. Detail responses may be an object or array; both are supported.

All 54 mocked tests passed locally on Node 24.19.0 after the compact URL update. The earlier 49-test suite passed on Linux Node 24.21.0. Tests cover route/XML behavior, access checks, dynamic identity, signed URL handling and API request contracts; mocked tests do not prove live playback or mutation behavior.

Live read-only checks verified mailbox listing and object-shaped message details, HTTPS folder-to-detail navigation, and the original message's audio HTTP 200 with `audio/wav`. The operator tested the phone and forwarded a message to another mailbox, where destination receipt was verified. The operator subsequently reported everything working; individual Save/Stop/Delete/Restore/permanent-delete results were not independently recorded.

## Pilot findings

- The cores returned different voicemail contents. Load-balanced API access could list a message on one core and return 404 for details on another. The app was configured to use core1, and HTTPS list/detail navigation then returned 200. Verify cluster consistency before relying on a load-balanced API hostname; core pinning does not provide automatic failover.
- The forwarded recording existed, but destination playback returned HTTP 403. A read-only subscriber check found no destination voicemail PIN; the installed audio handler requires a nonempty PIN. The original mailbox had a PIN and its audio URL returned 200. Set `voicemail-login-pin` when provisioning voicemail users and verify playback using fresh metadata afterward. No destination PIN change or subsequent audio HTTP result was independently recorded by the agent.
- Compact `/v` entry URLs were used to fit Yealink's documented 99-character key-value limit. Measure after provisioning token expansion.
- API folder `save` is used for Saved; restoring targets Saved.

## Operator acceptance checklist

1. Check the exact API build and responding core with `npm run check-api`.
2. Use `npm run check-api -- <extension> <domain>` for an authorized pilot mailbox.
3. Verify resolved owner/domain tokens and URL length in the delivered phone configuration.
4. Confirm phone TLS trust and direct audio playback/stop.
5. Test save, delete, restore and forward with disposable messages; confirm destination playback and PIN presence.
6. Confirm the existing portal/API remains healthy and secrets are excluded from applicable access logs.

## Other versions

### Transcript addition (2026-10-07)

The source-chat handoff recorded a live read-only check on core1 build `45.0.1`: voicemail detail returned transcript text in `file-transcript-text`, with no generic `transcription` field. The adapter preserves that field and accepts string-valued `transcription` as a compatibility fallback. This checkout could not reach the core for a repeat version check.

The matching v45 user schema documents `voicemail-transcription-enabled` as `no` or a vendor name. The app does not query that setting: it offers Read Transcript only when the selected message has nonempty text, including transcripts retained after a setting change. The authenticated transcript route reads message detail without changing voicemail state.

Long transcripts use pages of at most 500 Unicode code points with Back, Previous and Next softkeys. That size is a pilot choice, not a verified Yealink limit. Automated tests cover normalization, authenticated navigation, XML escaping, unavailable text and pagination; handset rendering and navigation remain untested.

API major v44: unverified. API major v46: unverified. Other Yealink models/firmware: unverified. The checker intentionally rejects unsupported API majors; evaluate them with their matching schema and independent live probes before rollout.

## Follow-up verification (2026-10-05)

The missing media was traced to malformed SSH public-key type labels in the file-replicator account's authorized keys. After correction, restricted SCP access passed in both directions. A fresh voicemail appeared on the second core approximately 1–2 seconds after creation; recording hashes matched, and both cores returned HTTP 200 for metadata and audio. Load-balanced API access was restored and repeated XML folder/detail checks passed. Earlier failed recordings still required a separate backfill. The XML application itself was hosted on one core; API redundancy does not establish application-host failover.

Custom Exit buttons are omitted from menus and transcript screens. Back follows app navigation; use the native Home icon to leave the app immediately. The user confirmed native Home and transcript display on T57W firmware 96.87.0.22; pagination still needs handset verification. The Forward input screen retains its native controls.

The voicemail list now offers a separate Play softkey; Select retains message details. MenuItem Selection carries the filename to an authenticated selected-play route. Custom softkey forwarding of Selection remains a T57W handset probe: missing selection returns an error rather than playing an arbitrary message. No automatic playback occurs when opening a folder or selecting details.

T57W handset test confirmed separate list Play works. Custom list Back caused a loading error during playback, while the native curved-arrow Back stopped playback successfully. The nonempty voicemail list therefore omits custom Back; message details and transcript retain their working Back controls. This is handset-observed behavior, not an inferred playback guarantee.
