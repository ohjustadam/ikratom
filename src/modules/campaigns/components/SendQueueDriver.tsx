"use client";

import { useEffect } from "react";
import {
  SEND_QUEUE_HINT_KEY,
  SEND_QUEUE_WAKE_EVENT,
  browserHintStore,
  browserSleep,
  pageDriverActive,
  postSendQueueTick,
  readHint,
  runSendQueueDriver,
  withSendQueueLock,
} from "../send-queue-client";

/**
 * Keeps the member's one-click send going while they browse (PJ, 2026-11-11).
 *
 * Mounted once in the app shell for signed-in members with a connected
 * mailbox (SendQueueDriverGate). Renders nothing and makes no request unless
 * this browser holds the "send in flight" hint. The loop and who-drives rules
 * are in send-queue-client.ts.
 */
export function SendQueueDriver() {
  useEffect(() => {
    const ctrl = new AbortController();
    const store = browserHintStore();
    let running = false;

    const start = () => {
      if (running || ctrl.signal.aborted || !readHint(store, Date.now())) return;
      running = true;
      withSendQueueLock(
        () => runSendQueueDriver({
          store,
          now: Date.now,
          tick: postSendQueueTick,
          sleep: browserSleep,
          pageDriving: pageDriverActive,
        }, ctrl.signal),
        ctrl.signal,
      )
        .catch(() => {})
        .finally(() => { running = false; });
    };

    const onStorage = (e: StorageEvent) => { if (e.key === SEND_QUEUE_HINT_KEY) start(); };
    start();
    window.addEventListener(SEND_QUEUE_WAKE_EVENT, start);
    window.addEventListener("storage", onStorage);
    return () => {
      ctrl.abort();
      window.removeEventListener(SEND_QUEUE_WAKE_EVENT, start);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}
