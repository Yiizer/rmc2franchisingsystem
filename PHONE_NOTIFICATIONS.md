# Phone notifications: iPhone setup

RMC2 can send alerts to phones: new inquiries and emails, items waiting for approval, decisions on your work, protection reminders, and handover requests.
The lock screen shows only the event and the client name, for example "Progress report approved · Lakeside School".

## iPhone (iOS 16.4 or newer)

1. Open the RMC2 link in **Safari** and sign in.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open **RMC2** from the new Home Screen icon and sign in again if asked.
4. Go to **Account settings → Phone notifications** and tap **Turn on for this device**. Tap **Allow** when iOS asks.
5. Tap **Send a test**. An alert should arrive within a few seconds.

To change which alerts you get, use the checkboxes under "Send me". Choosing **Turn off** stops alerts on that phone only.

If an alert never arrives:
- **Notifications blocked:** iPhone Settings → Notifications → RMC2 → Allow Notifications.
- **Opened from Safari instead of the Home Screen icon:** Safari tabs cannot receive alerts on iPhone.
- **Focus mode on:** Focus / Do Not Disturb hides the alerts.

## Android and computers

Chrome and Edge work directly in the browser. No install is needed: Account settings → Phone notifications → Turn on. Private or incognito windows cannot receive alerts.

## Who gets what

| Alert | Goes to |
|---|---|
| New inquiry imported, or an email waiting on Requests | Employees (and Head/Supervisor, who also review Requests) |
| Proposal or progress report waiting for approval | Head and Supervisor |
| Proposal approved or returned; progress report approved or rejected | Whoever submitted it |
| Protection ends in 7 days / 2 days | The Division Head or SOA who owns the client |
| Handover requested, taken over, assigned to you | The people involved |

Division Heads and SOAs only ever get alerts about their own clients.

## For IT

- **Keys:** our own VAPID key pair, with no outside service. `RMC2_VAPID_PUBLIC_KEY`, `RMC2_VAPID_PRIVATE_KEY` and optional `RMC2_VAPID_SUBJECT` live in the Vercel project env. The test project's private key exists only there.
- **Storage:** subscriptions are in `push_subscriptions` (migration `20261106000000`). Muted types are in `settings` under `push:<user id>`. A phone that is uninstalled is removed automatically the next time a push fails (404/410).
- **Test version login:** the test version sits behind Vercel Authentication, and an app added to the Home Screen may need the Vercel sign-in again. Testers' phones need a Vercel share link (see REMAINING_WORK.md). Production will not have this extra sign-in.
