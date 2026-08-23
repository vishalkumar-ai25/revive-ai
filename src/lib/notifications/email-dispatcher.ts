import { Resend } from 'resend';
import { db } from '@/lib/db';
import crypto from "crypto";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export class EmailDispatcher {
  /**
   * Dispatches a recovery email.
   * If RESEND_API_KEY is not configured, it fails gracefully and logs to the audit trail.
   */
  static async sendRecoveryEmail(
    paymentId: string,
    customerEmail: string,
    amount: number,
    messageContent: string
  ): Promise<boolean> {
    const secret = process.env.RECOVERY_LINK_HMAC_SECRET;
    if (!secret) {
      throw new Error("RECOVERY_LINK_HMAC_SECRET environment variable must be set to generate recovery links.");
    }
    
    const signature = crypto
      .createHmac("sha256", secret)
      .update(paymentId)
      .digest("hex");
    const recoveryLink = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/recover/${paymentId}?sig=${signature}`;
    const htmlContent = `
      <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto;">
        <h2 style="color: #4f46e5;">Action Required: Payment Failed</h2>
        <p>Your recent payment of <strong>₹${amount.toLocaleString()}</strong> could not be processed.</p>
        <p style="background-color: #f3f4f6; padding: 12px; border-left: 4px solid #4f46e5;">
          ${messageContent}
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${recoveryLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            Complete Payment
          </a>
        </div>
        <p style="font-size: 12px; color: #6b7280;">If you did not make this transaction, please contact your bank.</p>
      </div>
    `;

    if (!resend) {
      console.warn('[EmailDispatcher] RESEND_API_KEY not set. Simulating email dispatch.');
      await db.auditLog.create({
        data: {
          agentName: 'EmailDispatcher',
          action: 'EMAIL_DISPATCH_SIMULATED',
          reasoning: 'API key missing. Email would have been sent.',
          metadata: { to: customerEmail, simulated: true, link: recoveryLink },
          payment: { connect: { id: paymentId } }
        }
      });
      return true;
    }

    try {
      await resend.emails.send({
        from: 'ReviveAI <recovery@resend.dev>',
        to: customerEmail,
        subject: 'Action Required: Payment Failed',
        html: htmlContent,
      });

      await db.auditLog.create({
        data: {
          agentName: 'EmailDispatcher',
          action: 'EMAIL_DISPATCHED',
          reasoning: 'Successfully sent recovery email via Resend.',
          metadata: { to: customerEmail, link: recoveryLink },
          payment: { connect: { id: paymentId } }
        }
      });
      return true;
    } catch (error) {
      console.error('[EmailDispatcher] Failed to send email:', error);
      await db.auditLog.create({
        data: {
          agentName: 'EmailDispatcher',
          action: 'EMAIL_DISPATCH_FAILED',
          reasoning: 'Resend API returned an error.',
          metadata: { error: String(error) },
          payment: { connect: { id: paymentId } }
        }
      });
      return false;
    }
  }
}
