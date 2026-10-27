# Daymark — Project Requirements

## Project scope

Daymark is a browser-based daily planner for faith, study, and personal tasks. It is a static HTML, CSS, and JavaScript application with no build step or external runtime packages.

## Current functional requirements

- Let the user add, edit, complete, restore, delete, and undo deletion of tasks.
- Store each task's title, category, date, optional start and due times, priority, notes, recurrence, and completion state.
- Support the built-in planner categories and user-defined categories.
- Search tasks, filter by status and category, sort the list, and view a selected date.
- Show daily task totals, completion progress, and overdue tasks.
- Allow light and dark themes.
- Show an in-page reminder 15 minutes before a task is due and another at its due time. Tasks without a due time use 9:00 PM.
- Let users enable optional browser notifications, test or mute the generated reminder tone, and choose how often an unfinished overdue task is reminded again.
- Keep reminder preferences and tasks in the current browser's local storage.
- Render user-entered task text as text rather than executable HTML.

## Browser and deployment requirements

- A modern browser with JavaScript and local storage enabled.
- Serve the app from `localhost` during development or from an HTTPS origin when deployed.
- Browser notification support and explicit user permission are required for operating-system notifications. Audio playback may require a user gesture and enabled device audio.
- The service worker supports notification interactions when the browser supports them. It does not provide a server-side push service or guarantee that scheduled reminders will be delivered while the app is closed, suspended, or restricted by the operating system.
- No package installation, compile step, database, or credentials are required for the local version.

## Data and privacy

- Tasks, theme preference, and reminder preferences are stored locally in the browser profile.
- This version does not upload data to a server and does not provide account-based sync or backup.
- Clearing browser storage or changing browser profiles can make locally stored planner data unavailable. Users should export or otherwise back up important data before clearing storage.

## Not included in this version

Cloud accounts and sync, calendar views, habits, journal entries, a focus timer, data export/import, installable PWA configuration, and reliable push notifications while the app is closed require separate implementation.
