# RBI Compliance & Escalation Policy Specification

**Document:** RBI Compliance, Escalation Ladder & Stopping Rules  
**System:** ReviveAI — Autonomous Payment Recovery Agent  

---

## 1. Overview
ReviveAI is built specifically for Indian merchant and payment gateway ecosystems (Razorpay, NPCI, RBI regulated entities). Operating in this environment requires strict compliance with RBI circulars on recurring e-mandates, consumer protection guidelines, TRAI quiet-hour rules, and Digital Personal Data Protection (DPDP) principles.

---

## 2. E-Mandate & Auto-Debit Retry Policy

### 2.1 Regulatory Context & Disclaimer

> **Note:** India's e-mandate framework has been consolidated under RBI's
> "Digital Payments – E-mandate Framework, 2026" (and prior circulars it
> supersedes). The exact current circular text has not been independently
> verified against for this implementation. The retry limits, timing, and
> procedures described below reflect **ReviveAI's own retry policy**, informed
> by common e-mandate industry practice and publicly available summaries of
> the regulatory framework. Merchants deploying ReviveAI in production should
> independently verify compliance with the current RBI circular text.

### 2.2 Key Principles (Industry Practice)
- **Pre-Debit Notification:** Every auto-debit attempt (including retries) should be preceded by a notification to the customer at least **24 hours** before the scheduled debit. This is consistently described across public summaries of the e-mandate framework and is represented in ReviveAI's `MandateRetrySchedule.preDebitNotificationSentAt` field.
- **Mandate Expiry & Revocation:** If a mandate is expired or revoked by the user, the agent **must not** attempt auto-debit retries on the expired token. Instead, the agent initiates a **re-authorization workflow** sending a secure re-registration link.
- **Rail Switching:** If a UPI Autopay debit fails due to PSP timeout or bank downtime, fallback to e-NACH or Card Auto-Debit if an alternative mandate is registered, or send an on-demand payment link.

### 2.3 ReviveAI Mandate Retry Policy (Self-Imposed Limits)

The following limits are **ReviveAI's own operational policy**, not direct regulatory quotations:

- **Maximum 4 retry attempts** per recurring debit cycle. Exceeding this risks excessive bank processing fees, customer friction, and account-level flags.
- **168-hour (7-day) recovery window** from the original failed debit. After this window, the mandate is marked `UNRECOVERABLE` and escalated to the merchant.
- **Fraud-flagged mandates are never retried** — zero tolerance, same as one-time payments.

### 2.4 Smart Mandate Retry Sequencing Matrix
```
Attempt 1 (T+0):       Original scheduled debit date (e.g., 5th of month) → Failed
                        Pre-debit notification: T-24h (before original debit)
Attempt 2 (T+48h):     +2 Days (aligns with salary clearing / bank processing window)
                        Pre-debit notification: T+24h
Attempt 3 (T+96h):     +4 Days at optimal bank hour (e.g., 10:15 AM IST for SBI/HDFC)
                        Pre-debit notification: T+72h
Attempt 4 (T+144h):    +6 Days switching to alternative rail / direct one-click link
                        Pre-debit notification: T+120h

TERMINATION (T+168h):  Hard stop. Mandate marked UNRECOVERABLE / Escalate to merchant.
```

---

## 3. Compliant Escalation Ladder

ReviveAI implements a 5-tier respectful escalation ladder:

```
┌────────────────────────────────────────────────────────┐
│ LEVEL 1: Immediate On-Screen Suggestion (T+0)          │
│ • Suggested alternative payment method on checkout page│
│ • Zero customer contact / non-intrusive               │
└──────────────────────────┬─────────────────────────────┘
                           │ If uncompleted after 1h
                           ▼
┌────────────────────────────────────────────────────────┐
│ LEVEL 2: Privacy-Preserving Email (T+1h)               │
│ • Direct secure payment link with cart reservation     │
│ • Neutral tone: "Payment could not be completed"       │
└──────────────────────────┬─────────────────────────────┘
                           │ If ignored after 24h
                           ▼
┌────────────────────────────────────────────────────────┐
│ LEVEL 3: Respectful SMS Reminder (T+24h)               │
│ • 1 short reminder with payment link                   │
│ • Max 1 SMS per incident                               │
└──────────────────────────┬─────────────────────────────┘
                           │ If unpaid after 48h
                           ▼
┌────────────────────────────────────────────────────────┐
│ LEVEL 4: Merchant Dashboard Escalation (T+48h)         │
│ • Flagged in merchant queue for high-value accounts    │
│ • Manual relationship manager outreach option          │
└──────────────────────────┬─────────────────────────────┘
                           │ If unpaid after 72h
                           ▼
┌────────────────────────────────────────────────────────┐
│ LEVEL 5: Hard Stop / Dead (T+72h)                      │
│ • Mark status as DEAD. Permanently halt all outreach.  │
└────────────────────────────────────────────────────────┘
```

---

## 4. Privacy & Consumer Protection Rules

1. **Failure Reason Privacy:**
   - ✅ **Permitted:** *"Your payment of ₹3,200 could not be processed by your bank. Tap here to try again."*
   - ❌ **Prohibited:** *"Your payment failed due to Insufficient Funds / Low Balance."* (Violates customer dignity and privacy).
2. **Quiet Hours Enforcement (TRAI / DPDP):**
   - **9:00 PM to 9:00 AM IST:** No SMS, WhatsApp, or email notifications are dispatched.
   - Any notification generated during quiet hours is queued and scheduled for dispatch at **9:00 AM IST** the following morning.
3. **Anti-Spam Frequency Caps:**
   - Maximum **3 total communications** per transaction across all channels.
   - Immediate termination if customer opts out via link or response.
4. **Fraud Block Zero-Tolerance:**
   - Any transaction tagged with `FRAUD_DETECTED` or `SUSPECTED_FRAUD` by the issuing bank is permanently blocked from recovery.
