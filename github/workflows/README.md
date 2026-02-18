# My Mutual Fund Dashboard

A personal mutual fund tracker for Indian markets, hosted on GitHub Pages.

## Setup (5 minutes)

1. Go to github.com and create a new public repository named mf-dashboard
2. Upload all files from this zip (keep the .github folder intact)
3. Go to Settings > Pages > Source > GitHub Actions
4. Wait about 1 minute
5. Your dashboard is live at: https://bkiritom8.github.io/mf-dashboard/ 

## How to use

- First visit: set a 4-digit PIN when prompted (or skip)
- Add Fund: search by name, enter amount invested, purchase date, and units held
- Compare: search any fund to see its XIRR side by side against yours
- Export: saves your portfolio as a JSON file (back this up regularly)
- Import: restore from a backup file

## Privacy

Your portfolio data never leaves your device. It is stored only in your browser
local storage. The GitHub repo contains zero personal data.

## Where to find your units

Check your broker app (Zerodha, Groww, etc.) or your CAMS/Kfintech statement.

## Removing the PIN

Open browser DevTools > Application > Local Storage > delete the mfd_pin key.