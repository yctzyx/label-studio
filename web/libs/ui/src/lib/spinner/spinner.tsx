import type { CSSProperties } from "react";
import styles from "./spinner.module.scss";
import { cn } from "@humansignal/shad/utils";

export type SpinnerProps = {
  className?: string;
  style?: CSSProperties;
  size?: number;
  stopped?: boolean;
};

export const Spinner = ({ className, style, size = 32, stopped = false }: SpinnerProps) => {
  const fullClassName = cn(styles.spinner, className);
  const ringClassName = cn(styles.ring, stopped && styles.ringStopped);

  const sizeWithUnit = typeof size === "number" ? `${size}px` : size;

  return (
    <div
      className={fullClassName}
      style={{ ...(style ?? {}), "--spinner-size": sizeWithUnit }}
      role="status"
      aria-label="Loading"
    >
      <div className={ringClassName} />
    </div>
  );
};
