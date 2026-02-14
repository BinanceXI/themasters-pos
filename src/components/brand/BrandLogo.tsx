// BinanceXI watermark
import { useEffect, useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import logoDarkSrc from "@/assets/brand/logo-b25d-dark.png";
import logoLightSrc from "@/assets/brand/logo-ff96-light.png";
import { cn } from "@/lib/utils";

export function BrandMark({ className, title }: { className?: string; title?: string }) {
  const letter = useMemo(() => {
    const src = String(BRAND.shortName || BRAND.name || "K").trim();
    return (src ? src.slice(0, 1) : "K").toUpperCase();
  }, []);

  return (
    <div
      className={cn(
        "rounded-xl bg-primary/15 border border-primary/25 text-primary font-black select-none",
        "flex items-center justify-center leading-none",
        className
      )}
      title={title || BRAND.name}
      aria-label={BRAND.name}
    >
      <span className="relative">
        {letter}
        <span className="absolute -right-2 bottom-0.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
      </span>
    </div>
  );
}

type BrandLogoTone = "auto" | "dark" | "light";

export function BrandLogo({
  className,
  alt,
  title,
  tone = "auto",
}: {
  className?: string;
  alt?: string;
  title?: string;
  tone?: BrandLogoTone;
}) {
  const [failed, setFailed] = useState(false);
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const safeAlt = useMemo(() => {
    const a = String(alt || "").trim();
    return a || BRAND.name;
  }, [alt]);

  const logoSrc = useMemo(() => {
    if (tone === "dark") return logoDarkSrc;
    if (tone === "light") return logoLightSrc;
    return isDark ? logoLightSrc : logoDarkSrc;
  }, [isDark, tone]);

  if (failed) {
    return (
      <div className={cn("font-black tracking-tight select-none", className)} title={title || BRAND.name}>
        {BRAND.name}
      </div>
    );
  }

  return (
    <img
      src={logoSrc}
      alt={safeAlt}
      title={title}
      className={cn("object-contain", className)}
      onError={() => setFailed(true)}
      decoding="async"
      loading="eager"
    />
  );
}
