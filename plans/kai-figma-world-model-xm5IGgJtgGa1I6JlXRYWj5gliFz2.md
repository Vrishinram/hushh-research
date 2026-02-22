# Kai Figma World Model Dump - xm5IGgJtgGa1I6JlXRYWj5gliFz2

## Status
- Decrypted full blob dump: **SUCCESS**
- Decryption flow used: passphrase wrapper unwrap -> world model AES-GCM decrypt.

## Index-Level Snapshot (real data)
- Available domains: financial, financial_documents, kai_analysis_history, kai_profile
- Financial holdings count (index summary): 20
- Kai profile risk profile (index summary): balanced
- Kai analysis total analyses (index summary): 1

## Decrypted Snapshot (real data)
- Financial holdings count (decrypted): 20
- Kai analysis entries count (decrypted): None
- Brokerage docs linked: None

## Provenance
- Extracted at (UTC): 2026-02-22T02:27:58Z
- Source tables:
  - `world_model_index_v2`
  - `world_model_data`
  - `vault_key_wrappers`
- Decryption method:
  - PBKDF2-SHA256 (100000 iterations) using passphrase wrapper salt
  - AES-256-GCM unwrap of wrapper `encrypted_vault_key`
  - AES-256-GCM decrypt of world model (`ciphertext` + `tag`)
- Redaction policy:
  - No passphrase persisted
  - No vault key persisted
  - Payload retained for implementation parity and endpoint mapping
