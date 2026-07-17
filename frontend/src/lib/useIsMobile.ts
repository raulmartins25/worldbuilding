import { useEffect, useState } from "react";

// true quando a viewport é <= bp (mobile). Reage a resize/rotação.
export function useIsMobile(bp = 768): boolean {
  const query = `(max-width: ${bp}px)`;
  const [mobile, setMobile] = useState<boolean>(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return mobile;
}
