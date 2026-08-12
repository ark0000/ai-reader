# AuraPDF — AI-Powered Universal Document Reader & Converter

## Project Overview


AuraPDF is a **premium dark-mode PDF converter** and **universal document reader** with integrated AI capabilities. It converts searchable PDFs to dark mode while preserving text layers, supports EPUB and Markdown reading, provides multi-provider AI chat with RAG, and features a rich, interactive frontend.

### Core Capabilities

| Capability | Description |
|---|---|
| **PDF to Dark Mode** | Converts light PDFs to dark mode using YCbCr color-space manipulation |
| **Smart Invert** | Preserves embedded images/diagrams while inverting text and backgrounds |
| **Custom Themes** | 4 built-in presets + fully customizable RGB background/text colors |
| **Live Preview** | Real-time server-side rendering of any page with current settings |
| **Parallel Processing** | Multi-threaded page compilation via ThreadPoolExecutor |
| **AI Reader** | Full document reader with AI chat, TTS, highlights, and notes |
| **Multi-Provider AI** | OpenAI, Anthropic, Gemini, Ollama, LM Studio via unified adapter |
| **RAG** | ChromaDB + sentence-transformers for context-aware document QA |
| **User Accounts** | JWT auth, conversion history, saved custom themes |

---

## 1.1 Quick Start: Setup & Run Local Development

Follow these steps to quickly get the backend running locally. Note: All imports are relative to the root project folder, so you **must** run the server from the root directory.

### Step 0: Fork and Clone the Repository
If you are contributing, first fork the repository on GitHub. Then clone your fork locally:
```bash
git clone https://github.com/<your-username>/app-agentic.git
cd app-agentic
```

### Step 1: Create a Virtual Environment (Recommended)
```bash
python -m venv venv

# On Windows:
venv\Scripts\activate
# On Mac/Linux:
source venv/bin/activate
```

### Step 2: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 3: Set Up Configuration
The repository includes an `.env.example` file. You must copy it to create your local `.env` configuration file:
```bash
# On Windows
copy .env.example .env

# On Mac/Linux
cp .env.example .env
```
*(Optional)* Open `.env` and add any API keys you wish to use (e.g., OpenAI, Anthropic), or leave them blank to configure them later in the UI.

### Step 4: Run the FastAPI Server
Do not `cd` into the `src` folder. Run the application as a module from the root of the project:
```bash
python -m uvicorn src.main:app --port 8080 --reload
```
The application will be running at `http://localhost:8080`.

### Step 5 (Optional): Frontend Tooling & Tests
If you want to run the Playwright End-to-End tests or modify the UnoCSS styling, install the Node dependencies:
```bash
npm install
npm run build:css   # To compile CSS changes
npx playwright test # To run E2E tests
```

---



---

## Complete Developer Documentation

For full architecture diagrams, data flows, API references, frontend/backend module specifications, and deployment instructions, please refer to the **[DEVELOPER_DOCS.md](./DEVELOPER_DOCS.md)** file.
