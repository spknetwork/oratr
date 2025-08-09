# Wallet Session Settings and Automation

This document describes the wallet session controls and automation feature in Oratr's Account Manager.

## Wallet Lock Settings

Open the Account Manager (click your account in the sidebar). Under "Wallet Session":

- Lock time slider: Choose a lock duration from 1 minute to 24 hours with common presets (1, 5, 10, 30 minutes, 1, 3, 6, 12, 24 hours).
- Inactivity-based timeout: When enabled, any wallet activity resets the lock timer. When disabled (continuous), the wallet locks after the chosen duration regardless of activity.
- Lock on window close: When enabled, closing all app windows immediately locks the wallet (app remains in tray as configured).

These preferences are stored in `~/.oratr/settings.json` under `walletLock` and apply immediately.

Example settings snippet:

```json
{
  "walletLock": {
    "durationMs": 1800000,
    "mode": "inactivity",
    "lockOnWindowClose": true
  }
}
```

## Per-Key Management

In the Edit Account view, you can:

- Add/replace individual keys (Posting, Active, Memo) by entering only the fields you want to change.
- Remove individual keys using the delete buttons, without removing the account.

## Automation (Posting Key)

Click "Enable Automation with @username" to allow background operations without prompts. This stores the Posting key in `settings.json`:

```json
{
  "automation": {
    "enabled": true,
    "username": "yourname",
    "postingKey": "<posting_wif>",
    "createdAt": 1731111111111
  }
}
```

Security note: The posting key is stored in plain text for unattended operations. Only enable on trusted machines. You can disable automation by clearing the `automation` section or toggling it off in future UI controls.


