'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { CircleCheck, Play } from 'lucide-react';
import { ActivityRunnerGame } from '@/components/activity/ActivityRunnerGame';

// The Activity's "can't play right now" screen. When the minigame is offered it sits under the
// message as an invitation; the first tap folds the message into a slim bar and hands the rest of
// the view to the game. Outages the bot can recover from are watched in the background.

const RECOVERY_KEY = 'bread-activity-recovery-at';
// A reload that lands on the same outage again within this window does not reload a second time.
const RECOVERY_GUARD_MS = 60_000;
const FIRST_CHECK_MS = 8_000;
const MAX_CHECK_MS = 30_000;

type OutageScreenProps = {
  icon: ReactNode;
  title: string;
  message: string;
  actions: ReactNode;
  game: boolean;
  /** Resolves true once the service behind the outage answers again. */
  checkRecovery?: () => Promise<boolean>;
};

function recentlyRecovered() {
  try {
    const at = Number(window.sessionStorage.getItem(RECOVERY_KEY));
    return Number.isFinite(at) && Date.now() - at < RECOVERY_GUARD_MS;
  } catch {
    return false;
  }
}

function reloadForRecovery() {
  try {
    window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
  } catch {
    // Without storage the guard cannot work, so the screen falls back to asking.
  }
  window.location.reload();
}

export function ActivityOutageScreen({ icon, title, message, actions, game, checkRecovery }: OutageScreenProps) {
  const [stage, setStage] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const stageRef = useRef(false);
  const checkRef = useRef(checkRecovery);

  useEffect(() => {
    checkRef.current = checkRecovery;
  }, [checkRecovery]);

  const watching = Boolean(checkRecovery);
  useEffect(() => {
    if (!watching || recovered) return;
    let cancelled = false;
    let timer = 0;
    let delay = FIRST_CHECK_MS;
    const schedule = () => {
      timer = window.setTimeout(check, delay);
      delay = Math.min(MAX_CHECK_MS, Math.round(delay * 1.5));
    };
    const check = async () => {
      const back = await (checkRef.current?.() ?? Promise.resolve(false)).catch(() => false);
      if (cancelled) return;
      if (!back) {
        schedule();
        return;
      }
      // Someone mid-run keeps their run; everyone else goes straight back to the player.
      if (!stageRef.current && !recentlyRecovered()) reloadForRecovery();
      else setRecovered(true);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [watching, recovered]);

  const enterStage = useCallback(() => {
    if (stageRef.current) return;
    stageRef.current = true;
    const apply = () => setStage(true);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || typeof document.startViewTransition !== 'function') {
      apply();
      return;
    }
    const root = document.documentElement;
    root.classList.add('activity-vt-outage');
    const transition = document.startViewTransition(() => flushSync(apply));
    transition.finished.finally(() => root.classList.remove('activity-vt-outage'));
  }, []);

  return (
    <main
      className={'activity-shell activity-centered activity-outage' + (stage ? ' is-stage' : '')}
      data-recovered={recovered || undefined}
    >
      <header className="activity-outage-head">
        <div className="activity-status-mark">{recovered ? <CircleCheck size={30} /> : icon}</div>
        <div className="activity-outage-copy" aria-live="polite">
          <p className="activity-kicker">Bread Activity</p>
          <h1>{recovered ? 'Bread is back' : title}</h1>
          <p className="activity-muted">
            {recovered ? 'Everything is running again. Finish your run or open the player.' : message}
          </p>
        </div>
        <div className="activity-error-actions">
          {recovered ? (
            <button type="button" className="activity-error-button primary" onClick={() => window.location.reload()}>
              <Play size={16} /><span>Open player</span>
            </button>
          ) : actions}
        </div>
      </header>
      {game && <ActivityRunnerGame size={stage ? 'stage' : 'invite'} onStart={enterStage} />}
    </main>
  );
}
