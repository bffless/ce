import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  AIToolPlugin,
  AIToolPluginMetadata,
  AIToolDefinition,
  AIToolContext,
} from '../ai-tool-plugin.interface';
import { AIToolPluginRegistry } from '../ai-tool-plugin.registry';
import { EmailService } from '../../../email/email.service';

@Injectable()
export class EmailContactPlugin implements AIToolPlugin {
  private readonly logger = new Logger(EmailContactPlugin.name);

  readonly metadata: AIToolPluginMetadata = {
    id: 'email-contact',
    name: 'Email Contact',
    description:
      'Collect visitor contact information through chat and send it via email. Works like a conversational contact form',
    category: 'communication',
    icon: 'mail',
    pipelineOptionsSchema: z.object({
      recipientEmail: z.string().email().describe('Email address to send contact submissions to'),
      recipientName: z
        .string()
        .optional()
        .describe(
          'Name of the person receiving submissions (used in chat, e.g. "I can have Sarah reach out to you")',
        ),
      emailSubjectPrefix: z
        .string()
        .optional()
        .describe('Prefix for email subject lines (default: "New Contact")'),
      requireName: z
        .boolean()
        .optional()
        .describe('Require the visitor to provide their name (default: true)'),
      requireEmail: z
        .boolean()
        .optional()
        .describe('Require the visitor to provide their email address'),
      requirePhone: z
        .boolean()
        .optional()
        .describe('Require the visitor to provide their phone number'),
      requireReason: z
        .boolean()
        .optional()
        .describe('Require the visitor to state a reason for contact (default: true)'),
    }),
  };

  constructor(
    private readonly registry: AIToolPluginRegistry,
    private readonly emailService: EmailService,
  ) {
    this.registry.register(this);
  }

  getTools(config: Record<string, unknown>): AIToolDefinition[] {
    return this.getToolsWithOptions(config);
  }

  getToolsWithOptions(
    config: Record<string, unknown>,
    pipelineOptions?: Record<string, unknown>,
  ): AIToolDefinition[] {
    const recipientEmail = pipelineOptions?.recipientEmail as string | undefined;

    if (!recipientEmail) {
      return [];
    }

    const requireName = pipelineOptions?.requireName !== false; // default true
    const requireEmail = pipelineOptions?.requireEmail === true; // default false
    const requirePhone = pipelineOptions?.requirePhone === true; // default false
    const requireReason = pipelineOptions?.requireReason !== false; // default true

    // Build required fields list for the tool description
    const requiredFields: string[] = [];
    if (requireName) requiredFields.push('name');
    if (requireEmail) requiredFields.push('email');
    if (requirePhone) requiredFields.push('phone');
    if (requireReason) requiredFields.push('reason for contact');

    // If neither email nor phone is explicitly required, the AI must still collect at least one
    const needsContactMethodReminder = !requireEmail && !requirePhone;

    let requiredDesc = '';
    if (requiredFields.length > 0) {
      requiredDesc = ` You MUST collect the following before calling this tool: ${requiredFields.join(', ')}.`;
    }
    if (needsContactMethodReminder) {
      requiredDesc +=
        ' You MUST also collect at least one contact method (email or phone) so the visitor can be reached.';
    }

    // Build input schema dynamically based on required field settings
    const contactName = requireName
      ? z.string().describe("The visitor's full name")
      : z.string().optional().describe("The visitor's full name (if provided)");
    const contactEmail = requireEmail
      ? z.string().email().describe("The visitor's email address")
      : z.string().email().optional().describe("The visitor's email address (if provided)");
    const contactPhone = requirePhone
      ? z.string().describe("The visitor's phone number")
      : z.string().optional().describe("The visitor's phone number (if provided)");
    const reason = requireReason
      ? z
          .string()
          .describe(
            'Brief description of why they want to be contacted (e.g. "Schedule a demo", "Pricing question", "Partnership inquiry")',
          )
      : z
          .string()
          .optional()
          .describe('Brief description of why they want to be contacted (if provided)');

    return [
      {
        name: 'send_contact_email',
        description: `Send the visitor's contact information and conversation history via email.${requiredDesc} Include the full conversation transcript.`,
        inputSchema: z.object({
          contactName,
          contactEmail,
          contactPhone,
          reason,
          preferredContactMethod: z
            .enum(['email', 'phone', 'either'])
            .optional()
            .describe('How the visitor prefers to be contacted (default: either)'),
          conversationTranscript: z
            .string()
            .describe(
              'The full conversation transcript between the assistant and the visitor, formatted as a readable log',
            ),
        }),
        execute: async (
          args: {
            contactName?: string;
            contactEmail?: string;
            contactPhone?: string;
            reason?: string;
            preferredContactMethod?: string;
            conversationTranscript: string;
          },
          context: AIToolContext,
        ) => {
          return this.sendContactEmail(args, context, pipelineOptions);
        },
      },
    ];
  }

  getSystemPromptInstructions(pipelineOptions?: Record<string, unknown>): string | null {
    const recipientName = pipelineOptions?.recipientName as string | undefined;
    const recipientEmail = pipelineOptions?.recipientEmail as string | undefined;

    if (!recipientEmail) {
      return null;
    }

    const nameRef = recipientName || 'our team';

    const requireName = pipelineOptions?.requireName !== false;
    const requireEmail = pipelineOptions?.requireEmail === true;
    const requirePhone = pipelineOptions?.requirePhone === true;
    const requireReason = pipelineOptions?.requireReason !== false;

    // Build collection instructions based on required fields
    const requiredItems: string[] = [];
    const optionalItems: string[] = [];

    if (requireName) requiredItems.push('their name');
    else optionalItems.push('their name');

    if (requireEmail) requiredItems.push('their email address');
    else optionalItems.push('their email address');

    if (requirePhone) requiredItems.push('their phone number');
    else optionalItems.push('their phone number');

    if (requireReason) requiredItems.push('the reason for their inquiry');
    else optionalItems.push('the reason for their inquiry');

    // If neither email nor phone is explicitly required, remind the AI it still needs one
    const needsContactMethodReminder = !requireEmail && !requirePhone;

    let requiredLine =
      requiredItems.length > 0
        ? `You MUST collect the following before sending: ${requiredItems.join(', ')}.`
        : '';
    if (needsContactMethodReminder) {
      requiredLine +=
        ' You MUST also collect at least one contact method (email address or phone number) so the visitor can be reached.';
    }
    const optionalLine =
      optionalItems.length > 0
        ? `If possible, also try to collect: ${optionalItems.join(', ')}.`
        : '';

    return `You have the ability to collect visitor contact information and send it via email to ${nameRef}. When a visitor seems interested in being contacted, scheduling a demo, getting a quote, or has a question that requires follow-up:

1. Naturally guide the conversation to collect their information. ${requiredLine} ${optionalLine}
2. Ask how they prefer to be contacted (email, phone, or either).
3. Once you have the required information, use the send_contact_email tool. Include the COMPLETE conversation transcript in the conversationTranscript field so ${nameRef} has full context.
4. After sending, confirm to the visitor that their information has been sent and ${nameRef} will follow up.

Be conversational and helpful — don't make it feel like a form. Gather information naturally through dialogue.`;
  }

  private async sendContactEmail(
    args: {
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      reason?: string;
      preferredContactMethod?: string;
      conversationTranscript: string;
    },
    context: AIToolContext,
    pipelineOptions?: Record<string, unknown>,
  ): Promise<any> {
    const recipientEmail = pipelineOptions?.recipientEmail as string;
    const subjectPrefix = (pipelineOptions?.emailSubjectPrefix as string) || 'New Contact';

    if (!this.emailService.isConfigured()) {
      return {
        error:
          'Email service is not configured. Please configure SMTP settings in the admin panel.',
      };
    }

    if (!args.contactEmail && !args.contactPhone) {
      return {
        error: 'At least one contact method (email or phone) is required.',
      };
    }

    const displayName = args.contactName || 'Unknown';
    const displayReason = args.reason || 'General inquiry';
    const subject = `${subjectPrefix}: ${displayName} - ${displayReason}`;

    const contactMethodLine = args.preferredContactMethod
      ? `<strong>Preferred Contact:</strong> ${args.preferredContactMethod}`
      : '';

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; color: #333;">
  <div style="background: #f8f9fa; padding: 20px; border-radius: 8px 8px 0 0; border-bottom: 3px solid #0066cc;">
    <h2 style="margin: 0; color: #0066cc;">${subjectPrefix}</h2>
    <p style="margin: 8px 0 0; color: #666;">Submitted via chat conversation</p>
  </div>

  <div style="padding: 20px; border: 1px solid #e9ecef; border-top: none;">
    <h3 style="margin-top: 0; color: #495057;">Contact Information</h3>
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 12px; font-weight: bold; width: 160px; vertical-align: top;">Name:</td>
        <td style="padding: 8px 12px;">${this.escapeHtml(displayName)}</td>
      </tr>
      ${args.contactEmail ? `<tr><td style="padding: 8px 12px; font-weight: bold; vertical-align: top;">Email:</td><td style="padding: 8px 12px;"><a href="mailto:${this.escapeHtml(args.contactEmail)}">${this.escapeHtml(args.contactEmail)}</a></td></tr>` : ''}
      ${args.contactPhone ? `<tr><td style="padding: 8px 12px; font-weight: bold; vertical-align: top;">Phone:</td><td style="padding: 8px 12px;"><a href="tel:${this.escapeHtml(args.contactPhone)}">${this.escapeHtml(args.contactPhone)}</a></td></tr>` : ''}
      ${contactMethodLine ? `<tr><td style="padding: 8px 12px; font-weight: bold; vertical-align: top;">Preferred Contact:</td><td style="padding: 8px 12px;">${this.escapeHtml(args.preferredContactMethod || 'either')}</td></tr>` : ''}
      <tr>
        <td style="padding: 8px 12px; font-weight: bold; vertical-align: top;">Reason:</td>
        <td style="padding: 8px 12px;">${this.escapeHtml(displayReason)}</td>
      </tr>
    </table>

    <h3 style="margin-top: 24px; color: #495057;">Conversation History</h3>
    <div style="background: #f8f9fa; padding: 16px; border-radius: 6px; border: 1px solid #e9ecef; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">
${this.escapeHtml(args.conversationTranscript)}
    </div>
  </div>

  <div style="padding: 12px 20px; background: #f8f9fa; border: 1px solid #e9ecef; border-top: none; border-radius: 0 0 8px 8px; font-size: 12px; color: #999;">
    Sent by BFFless Email Contact Plugin
  </div>
</div>`;

    const text = `${subjectPrefix}
Submitted via chat conversation

Contact Information
-------------------
Name: ${displayName}
${args.contactEmail ? `Email: ${args.contactEmail}` : ''}
${args.contactPhone ? `Phone: ${args.contactPhone}` : ''}
${args.preferredContactMethod ? `Preferred Contact: ${args.preferredContactMethod}` : ''}
Reason: ${displayReason}

Conversation History
--------------------
${args.conversationTranscript}
`;

    // Fire-and-forget: send email in background so the chat response isn't delayed
    this.emailService
      .sendEmail({
        to: recipientEmail,
        subject,
        html,
        text,
        replyTo: args.contactEmail,
      })
      .catch((error) => {
        this.logger.error(`Failed to send contact email: ${(error as Error).message}`);
      });

    return {
      success: true,
      message: `Contact information for ${displayName} has been sent to the team.`,
    };
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
