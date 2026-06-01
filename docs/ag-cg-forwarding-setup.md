# AG/CG Email Forwarding — Per-Account Setup Runbook

**Goal:** every individual AskGamblers / Casino Guru review account auto-forwards its
status emails to **`leo@optinetsolutions.com`**, where the Apps Script parser
(`parseAgCgEmails`, hourly) reads them and writes `Published`/`Refused` to the Sheet.

**The two senders to match (every rule below uses these):**
- `noreply@askgamblers.com`
- `no-reply@casino.guru`

**Golden rule:** use **Redirect / Forward that preserves the original sender** — NOT a
"forward as new message" that rewrites `From` to the agent or prefixes `Fw:`. The parser
finds mail by `from:noreply@askgamblers.com` and parses a pristine email; a mangled forward
breaks both the search and the body parsing.

> ✅ **Validate the FIRST account of each provider end-to-end before mass-applying.** After a
> real status email arrives, in `leo@` search `from:noreply@askgamblers.com` and confirm it
> shows up with the original sender intact (open → "Show original" → `From:` line). Only then
> roll the same recipe across the rest of that provider.

---

## Outlook.com  (Redirect rule)  — German UI labels in parentheses

**One rule covers both senders.** Put both AG and CG in a single "From" condition — Outlook
treats multiple From values as "match either", so you do NOT need two rules.

Per account:
1. Sign in → **Settings ⚙ (Einstellungen) → Mail (E-Mail) → Rules (Regeln) → Add new rule
   (Neue Regel hinzufügen)**.
2. Name (Regel benennen): `AG-CG to Leo`.
3. **Add a condition (Bedingung) → From (Von)** → add BOTH, as two chips in the same box:
   `noreply@askgamblers.com` and `no-reply@casino.guru` (note CG is `no-reply`, hyphenated).
4. **Add an action (Aktion) → Redirect to (Umleiten an)** → `leo@optinetsolutions.com`.
   - Must be **Redirect to / Umleiten an** (preserves the original sender). NOT "Forward to /
     Weiterleiten an" (that rewrites From and breaks the parser).
5. **Save (Speichern).**

### ⚠️ Safe-senders (REQUIRED) — Outlook rules do NOT run on Junk mail
If an AG/CG email gets filtered to **Junk-E-Mail (Spam)**, the redirect rule is **skipped**
and the status is silently lost. Real AG/CG mail normally lands in the Inbox, but to guarantee
it, on every account add both senders as safe:
**Settings ⚙ → E-Mail → Junk-E-Mail → "Sichere Absender und Domänen" (Safe senders)** →
add `noreply@askgamblers.com` and `no-reply@casino.guru`.
(Discovered during testing: a test email landed in Junk and was never redirected.)

### The verification gate (only on accounts lacking security info)
Outlook refuses to save a forwarding/redirect rule until the account has a verified backup
contact — you'll see *"Sign in and verify your account to create a forwarding rule"* with an
**Anmelden** button, and Save stays greyed out. Accounts that already have a recovery
email/phone skip this entirely.

When it appears, the **cleanest** path (the inline popup is flaky — throws
`server_error: contextID … did not have a matching cookie` when Chrome blocks live.com cookies):
1. New tab → **account.microsoft.com** → sign in as the Outlook account.
2. **Security → Advanced security options** → **Add a verification method** → alternate email
   → `leo@optinetsolutions.com` → enter the code sent there → confirm until verified.
3. Back to **Outlook → Settings → Regeln**, reopen the rule, **Speichern** — warning gone.

(If you try the inline **Anmelden** popup instead and it errors, just retry, or do it in an
Incognito window. Using `leo@optinetsolutions.com` as the alternate for every account is fine.)

---

## Gmail  (verified forwarding address + filter)

Gmail requires confirming the destination once per account before it will forward.

Per account:
1. Sign in → **Settings ⚙ → See all settings → Forwarding and POP/IMAP**.
2. **Add a forwarding address** → `leo@optinetsolutions.com` → **Next → Proceed**.
   - Gmail emails a confirmation code/link **to `leo@`**. Open `leo@`, click the link (or
     copy the code back into this account's settings) to verify.
   - Leave the top option as **"Keep Gmail's copy in the Inbox"** — do NOT switch the whole
     account to forward everything; we only want AG/CG via a filter (next step).
3. **Settings → Filters and Blocked Addresses → Create a new filter**.
4. In **From** put: `noreply@askgamblers.com OR no-reply@casino.guru` → **Create filter**.
5. Check **Forward it to:** → select `leo@optinetsolutions.com` → **Create filter**.

(The forwarding-address verification in step 2 is one-time per Gmail account; the filter is
what limits forwarding to just AG/CG mail.)

---

## ProtonMail — PAID plans only  (auto-forward)

Free Proton CANNOT auto-forward — see "Free Proton" below.

Per paid account:
1. Sign in → **Settings → All settings → Filters → (or) Forward**.
2. Add an auto-forward / filter: **Sender is** `noreply@askgamblers.com` → **Forward to**
   `leo@optinetsolutions.com`. Confirm the forwarding address if Proton prompts.
3. Repeat for `no-reply@casino.guru`.

---

## Free ProtonMail — NOT supported by forwarding

Free Proton has no external auto-forward, no IMAP (Bridge is paid), and is the worst case
for automation (anti-bot + client-side encryption). Decide per the project plan:
- **Upgrade** the account to paid (then use the Proton recipe above), or
- **Phase out** / migrate future review accounts to Outlook/Gmail (or a catch-all domain).
Do **not** build a Proton-scraping bot — high lockout/CAPTCHA risk, high maintenance.

---

## After forwarding is set up

1. Wait for (or trigger) a real AG/CG status email to a configured account.
2. In Apps Script editor → run `parseAgCgEmails()` once.
3. Confirm: the matching Sheet row's `AG`/`CG Review Status` flips to `Published`/`Refused`,
   the Gmail thread in `leo@` gets the `ag-cg-processed` label, and a re-run changes nothing.
4. Anything unmatched lands in the **`Email Parse Errors`** tab with a reason (usually a new
   casino to add to `CASINO_TAB_MAP` in `EmailParser.gs`).

After that it runs hands-off on the hourly trigger.

---

## Scaling note (avoid this work for FUTURE accounts)

Per-account forwarding is unavoidable for the existing 30+. To stop repeating it: create
future review accounts on addresses under **a domain you control with a catch-all** (or Gmail
`+alias` addresses). Then every status email lands in one mailbox automatically — zero
per-account setup ever again.
