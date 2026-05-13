import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../utils/bem";
import "./PidataStylePagination.scss";

function buildPagerItems(totalPages, safePage) {
  const n = totalPages;
  const cur = safePage;
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1);
  const pages = new Set([1, n, cur, cur - 1, cur + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= n).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * 与「我的任务」表格底部分页一致的 fast-pagination / Element 风格（左汇总 + 右：每页条数、翻页、页码、前往）。
 */
export function PidataStylePagination({
  totalItems,
  page,
  pageSize,
  pageSizeOptions,
  onPageChange,
  urlParamName = "page",
  pageSizeStorageName,
}) {
  const { t } = useTranslation();
  const root = cn("pi-data-pagination");
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const [jumperVal, setJumperVal] = useState(String(safePage));

  useEffect(() => {
    setJumperVal(String(safePage));
  }, [safePage]);

  useEffect(() => {
    if (!urlParamName) return;
    const urlParams = new URLSearchParams(location.search);
    urlParams.set(urlParamName, String(safePage));
    const qs = urlParams.toString();
    const next = qs ? `${location.pathname}?${qs}` : location.pathname;
    history.replaceState({ page: safePage }, "", next);
  }, [safePage, urlParamName]);

  const pagerItems = useMemo(() => buildPagerItems(totalPages, safePage), [totalPages, safePage]);

  const handlePageSizeChange = (e) => {
    const s = Number(e.target.value);
    if (pageSizeStorageName) {
      localStorage.setItem(`pages:${pageSizeStorageName}`, String(s));
    }
    onPageChange(1, s);
  };

  return (
    <div className={root.toClassName()}>
      <div className={root.elem("total").toClassName()}>
        {t("myTasks.paginationLeft", { total: totalItems, page: safePage, totalPages })}
      </div>
      <div className={root.elem("inner").toClassName()}>
        <div className={root.elem("size").toClassName()}>
          <span>{t("myTasks.perPagePrefix")}</span>
          <select
            value={pageSize}
            onChange={handlePageSizeChange}
            aria-label={t("myTasks.pageSize")}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>{t("myTasks.perPageSuffix")}</span>
        </div>
        <button
          type="button"
          className={root.elem("pg-btn").mod({ prev: true }).toClassName()}
          disabled={safePage <= 1}
          aria-label="prev"
          onClick={() => onPageChange(safePage - 1, pageSize)}
        >
          ‹
        </button>
        <ul className={root.elem("pager").toClassName()}>
          {pagerItems.map((item, idx) =>
            item === "…" ? (
              <li key={`e-${idx}`} className={root.elem("pager-ellipsis").toClassName()}>
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  className={root.elem("pager-num").mod({ active: item === safePage }).toClassName()}
                  onClick={() => onPageChange(item, pageSize)}
                >
                  {item}
                </button>
              </li>
            ),
          )}
        </ul>
        <button
          type="button"
          className={root.elem("pg-btn").mod({ next: true }).toClassName()}
          disabled={safePage >= totalPages}
          aria-label="next"
          onClick={() => onPageChange(safePage + 1, pageSize)}
        >
          ›
        </button>
        <span className={root.elem("jumper").toClassName()}>
          {t("myTasks.jumperPrefix")}
          <input
            type="text"
            inputMode="numeric"
            className={root.elem("jumper-input").toClassName()}
            value={jumperVal}
            onChange={(e) => setJumperVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = Number.parseInt(jumperVal, 10);
                if (!Number.isNaN(v)) {
                  onPageChange(Math.min(totalPages, Math.max(1, v)), pageSize);
                }
              }
            }}
          />
          {t("myTasks.jumperSuffix")}
        </span>
      </div>
    </div>
  );
}
