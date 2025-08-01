import { createTransport } from 'nodemailer';
import { emailConfig } from '../config';

export const emailClient = createTransport(emailConfig);

export default emailClient;