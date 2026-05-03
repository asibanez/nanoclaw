/**
 * gmail_send — structurally-gated email send tool.
 *
 * Shows a Telegram confirmation card (Send / Cancel / Edit) before sending.
 * The agent calls this instead of mcp__gmail__send_email, which is removed
 * from TOOL_ALLOWLIST so it cannot be called directly.
 */
import { findQuestionResponse, markCompleted } from '../db/messages-in.js';
import { writeMessageOut } from '../db/messages-out.js';
import { getSessionRouting } from '../db/session-routing.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function log(msg: string): void {
  console.error(`[mcp-tools/gmail-send] ${msg}`);
}

function generateId(): string {
  return `gmailsend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildRfc2822(to: string, subject: string, body: string, cc?: string, inReplyTo?: string, references?: string): string {
  const lines: string[] = [];
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push(`Subject: ${subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('');
  lines.push(body);
  return lines.join('\r\n');
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function askConfirmation(title: string, question: string): Promise<'Send' | 'Cancel'> {
  const questionId = generateId();
  const r = getSessionRouting();
  const options = [
    { label: 'Send', selectedLabel: 'Sent ✓', value: 'Send' },
    { label: 'Cancel', selectedLabel: 'Cancelled', value: 'Cancel' },
  ];

  writeMessageOut({
    id: questionId,
    kind: 'chat-sdk',
    platform_id: r.platform_id,
    channel_type: r.channel_type,
    thread_id: r.thread_id,
    content: JSON.stringify({ type: 'ask_question', questionId, title, question, options }),
  });

  const deadline = Date.now() + 300_000; // 5 min timeout
  while (Date.now() < deadline) {
    const response = findQuestionResponse(questionId);
    if (response) {
      const parsed = JSON.parse(response.content) as { selectedOption?: string };
      markCompleted([response.id]);
      return (parsed.selectedOption === 'Send' ? 'Send' : 'Cancel');
    }
    await sleep(1000);
  }
  return 'Cancel'; // timeout → cancel
}

async function sendViaGmailApi(raw: string, threadId?: string): Promise<{ id: string; threadId: string }> {
  const body: Record<string, string> = { raw };
  if (threadId) body.threadId = threadId;

  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer onecli-managed',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gmail API error ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<{ id: string; threadId: string }>;
}

const gmailSendTool: McpToolDefinition = {
  tool: {
    name: 'gmail_send',
    description:
      'Send an email after showing the user a confirmation card in Telegram. The user must click "Send" before the email goes out. Use this for all outbound emails including replies and forwards — do NOT use mcp__gmail__send_email directly.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Recipient email address(es), comma-separated' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Plain-text email body' },
        cc: { type: 'string', description: 'CC recipients, comma-separated (optional)' },
        thread_id: { type: 'string', description: 'Gmail thread ID for replies/forwards (optional)' },
        in_reply_to: { type: 'string', description: 'Message-ID of the email being replied to (optional)' },
        references: { type: 'string', description: 'References header for threading (optional)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },

  async handler(args) {
    const to = args.to as string;
    const subject = args.subject as string;
    const body = args.body as string;
    const cc = args.cc as string | undefined;
    const threadId = args.thread_id as string | undefined;
    const inReplyTo = args.in_reply_to as string | undefined;
    const references = args.references as string | undefined;

    const draftLines = [`To: ${to}`];
    if (cc) draftLines.push(`Cc: ${cc}`);
    draftLines.push(`Subject: ${subject}`, '', body);
    const draftPreview = draftLines.join('\n');

    log(`Showing confirmation for email to ${to}`);
    const decision = await askConfirmation('Send email?', draftPreview);

    if (decision === 'Cancel') {
      log('User cancelled email send');
      return { content: [{ type: 'text' as const, text: 'Email cancelled — not sent.' }] };
    }

    try {
      const raw = base64UrlEncode(buildRfc2822(to, subject, body, cc, inReplyTo, references));
      const result = await sendViaGmailApi(raw, threadId);
      log(`Email sent: messageId=${result.id}`);
      return { content: [{ type: 'text' as const, text: `Email sent (id: ${result.id}).` }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`Send failed: ${msg}`);
      return { content: [{ type: 'text' as const, text: `Failed to send: ${msg}` }], isError: true };
    }
  },
};

registerTools([gmailSendTool]);
