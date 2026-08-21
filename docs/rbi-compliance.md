# RBI Compliance & Escalation Policy Specification

**Document:** RBI Compliance, Escalation Ladder & Stopping Rules  
**System:** ReviveAI — Autonomous Payment Recovery Agent  

---

## 1. Overview
ReviveAI is built specifically for Indian merchant and payment gateway ecosystems (Razorpay, NPCI, RBI regulated entities). Operating in this environment requires strict compliance with RBI circulars on recurring e-mandates, consumer protection guidelines, TRAI quiet-hour rules, and Digital Personal Data Protection (DPDP) principles.

---

## 2. RBI Mandate & Auto-Debit Compliance

### 2.1 E-Mandate Regulations (Circular RBI/2019-20/55 & updates)
- **Pre-Debit Notification (AFA Requirement):** Any auto-debit on an e-mandate requires pre-debit notifications to the customer. When a mandate fails, recovery attempts must comply with pre-authorized debit limits.
- **Maximum Retries:** A single recurring debit cycle must not exceed **4 retry attempts**. Exceeding this causes excessive bank processing fees, account debit locks, and regulatory non-compliance.
- **Mandate Expiry & Revocation:** If a mandate is expired or revoked by the user, the agent **must not** attempt auto-debit retries on the expired token. Instead, the agent initiates an **AFA re-authorization workflow** sending a secure re-registration link.
- **Rail Switching Rules:**
  - If a **UPI Autopay** debit fails due to PSP timeout or bank downtime $\rightarrow$ Fallback to **e-NACH** or **Card Auto-Debit** if alternative mandate registered, or send on-demand payment link.

### 2.2 Smart Mandate Retry Sequencing Matrix
```
Attempt 1 (T+0):       Original scheduled debit date (e.g., 5th of month) → Failed
Attempt 2 (T+48h):     +2 Days (aligns with salary clearing / bank processing window)
Attempt 3 (T+96h):     +4 Days at optimal bank hour (e.g., 10:15 AM for SBI/HDFC)
Attempt 4 (T+144h):    +6 Days switching to alternative rail / direct one-click link

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
