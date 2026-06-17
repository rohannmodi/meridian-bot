import { useState, useRef, useEffect, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const RUNG_ORDER = ['PIF', 'BIF_PAYMENTS', 'SIF', 'SIF_PAYMENTS', 'PPA'];
const RUNG_LABEL = {
  PIF:          'Pay in Full',
  BIF_PAYMENTS: 'Balance / Payments',
  SIF:          'Settlement',
  SIF_PAYMENTS: 'Settlement / Installments',
  PPA:          'Payment Plan',
};

const DEV_ACCOUNTS = [
  { ref: 'ACC-001', first: 'Sarah',  last: 'Johnson', ssn4: '4321', zip: '10001', note: 'P-200 · $4,200 · NY (preferred lang)' },
  { ref: 'ACC-002', first: 'Luis',   last: 'Martinez',ssn4: '8765', zip: '94102', note: 'P-100 · $8,500 · CA (preferred lang)' },
  { ref: 'ACC-003', first: 'Wei',    last: 'Chen',    ssn4: '1122', zip: '60601', note: 'P-300 · $2,100 · pre-legal' },
  { ref: 'ACC-004', first: 'Mary',   last: 'Wilson',  ssn4: '5544', zip: '30301', note: 'BKY flag → escalate' },
  { ref: 'ACC-005', first: 'Anita',  last: 'Patel',   ssn4: '9988', zip: '02101', note: 'DSP flag → escalate' },
  { ref: 'ACC-006', first: 'Ryan',   last: 'OBrien',  ssn4: '3344', zip: '98101', note: 'CNA flag → escalate' },
  { ref: 'ACC-007', first: 'Maria',  last: 'Garcia',  ssn4: '7777', zip: '75201', note: 'P-200 · $3,200 · TX' },
  { ref: 'ACC-008', first: 'David',  last: 'Kim',     ssn4: '2211', zip: '02906', note: 'VOD flag → escalate' },
  { ref: 'ACC-009', first: 'James',  last: 'Foster',  ssn4: '6655', zip: '33101', note: 'P-100 · $12,000 · cap hit' },
];

// ─── Voice hook ───────────────────────────────────────────────────────────────

function useVoice() {
  const [supported,  setSupported]  = useState(false);
  const [voiceOn,    setVoiceOn]    = useState(false);
  const [listening,  setListening]  = useState(false);
  const [speaking,   setSpeaking]   = useState(false);

  const recognitionRef  = useRef(null);
  const voiceOnRef      = useRef(false);
  const listeningRef    = useRef(false);

  // Keep refs in sync
  useEffect(() => { voiceOnRef.current   = voiceOn;   }, [voiceOn]);
  useEffect(() => { listeningRef.current = listening;  }, [listening]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    setSupported(true);
    const r = new SR();
    r.continuous      = false;
    r.interimResults  = false;
    r.lang            = 'en-US';
    r.onend           = () => setListening(false);
    r.onerror         = () => setListening(false);
    recognitionRef.current = r;
    return () => {
      try { r.stop(); } catch (_) {}
      try { window.speechSynthesis?.cancel(); } catch (_) {}
    };
  }, []);

  /** Start listening. onResult(text) is called with the transcript.
   *  onAutoSubmit(text) is called 1.5 s after a result if voice is still on. */
  const startListening = useCallback((onResult, onAutoSubmit) => {
    const r = recognitionRef.current;
    if (!r || listeningRef.current) return;
    try {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      r.onresult = (evt) => {
        const text = evt.results[0][0].transcript.trim();
        onResult(text);
        if (voiceOnRef.current) {
          setTimeout(() => { if (voiceOnRef.current) onAutoSubmit(text); }, 1500);
        }
      };
      r.start();
      setListening(true);
    } catch (e) {
      console.warn('[voice] startListening error:', e.message);
      setListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch (_) {}
    setListening(false);
  }, []);

  /** Speak text via SpeechSynthesis. Calls onDone when utterance ends. */
  const speak = useCallback((text, onDone) => {
    if (!window.speechSynthesis) { onDone?.(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate  = 1.0;
      u.pitch = 1.0;
      // Prefer a natural-sounding voice if available
      const loadVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        const pref = voices.find(v => /Google US English|Samantha|Alex/i.test(v.name));
        if (pref) u.voice = pref;
      };
      loadVoice();
      // Chrome loads voices async
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoice;
      }
      u.onstart = () => setSpeaking(true);
      u.onend   = () => { setSpeaking(false); onDone?.(); };
      u.onerror = () => { setSpeaking(false); onDone?.(); };
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.warn('[voice] speak error:', e.message);
      setSpeaking(false);
      onDone?.();
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel(); } catch (_) {}
    setSpeaking(false);
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceOn(prev => {
      if (prev) {
        // Turning off
        try { recognitionRef.current?.stop(); } catch (_) {}
        try { window.speechSynthesis?.cancel(); } catch (_) {}
        setSpeaking(false);
        setListening(false);
      }
      return !prev;
    });
  }, []);

  return { supported, voiceOn, listening, speaking, startListening, stopListening, speak, stopSpeaking, toggleVoice };
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="10" stroke="white" strokeWidth="1.5"/>
      <path d="M7 11h8M11 7v8" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function MicIcon({ listening }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.5"/>
      {listening && <rect x="5" y="1" width="6" height="9" rx="3" fill="currentColor" opacity="0.3"/>}
      <path d="M2 8c0 3.314 2.686 6 6 6s6-2.686 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="8" y1="14" x2="8" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: 4 }}>
      <path d="M3 6H1v4h2l4 3V3L3 6z" fill="currentColor"/>
      <path d="M11.5 4.5a5 5 0 0 1 0 7M9.5 6.5a2.5 2.5 0 0 1 0 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function OfferTrack({ offers, currentRung }) {
  if (!offers) return null;
  return (
    <div className="offer-track">
      {RUNG_ORDER.map((rung, i) => {
        const done    = offers[rung] && rung !== currentRung;
        const active  = rung === currentRung;
        const pending = !done && !active;
        return (
          <div key={rung} className={`ot-item ${done ? 'ot-done' : ''} ${active ? 'ot-active' : ''} ${pending ? 'ot-pending' : ''}`}>
            <div className="ot-circle">
              {done ? (
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
              ) : (
                <span>{i + 1}</span>
              )}
            </div>
            <span className="ot-label">{RUNG_LABEL[rung]}</span>
            {i < RUNG_ORDER.length - 1 && <div className="ot-line" />}
          </div>
        );
      })}
    </div>
  );
}

function Bubble({ role, content, speaking }) {
  const isBot       = role === 'assistant';
  const isSpecialist= role === 'specialist';
  const isSystem    = role === 'system';

  if (isSystem) {
    return <div className="system-msg">{content}</div>;
  }

  const lines = content.split('\n');
  return (
    <div className={`bubble-row ${isBot || isSpecialist ? 'bubble-bot' : 'bubble-user'}`}>
      {(isBot || isSpecialist) && (
        <div className={`bubble-avatar ${isSpecialist ? 'avatar-specialist' : ''}`}>
          {isSpecialist ? 'S' : 'M'}
        </div>
      )}
      <div className={`bubble ${isBot ? 'bubble-bot-inner' : isSpecialist ? 'bubble-specialist-inner' : 'bubble-user-inner'}`}>
        {isSpecialist && <span className="specialist-label">Specialist</span>}
        {lines.map((line, i) => (
          <span key={i}>{line}{i < lines.length - 1 && <br />}</span>
        ))}
        {isBot && speaking && <SpeakerIcon />}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="bubble-row bubble-bot">
      <div className="bubble-avatar">M</div>
      <div className="bubble bubble-bot-inner">
        <div className="typing"><span/><span/><span/></div>
      </div>
    </div>
  );
}

function AuthPanel({ onSubmit, attemptsRemaining, loading }) {
  const blank = { accountRef: '', firstName: '', lastName: '', ssn4: '', zip: '' };
  const [fields, setFields] = useState(blank);
  const [showDev, setShowDev] = useState(false);

  const set = (k, v) => setFields(p => ({ ...p, [k]: v }));
  const allFilled = Object.values(fields).every(v => v.trim());

  function submit(e) {
    e.preventDefault();
    if (!allFilled || loading) return;
    onSubmit(fields);
    setFields(blank);
  }

  function fill(a) {
    setFields({ accountRef: a.ref, firstName: a.first, lastName: a.last, ssn4: a.ssn4, zip: a.zip });
    setShowDev(false);
  }

  const warn = attemptsRemaining != null && attemptsRemaining <= 2;

  return (
    <div className="auth-panel">
      <div className="auth-header">
        <span className="auth-title">Verify Identity</span>
        <button type="button" className="dev-toggle" onClick={() => setShowDev(s => !s)}>
          {showDev ? 'Hide' : 'Dev accounts'}
        </button>
      </div>

      {showDev && (
        <div className="dev-panel">
          {DEV_ACCOUNTS.map(a => (
            <button key={a.ref} className="dev-row" onClick={() => fill(a)}>
              <span className="dev-ref">{a.ref}</span>
              <span className="dev-name">{a.first} {a.last}</span>
              <span className="dev-note">{a.note}</span>
            </button>
          ))}
        </div>
      )}

      {warn && (
        <div className="auth-warn">
          ⚠ {attemptsRemaining} attempt{attemptsRemaining !== 1 ? 's' : ''} remaining
        </div>
      )}

      <form className="auth-form" onSubmit={submit}>
        <div className="auth-row">
          <div className="auth-field">
            <label>Account Ref</label>
            <input value={fields.accountRef} onChange={e => set('accountRef', e.target.value)}
              placeholder="ACC-001" disabled={loading} autoFocus />
          </div>
          <div className="auth-field">
            <label>First Name</label>
            <input value={fields.firstName} onChange={e => set('firstName', e.target.value)}
              placeholder="First" disabled={loading} />
          </div>
          <div className="auth-field">
            <label>Last Name</label>
            <input value={fields.lastName} onChange={e => set('lastName', e.target.value)}
              placeholder="Last" disabled={loading} />
          </div>
        </div>
        <div className="auth-row">
          <div className="auth-field auth-field-sm">
            <label>Last 4 SSN</label>
            <input value={fields.ssn4} onChange={e => set('ssn4', e.target.value)}
              placeholder="••••" maxLength={4} disabled={loading} />
          </div>
          <div className="auth-field auth-field-sm">
            <label>ZIP Code</label>
            <input value={fields.zip} onChange={e => set('zip', e.target.value)}
              placeholder="10001" maxLength={5} disabled={loading} />
          </div>
          <button className="auth-btn" type="submit" disabled={loading || !allFilled}>
            {loading ? '…' : 'Verify →'}
          </button>
        </div>
      </form>
    </div>
  );
}

function QuickReplies({ onReply, loading }) {
  return (
    <div className="qr-bar">
      <span className="qr-label">Confirm arrangement:</span>
      <div className="qr-btns">
        <button className="qr qr-yes" onClick={() => onReply('YES')} disabled={loading}>
          ✓ Yes, authorize
        </button>
        <button className="qr qr-no" onClick={() => onReply('NO')} disabled={loading}>
          ✗ No, discuss options
        </button>
        <button className="qr qr-q" onClick={() => onReply('I have a question about this')} disabled={loading}>
          ? Ask a question
        </button>
      </div>
    </div>
  );
}

function AuditModal({ data, onClose }) {
  if (!data) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span>Audit Log <span className="modal-count">{data.count} events</span></span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {data.audit.map((ev, i) => (
            <div key={i} className={`ae ae-${ev.event.toLowerCase().replace(/_/g, '-')}`}>
              <div className="ae-meta">
                <span className="ae-event">{ev.event}</span>
                <span className="ae-arrow">{ev.state_before} → {ev.state_after}</span>
                <span className="ae-ts">{new Date(ev.ts).toLocaleTimeString()}</span>
                <span className="ae-src">{ev.source}</span>
              </div>
              <pre className="ae-data">{JSON.stringify(ev.data, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const HTTP_TERMINAL = new Set(['RESOLVED', 'ESCALATED', 'AUTH_FAILED']);
const HANDOFF_STATES = new Set(['HANDOFF_PENDING', 'IN_HANDOFF']);

export default function App() {
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState('');
  const [sid,       setSid]       = useState(null);
  const [st,        setSt]        = useState('GREETING');
  const [meta,      setMeta]      = useState({});
  const [loading,   setLoading]   = useState(false);
  const [audit,     setAudit]     = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState(null); // index of bot message currently being spoken

  const bottomRef   = useRef(null);
  const startedRef  = useRef(false);
  const sidRef      = useRef(null);
  const wsRef       = useRef(null);
  const stRef       = useRef('GREETING');

  const voice = useVoice();

  // Keep stRef in sync for WS message handler (avoids stale closure)
  useEffect(() => { stRef.current = st; }, [st]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    post({});
  }, []); // eslint-disable-line

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // ── WebSocket consumer connection ────────────────────────────────────────────

  function connectWS(sessionId) {
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws?role=consumer&sessionId=${encodeURIComponent(sessionId)}`);

      ws.onmessage = (event) => {
        try {
          handleWSMessage(JSON.parse(event.data));
        } catch { /* ignore malformed */ }
      };

      ws.onerror = () => {
        console.warn('[WS consumer] error — chat still works via HTTP');
      };

      wsRef.current = ws;
    } catch (e) {
      console.warn('[WS consumer] could not connect:', e.message);
    }
  }

  function handleWSMessage(msg) {
    switch (msg.type) {
      case 'BOT_MESSAGE': {
        const content = msg.content;
        setMessages(p => [...p, { role: 'assistant', content }]);
        if (msg.state) setSt(msg.state);
        if (voice.voiceOn) {
          const idx = messages.length; // approximate
          setSpeakingIdx(idx);
          voice.speak(content, () => setSpeakingIdx(null));
        }
        break;
      }
      case 'HANDOFF_ACCEPTED': {
        if (msg.content) setMessages(p => [...p, { role: 'system', content: msg.content }]);
        if (msg.state)   setSt(msg.state);
        break;
      }
      case 'ADMIN_MESSAGE': {
        const content = msg.content;
        setMessages(p => [...p, { role: 'specialist', content }]);
        if (voice.voiceOn) {
          voice.speak(content, () => {});
        }
        break;
      }
      case 'SESSION_ENDED': {
        setMessages(p => [...p, { role: 'assistant', content: msg.content }]);
        setSt(msg.state ?? 'RESOLVED');
        break;
      }
    }
  }

  // ── HTTP chat ────────────────────────────────────────────────────────────────

  async function post(body) {
    setLoading(true);
    try {
      const res  = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (data.sessionId && !sidRef.current) {
        setSid(data.sessionId);
        sidRef.current = data.sessionId;
        connectWS(data.sessionId);
      }
      if (data.state)      setSt(data.state);
      if (data.statusMeta) setMeta(data.statusMeta);

      if (data.message) {
        const msgIdx = messages.length;
        setMessages(p => [...p, { role: 'assistant', content: data.message }]);
        if (voice.voiceOn) {
          setSpeakingIdx(msgIdx);
          voice.speak(data.message, () => {
            setSpeakingIdx(null);
            // After bot speaks, start listening again
            if (voice.voiceOn && stRef.current !== 'AWAITING_CONFIRMATION') {
              voice.startListening(
                (text) => setInput(text),
                (text) => send(text),
              );
            }
          });
        }
      }
      if (data.error) setMessages(p => [...p, { role: 'error', content: data.error }]);
    } catch {
      setMessages(p => [...p, { role: 'error', content: 'Connection error.' }]);
    } finally {
      setLoading(false);
    }
  }

  function send(text) {
    if (!text.trim() || loading) return;
    voice.stopListening();
    setInput('');
    setMessages(p => [...p, { role: 'user', content: text }]);
    post({ sessionId: sidRef.current, message: text });
  }

  function sendAuth(fields) {
    const label = `${fields.accountRef} · ${fields.firstName} ${fields.lastName} · SSN ****  ZIP ${fields.zip}`;
    setMessages(p => [...p, { role: 'user', content: label }]);
    post({ sessionId: sidRef.current, auth: fields });
  }

  async function loadAudit() {
    if (!sidRef.current) return;
    const r = await fetch(`/api/audit/${sidRef.current}`);
    const d = await r.json();
    setAudit(d);
    setShowAudit(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    send(t);
  }

  function handleMicClick() {
    if (!voice.supported) return;
    if (voice.speaking) {
      voice.stopSpeaking();
      return;
    }
    if (voice.listening) {
      voice.stopListening();
      voice.toggleVoice();
      return;
    }
    if (!voice.voiceOn) {
      voice.toggleVoice();
      // Start listening immediately after toggling on
      setTimeout(() => {
        voice.startListening(
          (text) => setInput(text),
          (text) => send(text),
        );
      }, 100);
    } else {
      voice.toggleVoice();
    }
  }

  const terminal   = HTTP_TERMINAL.has(st);
  const inHandoff  = HANDOFF_STATES.has(st);
  const isAuth     = st === 'AUTH_PENDING';
  const isConfirm  = st === 'AWAITING_CONFIRMATION';

  const stateColor = {
    GREETING:              '#64748b',
    AUTH_PENDING:          '#f59e0b',
    AUTH_FAILED:           '#ef4444',
    NEGOTIATION_OPEN:      '#3b82f6',
    NEGOTIATION:           '#8b5cf6',
    AWAITING_CONFIRMATION: '#f97316',
    RESOLVED:              '#22c55e',
    ESCALATED:             '#ef4444',
    HANDOFF_PENDING:       '#f59e0b',
    IN_HANDOFF:            '#7c3aed',
  }[st] ?? '#64748b';

  const stateLabel = {
    HANDOFF_PENDING: 'CONNECTING SPECIALIST',
    IN_HANDOFF:      'LIVE WITH SPECIALIST',
  }[st] ?? st.replace(/_/g, ' ');

  return (
    <div className="shell">

      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <Logo />
          <div className="topbar-name">
            <span className="brand-main">Meridian Recovery</span>
            <span className="brand-sub">Secure Collections Portal</span>
          </div>
        </div>

        <div className="topbar-meta">
          {meta.accountRef && (
            <>
              <div className="meta-chip">
                <span className="mc-label">Account</span>
                <span className="mc-val">{meta.accountRef}</span>
              </div>
              <div className="meta-sep"/>
              <div className="meta-chip">
                <span className="mc-label">Portfolio</span>
                <span className="mc-val">{meta.portfolioId}</span>
              </div>
              <div className="meta-sep"/>
              <div className="meta-chip">
                <span className="mc-label">Balance</span>
                <span className="mc-val mc-balance">
                  ${Number(meta.balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </>
          )}
          {meta.attemptsRemaining != null && (
            <div className="meta-chip meta-warn">
              <span className="mc-label">Auth attempts left</span>
              <span className="mc-val">{meta.attemptsRemaining}</span>
            </div>
          )}
        </div>

        <div className="topbar-right">
          <div className="state-pill" style={{ '--c': stateColor }}>
            <span className="state-dot" />
            {stateLabel}
          </div>
          {sid && (
            <button className="audit-pill" onClick={loadAudit}>Audit Log</button>
          )}
        </div>
      </header>

      {/* ── Offer track ── */}
      {meta.offers && <OfferTrack offers={meta.offers} currentRung={meta.currentRung} />}

      {/* ── Handoff banner ── */}
      {st === 'IN_HANDOFF' && (
        <div className="handoff-banner">
          🟣 You are now connected with a live specialist — type or speak your message below
        </div>
      )}
      {st === 'HANDOFF_PENDING' && (
        <div className="handoff-banner handoff-banner-waiting">
          ⏳ Connecting you with a specialist — please hold…
        </div>
      )}

      {/* ── Chat ── */}
      <main className="chat">
        {messages.map((m, i) => (
          m.role === 'error'
            ? <div key={i} className="err-msg">{m.content}</div>
            : <Bubble key={i} role={m.role} content={m.content} speaking={i === speakingIdx} />
        ))}
        {loading && <TypingIndicator />}
        <div ref={bottomRef} />
      </main>

      {/* ── Terminal banner ── */}
      {terminal && (
        <div className={`terminal-strip ${st === 'RESOLVED' ? 'ts-ok' : 'ts-end'}`}>
          {st === 'RESOLVED'
            ? '✓ Arrangement confirmed — this session is complete.'
            : '⚠ This session has ended. Please contact us through our published channels.'}
        </div>
      )}

      {/* ── Input zone ── */}
      {!terminal && (
        <footer className="input-zone">
          {isAuth ? (
            <AuthPanel
              onSubmit={sendAuth}
              attemptsRemaining={meta.attemptsRemaining}
              loading={loading}
            />
          ) : isConfirm ? (
            <>
              <QuickReplies onReply={send} loading={loading} />
              <form className="text-bar" onSubmit={handleSubmit}>
                <input
                  className="text-in"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Or type a response…"
                  disabled={loading}
                />
                {voice.supported && (
                  <button
                    type="button"
                    className={`voice-btn ${voice.voiceOn ? (voice.listening ? 'voice-listening' : voice.speaking ? 'voice-speaking' : 'voice-on') : ''}`}
                    onClick={handleMicClick}
                    title={voice.listening ? 'Listening… (click to stop)' : voice.speaking ? 'Speaking… (click to stop)' : voice.voiceOn ? 'Voice on' : 'Enable voice'}
                  >
                    <MicIcon listening={voice.listening} />
                  </button>
                )}
                <button className="send-btn" disabled={loading || !input.trim()}>Send</button>
              </form>
            </>
          ) : (
            <form className="text-bar" onSubmit={handleSubmit}>
              <input
                className="text-in"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={inHandoff ? 'Type your message to the specialist…' : 'Type a message…'}
                disabled={loading}
                autoFocus
              />
              {voice.supported && (
                <button
                  type="button"
                  className={`voice-btn ${voice.voiceOn ? (voice.listening ? 'voice-listening' : voice.speaking ? 'voice-speaking' : 'voice-on') : ''}`}
                  onClick={handleMicClick}
                  title={voice.listening ? 'Listening… (click to stop)' : voice.speaking ? 'Speaking… (click to stop)' : voice.voiceOn ? 'Voice on (click to disable)' : 'Enable voice input'}
                >
                  <MicIcon listening={voice.listening} />
                </button>
              )}
              <button className="send-btn" disabled={loading || !input.trim()}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8h12M10 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </form>
          )}
          {!voice.supported && (
            <div className="voice-unsupported">Voice input not supported in this browser. Use Chrome or Edge.</div>
          )}
        </footer>
      )}

      {/* ── Audit modal ── */}
      {showAudit && <AuditModal data={audit} onClose={() => setShowAudit(false)} />}
    </div>
  );
}
