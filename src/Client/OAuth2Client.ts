import nodemailer, { Transporter } from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';

let transporter: Transporter | null = null;

/**
 * 建立一個使用 Google OAuth2 認證的 Nodemailer transporter。
 */
const createTransporter = async (): Promise<Transporter> => {
  try {
    const oauth2Client = new OAuth2Client(
      process.env.MAIL_CLIENT_ID,
      process.env.MAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.MAIL_REFRESH_TOKEN,
    });

    const accessTokenResponse = await oauth2Client.getAccessToken();
    const accessToken = accessTokenResponse.token;

    if (!accessToken) {
      throw new Error('Failed to create access token for email.');
    }

    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.MAIL_USER,
        clientId: process.env.MAIL_CLIENT_ID!,
        clientSecret: process.env.MAIL_CLIENT_SECRET!,
        refreshToken: process.env.MAIL_REFRESH_TOKEN!,
        accessToken: accessToken,
      },
    });
  } catch (error) {
    // 如果建立失敗，確保快取的 transporter 是 null，以便下次重試
    transporter = null;
    console.error('Error creating OAuth2 transporter:', error);
    throw error;
  }
};

/**
 * 獲取一個單例的 transporter。如果快取中不存在，則建立一個新的。
 * @returns {Promise<Transporter>} Nodemailer transporter 實例
 */
export const getTransporter = async (): Promise<Transporter> => {
  if (!transporter) {
    console.log('Creating new email transporter instance via OAuth2...');
    transporter = await createTransporter();
  }
  return transporter;
};

/**
 * 當認證失敗時，重設快取的 transporter。
 */
export const resetTransporter = () => {
  console.log('Authentication error detected, resetting transporter.');
  transporter = null;
};