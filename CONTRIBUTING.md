# Contributing to launchcast

Start with the README's implementation boundaries. Please propose a bounded
change and include a reproducible example, the version tested, and observed
results. A successful test is not a provider receipt or production certification.

## Useful contributions

- Offline provider-response fixtures for invalid, private, missing, or ambiguous upload results.
- Reproducible local rendering failures using owned or synthetic raster media.
- Resource-boundary tests before adding any multi-user hosting.

## Before opening a PR

1. Keep changes focused; explain the failure or user need.
2. Inspect package scripts before running them. Never use production credentials
   or publish/pay/deploy as part of a test.
3. Include the exact checks you ran and their results. State anything untested.
4. Preserve provenance, upstream attribution, license terms, and human gates.
5. Do not include customer data, location histories, private conversations,
   tokens, or filesystem paths that reveal another person's environment.

Run the offline suite with `npm test`. The optional FFmpeg canary is local and synthetic; it must not publish. Google Workspace prototypes are not live integration evidence.

Report bugs through this repository's Issues tab. For a suspected secret leak,
do not paste the secret into an issue; describe the affected surface without
disclosing sensitive values.
