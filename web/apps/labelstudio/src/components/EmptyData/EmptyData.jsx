import { useTranslation } from "react-i18next";
import { cn } from "../../utils/bem";
import "./EmptyData.scss";

/**
 * Empty state component that mimics element-plus `<el-empty />`.
 * Uses the exact SVG illustration shipped with element-plus
 * so the look matches the parent app when embedded.
 *
 * @param {object} props
 * @param {string} [props.description] — text shown below the illustration; defaults to "暂无数据"
 * @param {number} [props.imageSize] — illustration width in px (default 80, matches el's default)
 * @param {React.ReactNode} [props.children] — optional action slot rendered below the description
 */
export const EmptyData = ({ description, imageSize = 80, children }) => {
  const { t } = useTranslation();
  const block = cn("ls-empty");
  return (
    <div className={block.toClassName()}>
      <div
        className={block.elem("image").toClassName()}
        style={{ width: imageSize, height: (imageSize * 86) / 79 }}
      >
        <svg viewBox="0 0 79 86" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient
              id="ls-empty-linear-1"
              x1="38.8503086%"
              y1="0%"
              x2="61.1496914%"
              y2="100%"
            >
              <stop stopColor="var(--el-empty-fill-color-1)" offset="0%" />
              <stop stopColor="var(--el-empty-fill-color-4)" offset="100%" />
            </linearGradient>
            <linearGradient
              id="ls-empty-linear-2"
              x1="0%"
              y1="9.5%"
              x2="100%"
              y2="90.5%"
            >
              <stop stopColor="var(--el-empty-fill-color-1)" offset="0%" />
              <stop stopColor="var(--el-empty-fill-color-6)" offset="100%" />
            </linearGradient>
            <rect id="ls-empty-path-3" x="0" y="0" width="17" height="36" />
          </defs>
          <g stroke="none" strokeWidth="1" fill="none" fillRule="evenodd">
            <g transform="translate(-1268, -535)">
              <g transform="translate(1268, 535)">
                <path
                  d="M39.5,86 C61.3152476,86 79,83.9106622 79,81.3333333 C79,78.7560045 57.3152476,78 35.5,78 C13.6847524,78 0,78.7560045 0,81.3333333 C0,83.9106622 17.6847524,86 39.5,86 Z"
                  fill="var(--el-empty-fill-color-3)"
                />
                <polygon
                  fill="var(--el-empty-fill-color-7)"
                  transform="translate(27.5,51.5) scale(1,-1) translate(-27.5,-51.5)"
                  points="13 58 53 58 42 45 2 45"
                />
                <g transform="translate(34.5, 31.5) scale(-1, 1) rotate(-25) translate(-34.5, -31.5) translate(7, 10)">
                  <polygon
                    fill="var(--el-empty-fill-color-7)"
                    transform="translate(11.5,5) scale(1,-1) translate(-11.5,-5)"
                    points="0 3 18 3 23 7 5 7"
                  />
                  <polygon
                    fill="var(--el-empty-fill-color-5)"
                    points="0 7 38 7 38 43 0 43"
                  />
                  <rect
                    fill="url(#ls-empty-linear-1)"
                    transform="translate(46.5,25) scale(-1,1) translate(-46.5,-25)"
                    x="38"
                    y="7"
                    width="17"
                    height="36"
                  />
                  <polygon
                    fill="var(--el-empty-fill-color-2)"
                    transform="translate(39.5,3.5) scale(-1,1) translate(-39.5,-3.5)"
                    points="24 7 41 7 55 0 38 0"
                  />
                </g>
                <rect
                  fill="url(#ls-empty-linear-2)"
                  x="13"
                  y="45"
                  width="40"
                  height="36"
                />
                <g transform="translate(53, 45)">
                  <use
                    fill="var(--el-empty-fill-color-8)"
                    transform="translate(8.5,18) scale(-1,1) translate(-8.5,-18)"
                    xlinkHref="#ls-empty-path-3"
                  />
                  <polygon
                    fill="var(--el-empty-fill-color-9)"
                    transform="translate(12,9) scale(-1,1) translate(-12,-9)"
                    points="7 0 24 0 20 18 7 16.5"
                  />
                </g>
                <polygon
                  fill="var(--el-empty-fill-color-2)"
                  transform="translate(66,51.5) scale(-1,1) translate(-66,-51.5)"
                  points="62 45 79 45 70 58 53 58"
                />
              </g>
            </g>
          </g>
        </svg>
      </div>
      <p className={block.elem("description").toClassName()}>
        {description ?? t("No Data", { defaultValue: "暂无数据" })}
      </p>
      {children ? <div className={block.elem("bottom").toClassName()}>{children}</div> : null}
    </div>
  );
};
