import { Resend } from 'resend';
import { env } from '../config/env';

const resend = env.resend_api_key ? new Resend(env.resend_api_key) : null;

export const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> => {
  try {
    if (!resend) {
      console.warn('Resend API key is missing. Skipping email send.');
      return false;
    }

    const { data, error } = await resend.emails.send({
      from: env.resend_from_email || 'onboarding@resend.dev',
      to,
      subject,
      html,
    });

    if (error) {
      console.error('Failed to send email via Resend:', error);
      return false;
    }

    console.log('Email sent successfully:', data?.id);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};
