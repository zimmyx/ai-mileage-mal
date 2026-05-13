# What's New - AI Mileage Bot

## Latest Update 2

### Personal-use Improvements
- Added odometer memory: if a new input only has `odoEnd`, bot can use the previous `Odo End` as the new `Odo Start`.
- Added duplicate detection before saving.
- Added `/editlast` command for quick correction of the latest record.
- Improved PDF claim report with name, rate, signature, and approval section.
- Friday reminder is now smart: it only reminds if there is no mileage record for the current week.

### Smarter Free Parsing
- Added a free local parser before AI fallback.
- Simple inputs like `Office ke KLCC 30km`, `JKR 12000-12045`, and `KLCC odo 12080` can be parsed without calling AI.
- OpenRouter free models are kept as fallback only when local parser cannot understand the input.

### New Command

#### `/editlast <field> <value>`
Edits the latest mileage record.

Examples:

```txt
/editlast distance 35
/editlast destination KLCC
/editlast date 2026-05-13
/editlast odoend 12080
```

---

## Latest Update

### Safety & Access Control
- Added optional Telegram chat ID whitelist using `ALLOWED_CHAT_IDS`.
- If `ALLOWED_CHAT_IDS` is empty, bot remains open to all users.
- Recommended to set your own Telegram chat ID later for better security.

### Confirmation Before Saving
- Bot now shows parsed mileage records before saving.
- User must tap:
  - ✅ Confirm to save
  - ❌ Cancel to discard
- Confirmation expires automatically after 5 minutes.

### New Commands

#### `/help`
Shows examples and format guide.

#### `/today`
Shows today's total mileage, claim, and trip count.

#### `/undo`
Deletes the latest mileage record from Google Sheet.

#### `/delete <row_number>`
Deletes a specific Google Sheet row.
Example:

```txt
/delete 25
```

#### `/export`
Generates PDF mileage report for the current month.

#### `/export YYYY-MM`
Generates PDF mileage report for a specific month.
Example:

```txt
/export 2026-05
```

### Reporting Improvements
- Added PDF export using `pdfkit`.
- Added monthly report rows retrieval for export.
- Weekly summary now checks current year too.
- Monthly report already checks month and year.

### Dashboard
- Added simple web dashboard at:

```txt
https://ai-mileage-mal.onrender.com
```

- Health endpoint remains:

```txt
https://ai-mileage-mal.onrender.com/health
```

### Error Logging
- Bot now logs errors to a `Logs` tab in Google Sheet.
- If the `Logs` sheet does not exist, it will be created automatically.

### Validation
Before saving, bot now checks:

- Destination cannot be empty.
- Distance must be more than 0.
- Distance cannot exceed 1000km.
- Odo End cannot be smaller than Odo Start.

### Voice Messages
- Voice messages remain disabled for now.
- Bot replies with instruction to use text.
- This prevents broken voice handling until transcription is added properly.

### Render Deployment
- Render uses `npm start`.
- Health check path is `/health`.
- Webhook mode uses `RENDER_EXTERNAL_URL`.

## Not Included

### Keep-alive
- Not added, as requested.

## Important Setup Notes

To enable whitelist, add this in Render Environment:

```env
ALLOWED_CHAT_IDS=your_telegram_chat_id
```

To enable Friday reminder, add:

```env
MY_CHAT_ID=your_telegram_chat_id
```
