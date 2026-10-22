# Buyer Voice Intelligence — Phase 1 (read-only)

This branch is isolated from the production dashboard. No deployment, live encrypted payload change, Notion write, or MASTER write has been performed.

## Scope
- Match authorized Granola meeting metadata to Notion/Meeting Prep metadata, with ambiguity detection.
- Extract candidate technical, security and evaluation signals with source lines and review-required attribution.
- Produce versioned draft outcome records with named-owner preservation and null owner when unknown.
- Use only synthetic fixtures in this public GitHub repository; never commit plaintext customer notes.

## Local prototype
A local JavaScript proof-of-concept was implemented and passed 7/7 node:test cases on 2026-10-22.
The prototype package is available in the ChatGPT project handoff and must be reviewed before its code is copied into this branch.

## Next review gates
1. Validate matching against private RealPage prep and Granola notes.
2. Confirm connector read permissions and retention requirements.
3. Add private ingestion adapter and provenance guarantees.
4. Add outcomes to the encrypted dashboard build pipeline only after tests.
5. Add UI behind a feature flag; no automatic deployment.

## Security
Do not store meeting plaintext, passphrases, bearer tokens or decrypted dashboard data in the GitHub Pages repository. Obtain explicit approval for protected account data processing and later Supabase/MASTER writes.
