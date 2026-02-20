# Data Directory

This directory contains large data files used for testing and development.

## Contents

- `sec_payload_*.json` - Sample SEC filing data (7MB+ each)

## Important

**These files are NOT committed to git** (see `.gitignore`).

To regenerate these files, use the scripts in `scripts/`:

```bash
# Fetch SEC data (default 10-ticker benchmark universe)
python scripts/dump_sec_payloads.py

# Or pass explicit tickers
python scripts/dump_sec_payloads.py --tickers AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,JPM,V,XOM

# Build compact normalized feature artifacts for backend consumption
python scripts/extract_sec_features.py
```

## Why Not in Git?

These files are:
- Large (7MB+ each) - slows down git clone
- Regenerable - can be fetched via scripts
- Test data - not required for production

If you need this data for testing, run the fetch scripts instead of committing large files.
