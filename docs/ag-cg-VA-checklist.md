# VA Checklist — Forward AG/CG Status Emails (do once per new account)

**Why:** so AskGamblers / Casino Guru review-status emails reach the dashboard automatically.
**What:** every review account must auto-forward mail from those two senders to:

> ## 📩 leo@optinetsolutions.com

**Senders to forward (always both):**
- `noreply@askgamblers.com`
- `no-reply@casino.guru`

> ⚠️ **Create new accounts on Outlook or Gmail.** Do NOT use **free ProtonMail** — it cannot
> auto-forward. (Paid Proton is fine.)

---

## ☑️ If the account is OUTLOOK

**A. Add the redirect rule**
1. Settings ⚙ → **E-Mail → Regeln → Neue Regel hinzufügen** (Mail → Rules → Add new rule)
2. Name: `AG-CG to Leo`
3. **Bedingung (Condition) → Von (From)** → add **both**: `noreply@askgamblers.com` and `no-reply@casino.guru`
4. **Aktion (Action) → Umleiten an (Redirect to)** → `leo@optinetsolutions.com`
   - ⚠️ Must be **Umleiten an (Redirect)** — NOT "Weiterleiten an (Forward)".
5. **Speichern (Save).**
   - If it says *"verify your account to create a forwarding rule"* → go to **account.microsoft.com
     → Security → add a verification method** (alternate email `leo@optinetsolutions.com`, enter the
     code), then come back and Save.

**B. Mark senders safe (so they don't land in Junk)**
1. Settings ⚙ → **E-Mail → Junk-E-Mail → Sichere Absender und Domänen (Safe senders)**
2. Add domains: `askgamblers.com` and `casino.guru`
3. **Speichern (Save).**

---

## ☑️ If the account is GMAIL

**A. Verify the forwarding address (one time)**
1. Settings ⚙ → **See all settings → Forwarding and POP/IMAP → Add a forwarding address**
2. Enter `leo@optinetsolutions.com` → Next → Proceed.
3. Ask the admin to approve the confirmation code Gmail sends to `leo@` (or the team confirms it).
4. Keep **"Keep Gmail's copy in the Inbox."**

**B. Add the filter**
1. Settings ⚙ → **Filters and Blocked Addresses → Create a new filter**
2. **From:** `noreply@askgamblers.com OR no-reply@casino.guru` → **Create filter**
3. Tick **"Forward it to:"** → `leo@optinetsolutions.com`
4. Create filter.

---

## ✅ Done = both senders forward to leo@, and won't get junked.

That's it — one-time per account. After this, status emails for that account are detected
automatically; no manual inbox checking. Questions → ask the admin.
