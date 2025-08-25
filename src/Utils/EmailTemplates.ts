export class EmailTemplates {
  /**
   * 生成密碼重設郵件 HTML 內容
   */
  static generatePasswordResetEmail(verificationCode: string, expiryMinutes: number = 30): string {
    return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>密碼重設驗證</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .container {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 10px;
            border: 1px solid #ddd;
        }
        .header {
            text-align: center;
            color: #2c3e50;
            margin-bottom: 30px;
        }
        .verification-code {
            background: #3498db;
            color: white;
            font-size: 32px;
            font-weight: bold;
            text-align: center;
            padding: 20px;
            border-radius: 8px;
            margin: 30px 0;
            letter-spacing: 8px;
        }
        .warning {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 5px;
            padding: 15px;
            margin: 20px 0;
            color: #856404;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 14px;
            color: #777;
        }
        .btn {
            display: inline-block;
            background: #27ae60;
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 5px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 密碼重設驗證</h1>
            <p>您好！我們收到了您的密碼重設請求</p>
        </div>

        <p>請使用以下 6 位數字驗證碼來重設您的密碼：</p>

        <div class="verification-code">
            ${verificationCode}
        </div>

        <div class="warning">
            <strong>⚠️ 重要提醒：</strong>
            <ul>
                <li>此驗證碼將在 <strong>${expiryMinutes} 分鐘</strong> 後失效</li>
                <li>請勿將此驗證碼分享給任何人</li>
                <li>如果您沒有請求密碼重設，請忽略此郵件</li>
            </ul>
        </div>

        <p>如果您無法使用驗證碼，請聯繫我們的客服團隊。</p>

        <div class="footer">
            <p>此郵件由系統自動發送，請勿回覆</p>
            <p>© 2025 KK 打工平台. 保留所有權利.</p>
        </div>
    </div>
</body>
</html>`;
  }

  /**
   * 生成密碼重設成功通知郵件
   */
  static generatePasswordResetSuccessEmail(): string {
    return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>密碼重設成功</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .container {
            background: #f9f9f9;
            padding: 30px;
            border-radius: 10px;
            border: 1px solid #ddd;
        }
        .header {
            text-align: center;
            color: #27ae60;
            margin-bottom: 30px;
        }
        .success-icon {
            font-size: 48px;
            text-align: center;
            margin: 20px 0;
        }
        .info-box {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            border-radius: 5px;
            padding: 15px;
            margin: 20px 0;
            color: #155724;
        }
        .footer {
            text-align: center;
            margin-top: 30px;
            font-size: 14px;
            color: #777;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ 密碼重設成功</h1>
        </div>

        <div class="success-icon">🎉</div>

        <p>您好！您的密碼已成功重設。</p>

        <div class="info-box">
            <strong>✅ 重設完成：</strong>
            <ul>
                <li>您的新密碼已生效</li>
                <li>可以使用新密碼登錄您的帳戶</li>
                <li>建議定期更新密碼以確保帳戶安全</li>
            </ul>
        </div>

        <p>如果這不是您本人的操作，請立即聯繫我們的客服團隊。</p>

        <div class="footer">
            <p>此郵件由系統自動發送，請勿回覆</p>
            <p>© 2025 KK 打工平台. 保留所有權利.</p>
        </div>
    </div>
</body>
</html>`;
  }
}
