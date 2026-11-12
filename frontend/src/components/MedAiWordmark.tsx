export function MedAiWordmark() {
  return (
    <div className="medai-wordmark-wrap" aria-label="MED-AI">
      <svg
        className="medai-wordmark-svg"
        viewBox="0 0 415 128"
        role="img"
        aria-label="MED-AI"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Left sweeping lower serif swash off the M */}
        <path
          d="M66 90 C44 114, 14 112, 16 90 C17 76, 36 74, 42 84"
          stroke="#584B63"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle cx="42.5" cy="84.5" r="2.2" fill="#584B63" />

        {/* Editorial high-contrast serif wordmark */}
        <text
          x="64"
          y="91"
          fill="#2F2936"
          fontFamily="'Cinzel', 'Cormorant Garamond', Georgia, serif"
          fontSize="58"
          fontWeight="600"
          letterSpacing="3"
        >
          MED-AI
        </text>

        {/* Right sweeping upper swash flourish extending from the I */}
        <path
          d="M305 48 C334 48, 364 48, 372 33 C379 20, 354 17, 337 34 C318 52, 260 48, 252 27 C247 14, 263 6, 278 14 C289 20, 289 32, 280 36"
          stroke="#584B63"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle cx="279.5" cy="36" r="2.3" fill="#584B63" />
      </svg>
    </div>
  )
}
