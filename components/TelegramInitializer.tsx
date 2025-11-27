'use client';

import { useEffect, useState } from 'react';

export function TelegramInitializer({ children }: { children: React.ReactNode }) {
  const [isMounted, setIsMounted] = useState(false);
  const [telegramReady, setTelegramReady] = useState(false);

  useEffect(() => {
    setIsMounted(true);

    const tryBootstrap = () => {
      if (typeof window === 'undefined') return false;
      const tg = (window as any).Telegram?.WebApp;
      if (!tg) return false;

      tg.ready();
      tg.expand();
      tg.disableVerticalSwipes();
      setTelegramReady(true);
      return true;
    };

    // Attempt immediately, then retry briefly in case the script loads a tick later
    if (!tryBootstrap()) {
      const timeout = setTimeout(() => {
        tryBootstrap();
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, []);

  if (!isMounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 text-gray-500">
        Initializing App...
      </div>
    );
  }

  if (!telegramReady) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-yellow-50 text-yellow-800 p-6 text-center">
        <p className="font-medium">Waiting for Telegram Mini App context…</p>
        <p className="text-sm mt-2 text-yellow-700">
          If this screen persists, open the bot from Telegram&apos;s menu button.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}