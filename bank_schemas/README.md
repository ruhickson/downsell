# Bank CSV Schema Documentation

This folder contains schema definitions and field mappings for different bank CSV formats supported by Downsell.

## Files

- `revolut.json` - Schema for Revolut bank statement CSVs
- `aib.json` - Schema for AIB bank statement CSVs
- `boi.json` - Schema for Bank of Ireland bank statement CSVs
- `field_mapping.json` - Mapping of equivalent fields between banks and detection rules

## Field Equivalencies

### Date Field
- **Revolut**: `Completed Date` (format: YYYY-MM-DD HH:MM:SS)
- **AIB**: `Posted Transactions Date` (format: DD/MM/YYYY)
- **BOI**: `Date` (format: DD/MM/YYYY)

### Description Field
- **Revolut**: `Description` (single field)
- **AIB**: `Description1` (only - prefixes like VDP-, VDC- are removed)
- **BOI**: `Details` (single field)

### Amount Field
- **Revolut**: `Amount` (negative for debits, positive for credits)
- **AIB**: `Debit Amount` or `Credit Amount` (one will be empty; use negative for debit, positive for credit)
- **BOI**: `Debit` or `Credit` (one will be empty; use negative for debit, positive for credit)

### Currency Field
- **Revolut**: `Currency`
- **AIB**: `Posted Currency` (or `Local Currency`)
- **BOI**: Defaults to `EUR` (no explicit currency field)

### Balance Field
- **All**: `Balance` (same field name; BOI may have empty balance for some rows)

### Transaction Type Field
- **Revolut**: `Type` (values: CARD_PAYMENT, EXCHANGE, TRANSFER, etc.)
- **AIB**: `Transaction Type` (values: Debit, Credit, Direct Debit, etc.)
- **BOI**: Not available (infer from Debit/Credit fields)

## Detection Logic

To detect which bank's CSV was uploaded, check for the presence of unique columns:

### Revolut Detection
- Must have: `Type`, `Started Date`, `Completed Date`
- File pattern: `account-statement_*.csv`

### AIB Detection
- Must have: `Posted Account`, `Posted Transactions Date`, `Description1`
- File pattern: `Transaction_Export_*.csv`

### BOI Detection
- Must have: `Date`, `Details`, `Debit`, `Credit`, `Balance`
- File pattern: `*.csv` (generic, check after Revolut and AIB)
- Note: BOI has the simplest format with only 5 columns

## Usage in Application

When a CSV is uploaded:
1. Read the header row to get column names
2. Check against `detection_rules` in `field_mapping.json` (check in order: Revolut, AIB, then BOI)
3. If Revolut detected: use `revolut` field mappings
4. If AIB detected: use `aib` field mappings
5. If BOI detected: use `boi` field mappings
6. Process data according to `processing_notes` for the detected bank
7. Account identifier: Use "REV-1", "AIB-1", "BOI-1" format for each bank type

