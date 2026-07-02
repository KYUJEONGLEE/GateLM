"use client";

import type { MouseEvent, ReactNode } from "react";

type RequestLogDetailAnchorProps = {
  children: ReactNode;
};

const PANEL_MAX_WIDTH = 760;
const VIEWPORT_PADDING = 24;
const MIN_VISIBLE_PANEL_HEIGHT = 180;
const PANEL_TOP_RATIO = 0.22;

export function RequestLogDetailAnchor({ children }: RequestLogDetailAnchorProps) {
  function captureDetailAnchor(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("[data-request-log-anchor]");

    if (!anchor) {
      return;
    }

    const panelWidth = Math.min(PANEL_MAX_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2);
    const anchorRect = anchor.getBoundingClientRect();
    const left = Math.max(VIEWPORT_PADDING, (window.innerWidth - panelWidth) / 2);
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - MIN_VISIBLE_PANEL_HEIGHT);
    const preferredTop = Math.min(anchorRect.top, window.innerHeight * PANEL_TOP_RATIO);
    const top = Math.min(Math.max(VIEWPORT_PADDING, preferredTop), maxTop);
    const originX = Math.min(Math.max(0, event.clientX - left), panelWidth);
    const originY = Math.max(0, event.clientY - top);

    document.documentElement.style.setProperty("--request-log-detail-left", `${left}px`);
    document.documentElement.style.setProperty("--request-log-detail-right", "auto");
    document.documentElement.style.setProperty("--request-log-detail-top", `${top}px`);
    document.documentElement.style.setProperty("--request-log-detail-origin-x", `${originX}px`);
    document.documentElement.style.setProperty("--request-log-detail-origin-y", `${originY}px`);
  }

  return (
    <div className="request-log-detail-anchor-root" onClickCapture={captureDetailAnchor}>
      {children}
    </div>
  );
}
