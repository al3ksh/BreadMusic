'use client';

import { useEffect, useState } from 'react';
import { ActivityApp, type ActivityBackend } from '@/components/activity/ActivityApp';
import { createDemoBackend, createLocalHost } from '@/components/landing-preview/demo-backend';

// The real Activity, wired to the landing demo state instead of the bot. The landing page embeds this
// in an iframe and shares its state through window.__BREAD_ACTIVITY_DEMO_HOST__.
export default function ActivityDemoPage() {
  const [backend, setBackend] = useState<ActivityBackend | null>(null);

  useEffect(() => {
    let host = createLocalHost();
    try {
      if (window.parent !== window && window.parent.__BREAD_ACTIVITY_DEMO_HOST__) host = window.parent.__BREAD_ACTIVITY_DEMO_HOST__;
    } catch {
      // A cross-origin parent: run on the local state.
    }
    setBackend(createDemoBackend(host, window.fetch.bind(window)));
  }, []);

  return backend ? <ActivityApp backend={backend} /> : null;
}
