# Target File Structure

meridian-bot/
├── README.md                  # how to run, what's stubbed
├── SPEC.md
├── PORTFOLIOS.md
├── ACCOUNTS.md
├── COMPLIANCE.md
├── STATE_MACHINE.md
├── GUARDRAILS.md
├── AUDIT.md
├── package.json
├── .env.example               # ANTHROPIC_API_KEY=
├── src/
│   ├── server/
│   │   ├── index.js           # Express app
│   │   ├── chat.js            # POST /api/chat handler
│   │   ├── audit.js           # GET /api/audit/:sessionId
│   │   ├── accounts.js        # mock account store
│   │   ├── portfolios.js      # portfolio limit constants
│   │   ├── auth.js            # authenticate(fields) → {ok, account}
│   │   ├── limits.js          # calculateSettlement, calculatePlan
│   │   ├── flags.js           # checkSpecialFlags(account)
│   │   ├── stateMachine.js    # transitions
│   │   ├── llm.js             # Anthropic SDK wrapper
│   │   ├── prompts.js         # system prompts per state
│   │   ├── guardrails.js      # validateResponse(text, account, limits)
│   │   ├── disclosures.js     # script strings + delivery tracking
│   │   └── sessions.js        # in-memory session Map
│   └── client/
│       ├── index.html
│       ├── main.jsx
│       ├── App.jsx            # chat UI + status bar
│       └── styles.css
└── tests/
    ├── auth.test.js
    ├── limits.test.js
    ├── flags.test.js
    └── guardrails.test.js
