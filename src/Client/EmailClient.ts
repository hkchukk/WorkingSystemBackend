import { getTransporter, resetTransporter } from './OAuth2Client';

/**
 * 發送電子郵件。
 * 從 OAuth2Client 獲取 transporter，並處理郵件的建構和發送。
 */
export const sendEmail = async (to: string, subject: string, html: string): Promise<any> => {
  try {
    // 1. 從 OAuth2Client 獲取經過認證的 transporter
    const emailTransporter = await getTransporter();

    // 2. 設定郵件選項
    const mailOptions = {
      from: `Work <${process.env.MAIL_USER}>`,
      to: to,
      subject: subject,
      html: html,
    };

    // 3. 發送郵件
    const info = await emailTransporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.response);
    return info;

  } catch (error) {
    console.error('Failed to send email:', error);

    // 4. 如果是認證錯誤，呼叫 resetTransporter 來清除舊的 transporter
    if ((error as any).code === 'EAUTH' || (error as any).code === 'EENVELOPE') {
      resetTransporter();
    }

    throw error;
  }
};