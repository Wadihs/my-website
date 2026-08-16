# Craigslist-style Shared Message Board

This version is designed for GitHub Pages and uses Supabase as the shared database.

## Features

- Plain Helvetica/Craigslist-inspired styling
- Everyone sees the same messages
- Public visitors can post
- Messages are stored in Supabase
- The board refreshes when new messages arrive
- No custom server is required

## 1. Create a Supabase project

Create a Supabase project.

## 2. Create the database table

Open the Supabase SQL Editor, create a query, paste everything from `schema.sql`, and run it.

The SQL creates the `messages` table, enables Row Level Security, and permits public visitors to read and insert messages.

## 3. Add your public Supabase credentials

Open `config.js`.

Replace:

    https://YOUR-PROJECT.supabase.co

with your Project URL.

Replace:

    YOUR-PUBLISHABLE-OR-ANON-KEY

with a Supabase Publishable key. If your project uses legacy keys, the legacy anon key also works.

Supabase exposes these values in the project's Connect/API Keys area.

IMPORTANT: A publishable or legacy anon key is intended for client-side use when Row Level Security is configured. Never put a Secret key or `service_role` key in this website or a public GitHub repository.

## 4. Upload to GitHub

Create a repository and upload these website files to the repository root:

- `index.html`
- `styles.css`
- `script.js`
- `config.js`

Keeping `README.md` and `schema.sql` in the repository is optional but useful.

## 5. Enable GitHub Pages

In the repository, go to Settings -> Pages.

Under Build and deployment, choose `Deploy from a branch`, select your main branch and `/ (root)`, then save.

GitHub Pages will publish the static site.

## Important security limitation

This version deliberately permits anonymous posting. Anyone who can reach the Supabase endpoint through the site can submit a message that meets the database limits.

Before using it for a large or heavily publicized community, consider adding:

- moderation
- CAPTCHA/bot protection
- rate limiting
- authentication
- reporting
- spam filtering

The database currently enforces a maximum name length of 40 characters and message length of 500 characters.
