/**
 * Email Service Utilities
 * 
 * Handles sending emails via Resend API for:
 * - Magic link authentication
 * - User invitations
 * - Alert notifications
 */

/**
 * Email template types
 */
export type EmailTemplate = 
  | 'magic-link'
  | 'invitation'
  | 'alert-digest'
  | 'entity-approved'
  | 'entity-rejected';

/**
 * Send an email using Resend API
 */
export async function sendEmail(
  apiKey: string,
  options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    from?: string;
  }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const { to, subject, html, text, from = '1C Portal <noreply@1c-portal.com>' } = options;
  
  console.log('[Email] Sending email to:', to, 'subject:', subject);
  
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text: text || stripHtml(html)
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('[Email] Send failed:', error);
      return { success: false, error };
    }
    
    const result = await response.json() as { id: string };
    console.log('[Email] Sent successfully, ID:', result.id);
    
    return { success: true, id: result.id };
    
  } catch (error) {
    console.error('[Email] Send error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Strip HTML tags for plain text version
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Send magic link email
 */
export async function sendMagicLinkEmail(
  apiKey: string,
  email: string,
  magicLink: string,
  expiresInMinutes: number = 10
): Promise<{ success: boolean; error?: string }> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 10px;">1C Portal</h1>
      </div>
      
      <div style="background: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-top: 0;">Sign in to your account</h2>
        <p style="color: #4a4a4a; line-height: 1.6;">
          Click the button below to securely sign in to your 1C Portal account. 
          This link will expire in ${expiresInMinutes} minutes.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${magicLink}" 
             style="background: #2563eb; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
            Sign In
          </a>
        </div>
        
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">
          If you didn't request this email, you can safely ignore it.
        </p>
      </div>
      
      <div style="text-align: center; color: #9ca3af; font-size: 12px;">
        <p>
          If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${magicLink}" style="color: #6b7280; word-break: break-all;">${magicLink}</a>
        </p>
      </div>
    </body>
    </html>
  `;
  
  return sendEmail(apiKey, {
    to: email,
    subject: 'Sign in to 1C Portal',
    html
  });
}

/**
 * Send user invitation email
 */
export async function sendInvitationEmail(
  apiKey: string,
  email: string,
  inviteLink: string,
  organizationName: string,
  inviterName: string
): Promise<{ success: boolean; error?: string }> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 10px;">1C Portal</h1>
      </div>
      
      <div style="background: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-top: 0;">You've been invited!</h2>
        <p style="color: #4a4a4a; line-height: 1.6;">
          <strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> on 1C Portal.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${inviteLink}" 
             style="background: #2563eb; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
            Accept Invitation
          </a>
        </div>
        
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 0;">
          This invitation will expire in 7 days.
        </p>
      </div>
    </body>
    </html>
  `;
  
  return sendEmail(apiKey, {
    to: email,
    subject: `You've been invited to join ${organizationName}`,
    html
  });
}

/**
 * Send entity approval notification
 */
export async function sendApprovalNotification(
  apiKey: string,
  email: string,
  entityName: string,
  entityUrl: string,
  approved: boolean,
  feedback?: string
): Promise<{ success: boolean; error?: string }> {
  const status = approved ? 'approved' : 'rejected';
  const statusColor = approved ? '#10b981' : '#ef4444';
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 10px;">1C Portal</h1>
      </div>
      
      <div style="background: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
        <h2 style="color: #1a1a1a; font-size: 20px; margin-top: 0;">
          Entity ${approved ? 'Approved' : 'Returned for Revision'}
        </h2>
        <p style="color: #4a4a4a; line-height: 1.6;">
          Your entity <strong>"${entityName}"</strong> has been 
          <span style="color: ${statusColor}; font-weight: 600;">${status}</span>.
        </p>
        
        ${feedback ? `
          <div style="background: white; border-left: 4px solid ${statusColor}; padding: 15px; margin: 20px 0;">
            <p style="color: #4a4a4a; margin: 0;"><strong>Feedback:</strong></p>
            <p style="color: #6b7280; margin: 10px 0 0 0;">${feedback}</p>
          </div>
        ` : ''}
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${entityUrl}" 
             style="background: #2563eb; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; display: inline-block;">
            View Entity
          </a>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return sendEmail(apiKey, {
    to: email,
    subject: `Entity ${approved ? 'Approved' : 'Needs Revision'}: ${entityName}`,
    html
  });
}
