<!-- Converted 2026-09-16 by Cowork from the root file `Life-Command-Center-Setup-Guide.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**Life Command Center**

Setup & Deployment Guide

This guide walks you through setting up the Life Command Center app with Microsoft 365 integration and deploying it as a Progressive Web App (PWA) on your iPhone.

1\. What You Get

The Life Command Center is a task management dashboard that:

  - Organizes tasks across 7 life categories (Work, Personal, House, Kids, Family, Health, Finance)

  - Syncs two-way with Microsoft To Do — add or complete tasks in either place

  - Shows your Outlook Calendar events in the week view

  - Works offline on your iPhone as a home screen app (PWA)

  - Stores data locally in your browser with JSON export/import backup

2\. Azure App Registration (One-Time Setup)

To connect with Microsoft To Do and Outlook Calendar, you need to register the app with Azure Active Directory. This is free and takes about 10 minutes.

Step-by-Step Instructions

1.  **Go to the Azure Portal:** Open https://portal.azure.com and sign in with your Microsoft 365 account.

2.  **Navigate to App Registrations:** Search for "App registrations" in the top search bar, or go to Azure Active Directory \> App registrations.

3.  **Create a New Registration:** Click "+ New registration". Name it "Life Command Center". Under "Supported account types" select "Accounts in any organizational directory and personal Microsoft accounts". Click Register.

4.  **Copy the Client ID:** On the app overview page, copy the "Application (client) ID". This is a UUID like 12345678-abcd-1234-abcd-123456789abc. You’ll paste this into the app’s code.

5.  **Set the Redirect URI:** Go to Authentication \> Add a platform \> Single-page application. Set the Redirect URI to your hosting URL (e.g., https://yourusername.github.io/life-command-center/index.html for GitHub Pages, or http://localhost:8000/index.html for local testing). Click Configure.

6.  **Add API Permissions:** Go to API permissions \> Add a permission \> Microsoft Graph \> Delegated permissions. Add: Tasks.ReadWrite and Calendars.Read. Click "Add permissions".

7.  **Update the App Code:** Open index.html in a text editor. Find the line that says YOUR\_CLIENT\_ID\_HERE and replace it with the Client ID you copied in step 4. Save the file.

3\. Hosting Your App

The app needs to be hosted on a web server (not just opened as a local file) for the Microsoft authentication and PWA features to work. Here are your options:

Option A: GitHub Pages (Recommended — Free)

8.  Create a GitHub account at github.com if you don’t have one.

9.  Create a new repository named "life-command-center".

10. Upload all files from the life-command-center folder (index.html, manifest.json, sw.js, and the icons folder).

11. Go to Settings \> Pages. Under "Source" select "Deploy from a branch" and choose "main". Click Save.

12. Wait 1–2 minutes. Your app will be live at: https://yourusername.github.io/life-command-center/

13. Make sure to add this URL as a Redirect URI in your Azure app registration (Step 5 above).

Option B: Local Server (For Testing)

If you have Python installed, open a command prompt in the life-command-center folder and run:

python -m http.server 8000

Then open http://localhost:8000 in your browser. Use http://localhost:8000/index.html as the redirect URI in Azure.

4\. Adding to Your iPhone Home Screen

Once your app is hosted and accessible via a URL:

14. **Open Safari on your iPhone** (must be Safari — Chrome and other browsers don’t support PWA installation on iOS).

15. **Navigate to your app URL** (e.g., https://yourusername.github.io/life-command-center/).

16. **Tap the Share button** (the square with an arrow pointing up, at the bottom of Safari).

17. **Scroll down and tap "Add to Home Screen".** You can rename it if you like (default is "Life Tasks").

18. **Tap "Add".** The app icon will appear on your home screen.

19. **Open the app from your home screen.** It will launch in fullscreen mode without Safari’s address bar, looking like a native app.

5\. Using Microsoft Sync

First-Time Sign In

20. Click "Sign in with Microsoft" in the app header.

21. A Microsoft login popup will appear. Sign in with your Microsoft 365 account.

22. Grant the requested permissions (Tasks.ReadWrite and Calendars.Read).

23. The app will automatically create 7 lists in Microsoft To Do (Work, Personal, House Tasks, Kids Tasks, Family, Health & Fitness, Finance) and sync your existing tasks.

How Sync Works

  - **Adding a task:** When you add a task in the app, it automatically creates a matching task in the appropriate Microsoft To Do list.

  - **Completing a task:** Check off a task in the app, and it gets marked complete in Microsoft To Do (and vice versa on next sync).

  - **Deleting a task:** Delete a task in the app, and it’s removed from Microsoft To Do.

  - **Manual sync:** Tap the Sync button to pull the latest changes from Microsoft To Do.

  - **Offline mode:** If you’re offline, changes are saved locally and will sync when you’re back online.

  - **Calendar events:** Switch to Week View to see your Outlook calendar events displayed alongside your tasks.

6\. File Structure

Your life-command-center folder contains:

  - **index.html** — The main app (HTML + JavaScript + CSS, all in one file)

  - **manifest.json** — PWA configuration (app name, icons, display mode)

  - **sw.js** — Service worker for offline caching

  - **icons/** — App icons for home screen and splash screen

7\. Troubleshooting

  - **"Sign in failed":** Make sure your Client ID is correctly pasted in index.html and your redirect URI in Azure matches your hosting URL exactly.

  - **Popup blocked:** Allow popups for your hosting domain in your browser settings. Safari on iOS may require you to sign in via the browser first before using the home screen app.

  - **Tasks not syncing:** Tap the Sync button to force a refresh. Check that you granted Tasks.ReadWrite permission during sign-in.

  - **Calendar events not showing:** Switch to Week View and make sure you granted Calendars.Read permission. Events only load in the week view.

  - **App not working as PWA on iPhone:** Make sure you opened it in Safari (not Chrome). The app must be served over HTTPS for the service worker to activate.
