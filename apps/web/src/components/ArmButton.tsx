import { useEffect, useState, type ReactNode } from "react";

/** A destructive button that asks once: the first click arms it for 2.5 s, the second acts. */
export function ArmButton(props: {
  className: string;
  title?: string;
  armedLabel: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 2500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={props.className + (armed ? " armed" : "")}
      title={props.title}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          props.onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? props.armedLabel : props.children}
    </button>
  );
}
