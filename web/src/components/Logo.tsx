/** The cartridge mark, shared with the PWA icons. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <path d="M160 137H352C412 137 460 183 460 243C460 302 420 349 368 349C341 349 319 337 301 317H211C193 337 171 349 144 349C92 349 52 302 52 243C52 183 100 137 160 137Z" fill="#939590" transform="translate(0 24)" />
      <path d="M160 137H352C412 137 460 183 460 243C460 302 420 349 368 349C341 349 319 337 301 317H211C193 337 171 349 144 349C92 349 52 302 52 243C52 183 100 137 160 137Z" fill="#D2D2CE" />
      <path d="M139 196H165Q171 196 171 202V221H190Q196 221 196 227V253Q196 259 190 259H171V278Q171 284 165 284H139Q133 284 133 278V259H114Q108 259 108 253V227Q108 221 114 221H133V202Q133 196 139 196Z" fill="#303232" />
      <circle cx="360" cy="202" r="17" fill="#F1C53A" />
      <circle cx="327" cy="235" r="17" fill="#326FC7" />
      <circle cx="393" cy="235" r="17" fill="#36A167" />
      <circle cx="360" cy="268" r="17" fill="#E04B42" />
      <rect x="219" y="258" width="28" height="10" rx="5" fill="#646762" />
      <rect x="261" y="258" width="28" height="10" rx="5" fill="#646762" />
    </svg>
  );
}
