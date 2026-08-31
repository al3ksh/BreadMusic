'use client';

import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, BookOpen, Check, Hash, Headphones, LayoutGrid, ListMusic, LoaderCircle, Pause, Play, Plus, Repeat2, RotateCcw, Shuffle, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react';
import { artwork, asset, commands, demoTracks, type DemoTrack } from './demo';
import { demoReducer, initialState, queueEmbed, trackEmbed, type Embed, type Message, type Playback } from './demo-state';
import contract from './bot-contract.json';
import styles from './preview.module.css';
import { ActivityDemo } from './ActivityDemo';
import { ActivityFrame } from './ActivityFrame';
import { usePreviewSearch } from './usePreviewSearch';

function Text({ value }: { value: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|`([^`]+)`|<#\d+>/g;
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    parts.push(value.slice(end, match.index));
    parts.push(match[1] ? <a key={match.index} href={match[2]} target="_blank" rel="noreferrer">{match[1]}</a> : match[3] ? <code key={match.index}>{match[3]}</code> : <span className={styles.channelMention} key={match.index}><Volume2 size={13} /> listening room</span>);
    end = match.index! + match[0].length;
  }
  parts.push(value.slice(end));
  return <>{parts}</>;
}

function DiscordEmbed({ embed, live }: { embed: Embed; live?: boolean }) {
  return <div className={styles.discordEmbed} style={{ borderLeftColor: `#${embed.color.toString(16).padStart(6, '0')}` }} data-live-player={live || undefined}>
    {embed.thumbnail && <img className={styles.embedThumb} src={embed.thumbnail.url} alt="Album artwork" width={76} height={76} />}
    <h3>{embed.title}</h3>
    {embed.description && <div className={styles.embedDescription}>{embed.description.split('\n').map((line, index) => <div key={index} className={line.includes('\u25ac') ? styles.embedProgress : undefined}><Text value={line} /></div>)}</div>}
    {embed.fields && <div className={styles.embedFields}>{embed.fields.map((field) => <div key={field.name} className={!field.inline ? styles.fullField : undefined}><b>{field.name}</b><div><Text value={field.value} /></div></div>)}</div>}
    {embed.footer && <div className={styles.embedFooter}>{embed.footer.text} <span>• Today at 20:41</span></div>}
  </div>;
}

const controls = {
  back: { icon: SkipBack, label: 'Previous track', command: '/back' },
  playpause: { icon: Pause, label: 'Pause playback', command: '/pause' },
  skip: { icon: SkipForward, label: 'Skip track', command: '/skip' },
  stop: { icon: Square, label: 'Stop playback', command: '/stop' },
  loop: { icon: Repeat2, label: 'Cycle loop mode', command: '/loop track' },
  shuffle: { icon: Shuffle, label: 'Shuffle queue', command: '/shuffle' },
  lyrics: { icon: BookOpen, label: 'Show lyrics', command: '/lyrics' },
  activity: { icon: LayoutGrid, label: 'Open Activity preview', command: '' },
};

function PlayerButtons({ state, busy, run, openActivity }: { state: Playback; busy: boolean; run: (value: string) => void; openActivity: () => void }) {
  return <div className={styles.playerButtons}>{contract.controls.map((row, index) => <div key={index}>{row.components.map((button) => {
    const id = button.custom_id.split(':')[1] as keyof typeof controls;
    const control = controls[id];
    const isPause = id === 'playpause';
    const Icon = isPause && state.paused ? Play : control.icon;
    const label = isPause && state.paused ? 'Resume playback' : control.label;
    const command = isPause && state.paused ? '/resume' : id === 'loop' ? `/loop ${state.loop === 'off' ? 'track' : state.loop === 'track' ? 'queue' : 'off'}` : control.command;
    return <button key={id} type="button" title={label} aria-label={label} disabled={busy || (id === 'shuffle' && !state.queue.length)} data-style={isPause && state.paused ? 'success' : button.style === 4 ? 'danger' : id === 'loop' && state.loop !== 'off' ? 'primary' : 'secondary'} onClick={() => id === 'activity' ? openActivity() : run(command)}><Icon size={18} /></button>;
  })}</div>)}</div>;
}

function BotReply({ message, state, live, busy, run, openActivity }: { message: Message; state: Playback; live: boolean; busy: boolean; run: (value: string) => void; openActivity: () => void }) {
  const [page, setPage] = useState(0);
  const player = live ? state : message.snapshot;
  const embed = message.kind === 'player' ? player.current ? trackEmbed('nowPlaying', player.current, player) : contract.empty : message.embed?.title === contract.queue.title ? queueEmbed(message.snapshot, page) : message.embed;
  const pages = Math.max(1, Math.ceil(message.snapshot.queue.length / 10));
  return <article className={styles.botMessage} data-message={message.id}>
    <img src="/assets/breadicon.png" alt="" width={36} height={36} />
    <div className={styles.botContent}>
      {message.command && <div className={styles.commandInvocation}><span>You</span> used <code>{message.command.split(' ')[0]}</code><span>{message.command.split(' ').slice(1).join(' ')}</span></div>}
      <strong>Bread <span className={styles.appTag}><Check size={10} /> APP</span><small>Today at 20:41</small></strong>
      <div className={styles.reply}>
        {embed && <DiscordEmbed embed={embed} live={live} />}
        {message.text && <p>{message.text}</p>}
        {message.kind === 'player' && live && state.current && <PlayerButtons state={state} busy={busy} run={run} openActivity={openActivity} />}
        {message.embed?.title === contract.queue.title && <div className={styles.queuePagination}><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button></div>}
        {message.kind === 'slots' && <><picture><source media="(prefers-reduced-motion: reduce)" srcSet={asset(`slots-${message.round ?? 0}.png`)} /><img className={styles.gameReply} src={`${asset(`slots-${message.round ?? 0}.gif`)}?round=${message.id}`} alt="Bread Arcade slots result" /></picture><button className={styles.playAgain} disabled={busy} onClick={() => run('/slots')}><RotateCcw size={14} /> Play again</button></>}
        {message.private && <small className={styles.privateReply}>Only you can see this</small>}
      </div>
    </div>
  </article>;
}

export function CommandDemo() {
  const [state, dispatch] = useReducer(demoReducer, undefined, initialState);
  const [mode, setMode] = useState<'commands' | 'activity'>('commands');
  const openActivity = () => setMode('activity');
  const { search, error, cancel } = usePreviewSearch();
  const autocomplete = usePreviewSearch();
  const [matches, setMatches] = useState<DemoTrack[]>([]);
  const [matchedQuery, setMatchedQuery] = useState('');
  const [selectedTrack, setSelectedTrack] = useState<DemoTrack | null>(null);
  const [lyricsRequest, setLyricsRequest] = useState(0);
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [suggestion, setSuggestion] = useState(0);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const scrollTo = useRef<'latest' | 'player'>('latest');
  const isPlay = /^\/play\s/i.test(input);
  const query = input.replace(/^\/play\s+(query:\s*)?/i, '').trim();
  const activeCommand = commands.find(command => command.option && input.startsWith(`${command.name} `));
  useEffect(() => {
    let valid = true;
    setMatches([]); setMatchedQuery('');
    if (!isPlay || !focused || busy || mode !== 'commands' || query.length < 2 || selectedTrack) { autocomplete.cancel(); return; }
    const timer = setTimeout(async () => {
      const result = await autocomplete.search(query);
      if (valid && result) { setMatches(result.tracks.slice(0, 6)); setMatchedQuery(query); setSuggestion(0); }
    }, 450);
    return () => { valid = false; clearTimeout(timer); autocomplete.cancel(); };
  }, [isPlay, query, focused, busy, mode, selectedTrack, autocomplete.search, autocomplete.cancel]);
  useEffect(() => {
    const clock = setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => { clearInterval(clock); if (timer.current) clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (mode !== 'commands') return;
    const log = logRef.current;
    if (!log) return;
    const player = scrollTo.current === 'player' ? log.querySelector<HTMLElement>('[data-live-player]') : null;
    let target = player?.closest<HTMLElement>('article');
    const heading = player?.querySelector('h3');
    // A wrapped command can fill the tiny mobile log before the player title.
    if (target && heading && heading.getBoundingClientRect().bottom - target.getBoundingClientRect().top + 14 > log.clientHeight) target = player;
    const top = target ? log.scrollTop + target.getBoundingClientRect().top - log.getBoundingClientRect().top - 14 : log.scrollHeight;
    log.scrollTo({ top: state.messages.length === 1 ? 0 : top, behavior: 'instant' });
  }, [state.sequence, state.paused, state.loop, state.volume, busy, mode]);

  const run = async (value: string, selected?: DemoTrack) => {
    const command = value.trim();
    if (!command || busy) return;
    autocomplete.cancel(); setSelectedTrack(null); setInput(''); setFocused(false); setBusy(command); setStatus('Bread is responding');
    scrollTo.current = /^\/(pause|resume|loop|seek)\b/.test(command) ? 'player' : 'latest';
    if (/^\/play\s/i.test(command)) {
      if (selected) { dispatch({ type: 'resolved', tracks: [selected], command }); setBusy(''); setStatus(`${command} completed`); return; }
      const result = await search(command.replace(/^\/play\s+(query:\s*)?/i, ''));
      if (result) dispatch({ type: 'resolved', tracks: result.playlist ? result.tracks : result.tracks.slice(0, 1), command });
      setBusy(''); setStatus(result ? `${command} completed` : 'Search did not complete');
      return;
    }
    if (command === '/lyrics') { setMode('activity'); setLyricsRequest(value => value + 1); setBusy(''); return; }
    timer.current = setTimeout(() => {
      dispatch({ type: 'command', value: command, random: Math.random() });
      setBusy(''); setStatus(`${command} completed`);
    }, command === '/slots' ? 850 : 320);
  };
  const reset = () => {
    cancel();
    autocomplete.cancel(); setSelectedTrack(null);
    if (timer.current) clearTimeout(timer.current);
    scrollTo.current = 'latest'; dispatch({ type: 'reset' }); setInput(''); setBusy(''); setStatus('Demo reset');
  };
  const fill = (value: string) => { setSelectedTrack(null); setInput(value); setSuggestion(0); setFocused(true); inputRef.current?.focus(); };
  type Suggestion = { name: string; detail: string; value: string; image?: string; track?: DemoTrack; option?: string };
  const suggestions: Suggestion[] = isPlay
    ? (query ? matchedQuery === query ? matches : [] : demoTracks).map(track => ({ name: track.title, detail: `${track.artist} - ${track.duration}`, value: `/play ${track.artist} - ${track.title}`, image: artwork(track), track }))
    : commands.filter(command => input === '' || command.name.startsWith(input.toLowerCase())).slice(0, 7).map(command => ({ name: command.name, detail: command.detail, value: command.input, option: command.option }));
  const showSuggestions = focused && !busy && input.startsWith('/') && (suggestions.length > 0 || isPlay) && !selectedTrack;
  const choose = (index: number) => {
    const item = suggestions[index]; if (!item) return;
    if (isPlay) { setInput(item.value); setSelectedTrack(item.track || null); setFocused(false); inputRef.current?.focus(); return; }
    fill(item.value); if (!item.value.endsWith(' ')) setFocused(false);
  };

  return <>
    <div className={styles.demoModeBar}><div role="tablist" aria-label="Playground mode" className={styles.tabs}>{(['commands', 'activity'] as const).map(item => <button type="button" key={item} role="tab" id={`demo-tab-${item}`} aria-controls={`demo-panel-${item}`} aria-selected={mode === item} tabIndex={mode === item ? 0 : -1} onClick={() => { scrollTo.current = 'player'; setMode(item); }} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 'commands' : event.key === 'End' ? 'activity' : mode === 'commands' ? 'activity' : 'commands';
      scrollTo.current = 'player'; setMode(next); document.getElementById(`demo-tab-${next}`)?.focus();
    }}>{item === 'commands' ? <Hash size={16} /> : <Headphones size={16} />}{item === 'commands' ? 'Slash commands' : 'Activity'}</button>)}</div><span>One session · No audio</span></div>
    <div hidden={mode !== 'activity'} role="tabpanel" id="demo-panel-activity" aria-labelledby="demo-tab-activity"><ActivityFrame><ActivityDemo state={state} dispatch={dispatch} reset={reset} lyricsRequest={lyricsRequest} /></ActivityFrame></div>
    <div hidden={mode !== 'commands'} role="tabpanel" id="demo-panel-commands" aria-labelledby="demo-tab-commands"><div className={styles.commandLayout}>
    <div className={styles.chat}>
      <header className={styles.chatHeader}><span><Hash size={20} /> music</span><span className={styles.sandbox}>Demo · No audio</span><button type="button" title="Reset demo" aria-label="Reset demo" onClick={reset}><RotateCcw size={17} /></button></header>
      <div className={styles.voiceStrip}><Headphones size={15} /><span>{state.current ? 'Voice connected' : 'Disconnected'}<small>listening room</small></span><button type="button" onClick={() => run('/queue')} disabled={Boolean(busy)} aria-label="Show demo queue"><ListMusic size={16} />{state.queue.length} queued</button></div>
      <div className={styles.chatMessages} ref={logRef} role="log" aria-label="Bread conversation" aria-live="off" aria-busy={Boolean(busy)}>
        {state.messages.map((message) => <BotReply key={message.id} message={message} state={state} live={message.kind === 'player' && message.id === state.playerId} busy={Boolean(busy)} run={run} openActivity={openActivity} />)}
        {busy && <div className={styles.thinking}><img src="/assets/breadicon.png" alt="" width={28} height={28} /><span>Bread is thinking<div className={styles.typing}><i /><i /><i /></div></span></div>}
      </div>
      <span className={styles.srOnly} role="status">{status}</span>
      {error && <div className={styles.demoError} role="alert">{error}</div>}
      <div className={styles.composer}>
        {showSuggestions && <div className={styles.suggestions}><div className={styles.suggestionHeading}><img src="/assets/breadicon.png" alt="" width={20} height={20} /><strong>{isPlay ? '/play' : 'Bread'}</strong><span>{isPlay ? 'query' : 'Commands'}</span>{isPlay && autocomplete.searching && <LoaderCircle className={styles.searchSpinner} size={15} />}</div><div id="bread-suggestions" role="listbox" aria-label={isPlay ? 'Matching tracks' : 'Bread commands'}>{suggestions.map((item, index) => <button type="button" role="option" id={`suggestion-${index}`} aria-selected={suggestion === index} key={item.value} onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>{item.image ? <img src={item.image} alt="" width={32} height={32} /> : <span className={styles.slashIcon}>/</span>}<span><b>{item.name}{item.option && <em>{item.option}</em>}</b><small>{item.detail}</small></span></button>)}</div>{isPlay && !suggestions.length && <div className={styles.autocompleteStatus} role="status">{autocomplete.error || (autocomplete.searching || matchedQuery !== query && query.length >= 2 ? 'Searching...' : query.length < 2 ? 'Type at least 2 characters.' : 'No results found.')}</div>}</div>}
        <form onSubmit={(event) => { event.preventDefault(); if (showSuggestions && suggestions.length) choose(suggestion); else run(input, selectedTrack || undefined); }} className={styles.commandInput}>
          {activeCommand && <div className={styles.commandToken}><button type="button" title="Change command" onClick={() => fill('/')}>{activeCommand.name}</button><span>{activeCommand.option}</span></div>}
          <input ref={inputRef} role="combobox" aria-label="Try a Bread command" aria-autocomplete="list" aria-expanded={showSuggestions} aria-controls={showSuggestions ? 'bread-suggestions' : undefined} aria-activedescendant={showSuggestions && suggestions.length ? `suggestion-${suggestion}` : undefined} value={activeCommand ? input.slice(activeCommand.name.length + 1) : input} onChange={(event) => { const value = event.target.value; setSelectedTrack(null); setInput(activeCommand && !value.startsWith('/') ? `${activeCommand.name} ${value}` : value); setSuggestion(0); setFocused(true); }} onFocus={() => { if (!selectedTrack) setFocused(true); }} onBlur={() => setFocused(false)} onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setFocused(false); }
            if (event.key === 'Backspace' && activeCommand && !event.currentTarget.value) { event.preventDefault(); fill(activeCommand.name); }
            if (showSuggestions && suggestions.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setSuggestion((suggestion + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); }
            if (showSuggestions && suggestions.length && event.key === 'Tab') { event.preventDefault(); choose(suggestion); }
          }} placeholder={activeCommand ? isPlay ? 'Search for a song or paste a link' : activeCommand.option : 'Message #music or type /'} maxLength={200} autoComplete="off" spellCheck={false} disabled={Boolean(busy)} />
          <button type="submit" title="Send command" aria-label="Send command" disabled={Boolean(busy) || !input.trim()}><ArrowUp size={18} /></button>
        </form>
      </div>
    </div>
    <aside className={styles.demoSidebar} aria-label="Demo music library">
      <h3>Queue something good.</h3>
      <div className={styles.demoLibrary}>{demoTracks.map((track) => <button type="button" key={track.title} disabled={Boolean(busy)} onClick={() => run(`/play ${track.artist} - ${track.title}`, track)} aria-label={`Queue ${track.title}`}><img src={asset(`${track.cover}.jpg`)} alt="" width={42} height={42} /><span><b>{track.title}</b><small>{track.artist}</small></span><Plus size={17} /></button>)}</div>
      <div className={styles.commandChoices}>{commands.filter((command) => ['/play', '/queue', '/volume', '/seek', '/slots'].includes(command.name)).map((command) => <button key={command.name} type="button" onClick={() => fill(command.input)}><code>{command.name}</code><span>{command.detail}</span><ArrowUp size={14} /></button>)}</div>
    </aside>
  </div></div></>;
}
