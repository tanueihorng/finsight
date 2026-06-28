# ▶ START HERE — How to run FINSIGHT // Personal Terminal

A private, Bloomberg-style stock-portfolio terminal that runs **on your own computer**.
100% free — no accounts, no API keys, nothing to pay. Your data never leaves your machine.

Takes about **3 minutes** to set up. You only do steps 1–2 once.

---

## Step 1 — Install Node.js (one time)

The app needs a free tool called **Node.js**.

1. Go to **https://nodejs.org**
2. Click the big **LTS** download button.
3. Open the downloaded installer and click through it (all defaults are fine).

That's the only thing you need to install.

---

## Step 2 — Get the app

Download it from GitHub: open **https://github.com/tanueihorng/finsight**, click the green
**`< > Code`** button → **Download ZIP**, then unzip it somewhere easy to find, like your **Desktop**.
You'll get a folder called `finsight-main` (you can rename it to `finsight`).

*(If you know Git, you can instead run `git clone https://github.com/tanueihorng/finsight.git`.)*

---

## Step 3 — Start it

### 🍎 On a Mac
- Open the folder and **double-click `start.command`**.
- A black Terminal window opens and says it's running. **Leave that window open** while you use the app.
- *First time only:* macOS may say the file "cannot be opened." If so, **right-click `start.command` → Open → Open**. (You only confirm once.)

### 🪟 On Windows
- Open the folder.
- Click the address bar at the top of the window, type **`cmd`**, and press Enter (this opens a command window in the folder).
- Type this and press Enter:
  ```
  node server.js
  ```
- **Leave that window open** while you use the app.

### 🐧 On Linux
- Open a terminal in the folder and run `node server.js`.

You should see:
```
FINSIGHT // PERSONAL TERMINAL
running at  http://localhost:8000
```

---

## Step 4 — Open it in your browser

Go to **http://localhost:8000**

The **very first time**, you'll be asked to **create a PIN** (4–12 digits). After that, you enter your
PIN each time you open the app to unlock it. (Forgot it? See the note at the bottom.)

Then a **welcome screen** asks your name and currency, and lets you:
- **Import from CSV** — paste/upload a spreadsheet of your holdings, or
- **Add manually** — type each stock, quantity, and your average buy price, or
- **Start empty** — and add things later.

That's it — you're in. 🎉

---

## To stop it
Close the Terminal/command window (or press **Ctrl + C** in it). To use the app again later, just
repeat **Step 3**.

---

## If something doesn't work

| Problem | Fix |
|---|---|
| **`node: command not found`** | Node.js isn't installed (Step 1), or you need to **close and reopen** the Terminal window after installing. |
| Mac: **`start.command` won't open** ("unidentified developer") | **Right-click it → Open → Open.** Or just run `node server.js` in Terminal instead. |
| Mac: double-click does nothing | In Terminal, run `chmod +x start.command` once, then double-click again. |
| **"Port 8000 in use"** / page won't load | Start it on another port: `PORT=9000 node server.js`, then open **http://localhost:9000**. |
| The page is blank / not loading | Make sure the Terminal window from Step 3 is **still open** — the app only runs while it's open. |

---

## Good to know
- **Your data is private.** Holdings are saved only on your computer in `data/portfolio.json`.
- **Forgot your PIN?** Delete the file `data/auth.json` in the app folder, then reopen — it'll let you
  set a new PIN. (Your holdings are untouched.)
- **It's free.** Prices come from free public sources (Yahoo Finance, World Bank, US Federal Reserve);
  data can be delayed up to ~15 minutes. This is for personal tracking, **not investment advice**.
- **Want more?** See [README.md](README.md) for all the features and commands, and [DOCS.md](DOCS.md)
  if you're a developer.
