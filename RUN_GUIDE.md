# How to Run Debt-Settle Locally

This guide explains how to start both the backend API and the React frontend to test the full UI/UX.

---

## Prerequisites
- Python 3.10+
- Node.js 18+ & npm

---

## 1. Start the Backend API (FastAPI)

Open a terminal in the project root directory and run:

```powershell
cd "c:\Users\kumar\Desktop\Projects\Dept setteler"
python -m uvicorn main:app --reload --port 8000
```

- **API URL**: [http://localhost:8000](http://localhost:8000)
- **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)

---

## 2. Start the Frontend (React + Vite)

Open a second terminal window and run:

```powershell
cd "c:\Users\kumar\Desktop\Projects\Dept setteler\frontend"
npm run dev
```

- **Frontend App URL**: [http://localhost:5173](http://localhost:5173)

---

## 3. How to Test the Flow

1. Open **[http://localhost:5173](http://localhost:5173)** in your browser.
2. **Instant Dev Sign-In**: Click any dev user button (e.g. `Aarav`, `Anish`, `Rahul`, `Priya`) or enter a custom username.
3. **Dashboard**:
   - View your expense groups in the olive/cream mobile-first list view.
   - Click the pinned **"+ Create a new group"** button at the bottom.
4. **2-Step Create Group Modal**:
   - **Step 1 (Details)**: Enter group name and optional UPI ID. Click **"Next →"** (no API call happens yet; purely local state).
   - **Step 2 (Invites & Chips)**:
     - Search registered users in the **Username** tab with 250ms debounced lookup.
     - Tap a user or click `+ Add` to add them as an invite chip.
     - Switch to **Email** tab to add email invite chips marked `(pending)`.
     - Remove chips anytime with the `✕` button.
     - Click **"Create group + N invites"** to finalize group creation, dispatch all invites, and view the summary with your 1-tap shareable join link.
5. **Group Details**:
   - Track balances, log multi-payer / unequal split expenses, view member roster, and chat with your group.
