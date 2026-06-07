<template>
  <NuxtPage />
</template>

<style>
:root {
  --bg: #0c0f12;
  --panel: #14181d;
  --panel-2: #1b2129;
  --grid: #2a323c;
  --track: #6b7682;
  --track-lit: #f2f5f7;
  --red: #ff3b30;
  --green: #34d058;
  --amber: #ffb020;
  --text: #e7edf2;
  --muted: #8b97a3;
  --accent: #ffd23b;
}

* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

html, body, #__nuxt {
  margin: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: 'DIN Alternate', 'Roboto Condensed', 'Segoe UI', system-ui, sans-serif;
}

.mono {
  font-family: ui-monospace, 'SF Mono', 'Roboto Mono', 'Consolas', monospace;
}

button {
  font-family: inherit;
  color: var(--text);
  cursor: pointer;
}

/* Tastenfeld-style flat button */
.key {
  background: var(--panel-2);
  border: 2px solid var(--grid);
  border-top-color: #34404d;
  border-left-color: #34404d;
  color: var(--text);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 14px 16px;
  font-size: 15px;
  user-select: none;
  transition: background 0.06s, border-color 0.06s;
}
.key:active { background: #232c36; }
.key:disabled { opacity: 0.32; cursor: not-allowed; }
.key.primary { background: #1f3a23; border-color: var(--green); color: #c8ffd4; }
.key.primary:active { background: #275030; }
.key.warn { background: #3a2a14; border-color: var(--amber); color: #ffe6b0; }
.key.danger { background: #3a1816; border-color: var(--red); color: #ffd0cc; }

.led {
  display: inline-block;
  width: 12px; height: 12px;
  border-radius: 50%;
  border: 1px solid #000;
}
.led.r { background: var(--red); box-shadow: 0 0 6px var(--red); }
.led.g { background: var(--green); box-shadow: 0 0 6px var(--green); }
.led.a { background: var(--amber); box-shadow: 0 0 6px var(--amber); }
.led.off { background: #2a2f36; }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: var(--grid); }
</style>
