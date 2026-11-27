import React from "react";

export function getCompanyLogo(idOrCompany?: string | null, className = "w-5 h-5 shrink-0") {
  const query = (idOrCompany || "").trim().toLowerCase();

  if (query.includes("google") || query.includes("deepmind") || query === "alphabet") {
    return (
      <svg className={className} viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#A855F7" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
      </svg>
    );
  }

  if (query.includes("amazon") || query.includes("aws")) {
    return (
      <svg className={`${className} fill-current text-purple-400`} viewBox="0 0 24 24">
        <path d="M13.84 14.07c-2.82 1.95-6.87 2.99-10.37 1.98-.49-.14-.88.31-.45.66 3.7 3.01 8.74 2.57 13-.43.46-.23.37-.78-.12-.82l-2.06-.56zm2.14-1.53c-.25-.3-.82-.14-.84.24-.07 1.25.87 2.58 2.05 2.92.38.11.7-.25.5-.56-.41-.65-1.23-1.94-1.71-2.6z"/>
        <path d="M12.9 3C8.6 3 6.1 5.6 6.1 8.8c0 2.7 1.7 4.1 3.8 4.1 1.7 0 2.8-.7 3.5-1.6v1.3c0 .2.2.4.4.4h2.2c.2 0 .4-.2.4-.4V3.4c0-.2-.2-.4-.4-.4h-3.1zm-.2 7.7c-1.1 0-2.1-.7-2.1-2.1 0-1.5 1-2.1 2.1-2.1 1 0 1.8.4 2.2.9v2.4c-.5.6-1.3.9-2.2.9z"/>
      </svg>
    );
  }

  if (query.includes("meta") || query.includes("facebook")) {
    return (
      <svg className={`${className} text-[#0081FB]`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 8.77c-2.05-2.64-4.52-4.02-7.05-4.02-3.14 0-4.95 2.14-4.95 5.57 0 4.29 3.03 8.93 6.94 8.93 2.1 0 3.76-1.12 5.06-2.87 1.3 1.75 2.96 2.87 5.06 2.87 3.91 0 6.94-4.64 6.94-8.93 0-3.43-1.81-5.57-4.95-5.57-2.53 0-5 1.38-7.05 4.02zm-5.06 7.42c-2.3 0-4.14-3.41-4.14-6.32 0-1.87.93-2.92 2.25-2.92 1.6 0 3.27 1.48 4.49 3.79-1.04 3.08-2.05 5.45-2.6 5.45zm10.12 0c-.55 0-1.56-2.37-2.6-5.45 1.22-2.31 2.89-3.79 4.49-3.79 1.32 0 2.25 1.05 2.25 2.92 0 2.91-1.84 6.32-4.14 6.32z"/>
      </svg>
    );
  }

  if (query.includes("microsoft") || query.includes("azure")) {
    return (
      <svg className={className} viewBox="0 0 24 24">
        <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022"/>
        <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00"/>
        <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF"/>
        <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#A855F7"/>
      </svg>
    );
  }

  if (query.includes("apple")) {
    return (
      <svg className={`${className} fill-current text-zinc-100`} viewBox="0 0 24 24">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.38c.62-.75 1.04-1.8 0.93-2.85-.9.04-2 .6-2.64 1.35-.56.65-1.05 1.72-.92 2.74 1.01.08 2.01-.49 2.63-1.24z"/>
      </svg>
    );
  }

  if (query.includes("netflix")) {
    return (
      <svg className={`${className} text-[#E50914]`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 2v20l4-2V2H4zm8 0l4 18.5V2h-4zm8 0l-4 18.5V22l8-2V2h-4z"/>
      </svg>
    );
  }

  if (query.includes("openai") || query.includes("chatgpt")) {
    return (
      <svg className={`${className} fill-current text-emerald-400`} viewBox="0 0 24 24">
        <path d="M22.28 10.37a5.95 5.95 0 00-.52-4.91 6.04 6.04 0 00-6.52-2.82 5.96 5.96 0 00-4.63-2.1 6.06 6.06 0 00-5.78 4.2A5.98 5.98 0 001.3 7.82a6.04 6.04 0 00.74 7.1 5.96 5.96 0 00.52 4.91 6.04 6.04 0 006.52 2.82 5.96 5.96 0 004.63 2.1 6.06 6.06 0 005.78-4.2 5.98 5.98 0 003.53-3.08 6.04 6.04 0 00-.74-7.1zm-8.86 11.02a4.46 4.46 0 01-2.9-1.07l.15-.08 4.8-2.77a.78.78 0 00.39-.68v-6.78l2.03 1.17a.07.07 0 01.04.06v5.6a4.48 4.48 0 01-4.51 4.55zM3.88 17.5a4.47 4.47 0 01-.54-3.04l.15.09 4.8 2.77a.77.77 0 00.78 0l5.87-3.39v2.34a.07.07 0 01-.03.06l-4.85 2.8a4.48 4.48 0 01-6.18-1.63zm-1.3-9.52a4.46 4.46 0 012.36-1.97v5.71a.78.78 0 00.39.68l5.87 3.39-2.03 1.17a.07.07 0 01-.07 0l-4.85-2.8a4.48 4.48 0 01-1.67-6.18zM17.65 11.2l-5.87-3.39 2.03-1.17a.07.07 0 01.07 0l4.85 2.8a4.48 4.48 0 01-.68 8.08v-5.64a.78.78 0 00-.4-.68zm2.47-3.7a4.47 4.47 0 01.54 3.04l-.15-.09-4.8-2.77a.77.77 0 00-.78 0L9.06 11.07V8.73a.07.07 0 01.03-.06l4.85-2.8a4.48 4.48 0 016.18 1.63zM10.58 2.61a4.46 4.46 0 012.9 1.07l-.15.08-4.8 2.77a.78.78 0 00-.39.68v6.78l-2.03-1.17a.07.07 0 01-.04-.06v-5.6a4.48 4.48 0 014.51-4.55z"/>
      </svg>
    );
  }

  if (query.includes("anthropic")) {
    return (
      <svg className={`${className} fill-current text-amber-200`} viewBox="0 0 24 24">
        <path d="M13.82 3h3.58L24 21h-3.62l-1.8-4.46H11.5l-1.78 4.46H6.1L13.82 3zm2.5 10.74l-2.74-6.84-2.73 6.84h5.47zM0 21l6.45-18h3.62L3.62 21H0z"/>
      </svg>
    );
  }

  if (query.includes("nvidia")) {
    return (
      <svg className={`${className} fill-current text-[#76B900]`} viewBox="0 0 24 24">
        <path d="M8.9 7.37c-.38.07-1.18.32-1.78.55-.6.23-1.72.76-2.5 1.18-1.55.84-3.05 2.1-4.02 3.39C0 13.21-.1 14.5.15 15.34c.33 1.13 1.25 1.94 2.62 2.3 1.62.43 3.69.24 5.37-.48 1.45-.63 2.7-1.63 3.55-2.83.67-.95 1.05-1.99 1.14-3.1.06-.7-.03-1.48-.26-2.19-.24-.73-.66-1.27-1.29-1.66-.66-.4-1.52-.61-2.38-.51zm1.06 6.87c-.6.9-1.51 1.62-2.58 2.05-1.27.5-2.76.62-4.04.31-.9-.22-1.42-.71-1.62-1.53-.17-.7-.06-1.6.43-2.34.77-1.18 2.09-2.33 3.49-3.03.66-.33 1.65-.77 2.18-.96.53-.19 1.18-.36 1.48-.38.3-.02.48.06.63.26.16.2.22.47.22.84-.01.8-.31 1.69-.76 2.52-.2.37-.37.74-.43 1.26z"/>
      </svg>
    );
  }

  if (query.includes("crowdstrike") || query.includes("cyber")) {
    return (
      <svg className={`${className} fill-current text-red-500`} viewBox="0 0 24 24">
        <path d="M12 2L2 7v8c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 3.18L18.8 8v6.82c0 4.28-2.91 8.35-6.8 9.5-3.89-1.15-6.8-5.22-6.8-9.5V8L12 5.18zM11 9v6h2V9h-2zm0 8v2h2v-2h-2z"/>
      </svg>
    );
  }

  if (query.includes("palo alto") || query.includes("paloalto")) {
    return (
      <svg className={`${className} fill-current text-orange-400`} viewBox="0 0 24 24">
        <path d="M12 2L4 6v6c0 5.55 3.84 10.74 8 12 4.16-1.26 8-6.45 8-12V6l-8-4zm-1 6h2v6h-2V8zm0 8h2v2h-2v-2z"/>
      </svg>
    );
  }

  if (query.includes("cloudflare")) {
    return (
      <svg className={`${className} fill-current text-[#F38020]`} viewBox="0 0 24 24">
        <path d="M18.2 12.1a4.5 4.5 0 00-8.5-1.7 4 4 0 00-5.7 3.6 4.1 4.1 0 004.1 4h10.4a3.8 3.8 0 003.8-3.8c0-1.2-.6-2.2-1.5-2.9l-2.6.8z"/>
      </svg>
    );
  }

  if (query.includes("coinbase") || query.includes("blockchain") || query.includes("crypto")) {
    return (
      <svg className={`${className} fill-current text-[#0052FF]`} viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 15.5c-3.03 0-5.5-2.47-5.5-5.5S8.97 6.5 12 6.5s5.5 2.47 5.5 5.5-2.47 5.5-5.5 5.5zm-2-7h4v3h-4v-3z"/>
      </svg>
    );
  }

  if (query.includes("chainlink")) {
    return (
      <svg className={`${className} fill-current text-[#375BD2]`} viewBox="0 0 24 24">
        <path d="M12 2L3.5 6.9v9.8L12 21.6l8.5-4.9V6.9L12 2zm5.7 13.3L12 18.6l-5.7-3.3V8.7L12 5.4l5.7 3.3v6.6z"/>
      </svg>
    );
  }

  if (query.includes("binance")) {
    return (
      <svg className={`${className} fill-current text-[#F0B90B]`} viewBox="0 0 24 24">
        <path d="M12 2l3.4 3.4-6.8 6.8L5.2 8.8 12 2zm0 20l-3.4-3.4 6.8-6.8 3.4 3.4L12 22zM2 12l3.4-3.4 3.4 3.4-3.4 3.4L2 12zm20 0l-3.4 3.4-3.4-3.4 3.4-3.4L22 12zm-8.6 0l-1.4-1.4-1.4 1.4 1.4 1.4 1.4-1.4z"/>
      </svg>
    );
  }

  if (query.includes("stripe")) {
    return (
      <svg className={`${className} fill-current text-[#635BFF]`} viewBox="0 0 24 24">
        <path d="M13.976 9.15c0-.987-.79-1.47-2.095-1.47-1.85 0-4.17.784-5.992 1.837V3.97a15.82 15.82 0 016.326-1.3c4.78 0 7.82 2.37 7.82 6.37 0 6.2-8.528 5.21-8.528 7.89 0 1.15.998 1.54 2.457 1.54 2.15 0 4.887-.99 6.84-2.12v5.58a17.2 17.2 0 01-7.172 1.47c-5.06 0-8.243-2.45-8.243-6.49 0-6.66 8.587-5.4 8.587-7.76z"/>
      </svg>
    );
  }

  if (query.includes("uber")) {
    return (
      <svg className={`${className} fill-current text-white`} viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 12h-3v3h-4v-3H7v-4h3V7h4v3h3v4z"/>
      </svg>
    );
  }

  // Default fallback badge icon
  return (
    <svg className={`${className} text-purple-400`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}
