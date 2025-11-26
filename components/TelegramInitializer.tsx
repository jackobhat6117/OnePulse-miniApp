'use client';

import { useEffect, useState } from 'react';


export function TelegramInitializer({ children }: { children: React.ReactNode }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    
    setIsMounted(true);
    
    // NOTE: If you decide to use features like the "Back Button" or "Main Button" later,
    // you would initialize/mount them here.
    // Example: 
    // import { backButton } from '@telegram-apps/sdk-react';
    // backButton.mount();
  }, []);

  // 1. SSR Guard:
  // If we are on the server (or before hydration finishes), show a loader.
  // This prevents the "window is not defined" error.
  if (!isMounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 text-gray-500">
        Initializing App...
      </div>
    );
  }

  // 2. Render Children:
  // Now we are safe to render the app which uses window.Telegram
  return <>{children}</>;
}