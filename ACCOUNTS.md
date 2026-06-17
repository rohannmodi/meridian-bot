# Mock Account Store

Seed data for `src/server/accounts.js`. All values are fake.

# Mock Account Store

| Ref     | First | Last     | SSN4 | ZIP   | State | Portfolio | Original Creditor | Balance | Receive Date | Flags        | Notes |
|---------|-------|----------|------|-------|-------|-----------|-------------------|---------|--------------|--------------|-------|
| ACC-001 | Sarah | Johnson  | 4321 | 10001 | NY    | P-200     | First National Bank | $4,200  | 2025-08-15   | []           | Happy path — credit card. NY → no voicemail (n/a for chat). |
| ACC-002 | Luis  | Martinez | 8765 | 94102 | CA    | P-100     | Westside Auto Finance | $8,500  | 2025-09-02   | []           | Auto loan, negotiable. CA → preferred-language prompt. |
| ACC-003 | Wei   | Chen     | 1122 | 60601 | IL    | P-300     | Lakeside Lending | $2,100  | 2025-10-10   | [PRE_LEGAL]  | Pre-legal — extra disclosure required. |
| ACC-004 | Mary  | Wilson   | 5544 | 30301 | GA    | P-200     | First National Bank | $3,800  | 2025-07-20   | [BKY]        | Bankruptcy — escalate. |
| ACC-005 | Anita | Patel    | 9988 | 02101 | MA    | P-100     | Westside Auto Finance | $6,200  | 2025-08-30   | [DSP]        | Active dispute — escalate. |
| ACC-006 | Ryan  | OBrien   | 3344 | 98101 | WA    | P-200     | First National Bank | $5,500  | 2025-09-12   | [CNA]        | Cease & desist — escalate. |
| ACC-007 | Maria | Garcia   | 7777 | 75201 | TX    | P-200     | First National Bank | $3,200  | 2025-10-01   | []           | Auth fail test — provide wrong creds. |
| ACC-008 | David | Kim      | 2211 | 02906 | RI    | P-200     | First National Bank | $1,800  | 2025-09-20   | [VOD]        | Verification of debt requested — escalate. |
| ACC-009 | James | Foster   | 6655 | 33101 | FL    | P-100     | Westside Auto Finance | $12,000 | 2025-08-05   | []           | Large balance — any single payment > $1,500 triggers escalation. |

## Non-serviced regions

The following address regions are NOT collected on, regardless of 
account status. If account.state is in this list → escalate immediately 
with reason REGION_NOT_SERVICED:

AA, AE, AP (Armed Forces), GU (Guam), MP (Northern Mariana Islands), 
PR (Puerto Rico), VI (US Virgin Islands), FM (Micronesia), 
MH (Marshall Islands), PW (Palau)

## Authentication standard (digital portal)

Match ALL of: account reference + first name + last name + last 4 SSN + ZIP.
Case-insensitive on names. Strip whitespace from all fields.
## Flag meanings (any flag → escalate, no negotiation)
- BKY: Bankruptcy
- DSP: Active dispute
- VOD: Verification of debt requested
- CNA / CDP: Cease & desist / Do-not-contact
- FRA: Fraud / identity theft
- DEC: Deceased
- MIL: Active-duty military
- LIT: Active litigation / attorney-represented

PRE_LEGAL is not an escalation flag — it triggers an extra disclosure.
