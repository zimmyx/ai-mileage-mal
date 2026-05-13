# Deploy AI Mileage Bot to Render

GitHub repo:

https://github.com/zimmyx/ai-mileage-mal

## 1. Open Render Blueprint

1. Login to the Render account for this mileage bot project.
2. Go to **Dashboard**.
3. Click **New +**.
4. Choose **Blueprint**.
5. Connect GitHub if Render asks.
6. Select this repo: `zimmyx/ai-mileage-mal`.
7. Render should detect `render.yaml`.
8. Click **Apply** / **Create New Resources**.

## 2. Add environment variables

In the Render service environment page, add these values:

```env
TELEGRAM_MILEAGE_BOT_TOKEN=your_bot_token
MY_CHAT_ID=your_telegram_chat_id
OPENROUTER_API_KEY=your_openrouter_key
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email
GOOGLE_PRIVATE_KEY=your_google_private_key
GOOGLE_MILEAGE_SHEET_ID=your_sheet_id
MILEAGE_RATE=0.60
```

Do not paste the example values. Use the real values from your local `.env` file.

## 3. First deploy

1. Click **Manual Deploy**.
2. Choose **Deploy latest commit**.
3. Wait until deploy status becomes **Live**.
4. Copy your Render service URL. Example:

```txt
https://mileage-bot.onrender.com
```

## 4. Set webhook URL variable

After Render gives you the final service URL:

1. Go to the service **Environment** tab.
2. Add or update:

```env
RENDER_EXTERNAL_URL=https://your-render-service-url.onrender.com
```

3. Save changes.
4. Redeploy the service.

The bot will then start in webhook mode.

## 5. Check health

Open this URL in browser:

```txt
https://your-render-service-url.onrender.com/health
```

Expected response:

```txt
OK
```

## 6. Test Telegram

Open Telegram and send:

```txt
/start
/status
Office ke KLCC 30km
```

## Notes

- Local `.env` is ignored by Git and should not be uploaded.
- Voice messages are currently disabled; use text mileage input.
- If Telegram does not respond after Render deploy, confirm `RENDER_EXTERNAL_URL` is exactly the Render URL with no trailing slash.
