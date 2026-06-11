import { cn } from "../../utils/bem";
import "./Spinner.scss";

export const Spinner = ({ className, style, size = 32, stopped = false }) => {
  const rootClass = cn("spinner-ls");
  const sizeWithUnit = typeof size === "number" ? `${size}px` : size;

  return (
    <div
      className={rootClass.mix(className)}
      style={{ ...(style ?? {}), "--spinner-size": sizeWithUnit }}
      role="status"
      aria-label="加载中"
    >
      {/* <div className={rootClass.elem("ring").mod({ stopped })} /> */}
    </div>
  );
};
