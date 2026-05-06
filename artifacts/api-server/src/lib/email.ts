import { logger } from "./logger";

interface NewExpenseClaimEmailOptions {
  toEmail: string;
  claimantName: string;
  amountAud: string;
  claimDate: string;
  description: string;
  project: string | null;
  adminExpensesUrl: string;
}

export async function sendNewExpenseClaimEmail(opts: NewExpenseClaimEmailOptions): Promise<boolean> {
  const host = process.env["SMTP_HOST"];
  const port = process.env["SMTP_PORT"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const from = process.env["SMTP_FROM"] ?? user ?? "noreply@krishnavillage.com.au";

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured — skipping new expense claim email (set SMTP_HOST, SMTP_USER, SMTP_PASS to enable)");
    return false;
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: port ? parseInt(port, 10) : 587,
      secure: (port ? parseInt(port, 10) : 587) === 465,
      auth: { user, pass },
    });

    const text = [
      `A new expense claim has been submitted and requires your acknowledgement within 48 hours.`,
      ``,
      `Claimant:     ${opts.claimantName}`,
      `Date:         ${opts.claimDate}`,
      `Description:  ${opts.description}`,
      opts.project ? `Project:      ${opts.project}` : null,
      `Amount (AUD): $${opts.amountAud}`,
      ``,
      `Review the claim here:`,
      opts.adminExpensesUrl,
      ``,
      `Krishna Village Admin`,
      `ISKCON Krishna Farm New Govardhan`,
    ]
      .filter((l) => l !== null)
      .join("\n");

    await transporter.sendMail({
      from: `"Krishna Village Admin" <${from}>`,
      to: opts.toEmail,
      subject: `New Expense Claim — ${opts.claimantName} ($${opts.amountAud} AUD)`,
      text,
    });

    logger.info({ to: opts.toEmail, claimant: opts.claimantName, amount: opts.amountAud }, "New expense claim email sent");
    return true;
  } catch (err) {
    logger.error({ err, to: opts.toEmail }, "Failed to send new expense claim email");
    return false;
  }
}

interface ReimbursementEmailOptions {
  toEmail: string;
  toName: string;
  claimDescription: string;
  claimDate: string;
  project: string | null;
  amountAud: string;
  reimbursedByName: string;
  notes: string | null;
}

export async function sendReimbursementEmail(opts: ReimbursementEmailOptions): Promise<boolean> {
  const host = process.env["SMTP_HOST"];
  const port = process.env["SMTP_PORT"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const from = process.env["SMTP_FROM"] ?? user ?? "noreply@krishnavillage.com.au";

  if (!host || !user || !pass) {
    logger.warn("SMTP not configured — skipping reimbursement email (set SMTP_HOST, SMTP_USER, SMTP_PASS to enable)");
    return false;
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host,
      port: port ? parseInt(port, 10) : 587,
      secure: (port ? parseInt(port, 10) : 587) === 465,
      auth: { user, pass },
    });

    const projectLine = opts.project ? `Project:      ${opts.project}\n` : "";
    const notesLine = opts.notes ? `\nNote from accounts: ${opts.notes}` : "";

    const text = [
      `Dear ${opts.toName},`,
      ``,
      `Your expense claim has been approved and reimbursed by ISKCON Krishna Farm New Govardhan.`,
      ``,
      `Claim details:`,
      `  Date:         ${opts.claimDate}`,
      `  Description:  ${opts.claimDescription}`,
      projectLine.trim() ? `  ${projectLine.trim()}` : null,
      `  Amount (AUD): $${opts.amountAud}`,
      ``,
      `Reimbursed by: ${opts.reimbursedByName}${notesLine}`,
      ``,
      `Thank you,`,
      `Accounts Team`,
      `ISKCON Krishna Farm New Govardhan (Krishna Village)`,
    ]
      .filter((l) => l !== null)
      .join("\n");

    await transporter.sendMail({
      from: `"Krishna Village Accounts" <${from}>`,
      to: `"${opts.toName}" <${opts.toEmail}>`,
      subject: `Expense Reimbursement Confirmed — $${opts.amountAud} AUD`,
      text,
    });

    logger.info({ to: opts.toEmail, amount: opts.amountAud }, "Reimbursement email sent");
    return true;
  } catch (err) {
    logger.error({ err, to: opts.toEmail }, "Failed to send reimbursement email");
    return false;
  }
}
