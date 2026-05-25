import { Button, Typography } from "@humansignal/ui";
import { cn as clsx } from "@humansignal/shad/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "./ParentDatasetPickerInline.scss";
import { fetchParentDatasources, fetchParentDatasets } from "./fetchParentDataset";
import { getLabelStudioApiGateway } from "./getParentPlatformApiBase";
import type { ParentDatasetRow, ParentDatasetSelection, ParentDatasourceRow } from "./types";
import { cn } from "../../../../utils/bem";

const PAGE_SIZE = 20;

const pickerClass = cn("parent-ds-picker");

type Props = {
  projectId?: number | null;
  /** 已写入项目的选型（用于顶部提示条） */
  committedSelection?: ParentDatasetSelection | null;
  onClearCommitted?: () => void;
  onApply: (selection: ParentDatasetSelection) => void;
};

export function ParentDatasetPickerInline({ projectId, committedSelection, onClearCommitted, onApply }: Props) {
  const { t } = useTranslation();

  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [datasources, setDatasources] = useState<ParentDatasourceRow[]>([]);
  const [rows, setRows] = useState<ParentDatasetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ParentDatasetRow | null>(null);

  const baseOk = Boolean(getLabelStudioApiGateway());

  const sourceNameById = useMemo(() => {
    const m = new Map<number, string>();
    datasources.forEach((d) => m.set(d.id, d.name));
    return m;
  }, [datasources]);

  const displayRows = useMemo(() => {
    if (!sourceFilter) return rows;
    const sid = Number(sourceFilter);
    if (!Number.isFinite(sid)) return rows;
    return rows.filter((r) => r.sourceId === sid);
  }, [rows, sourceFilter]);

  const loadDatasources = useCallback(async () => {
    if (!getLabelStudioApiGateway()) return;
    setLoadError(null);
    try {
      const { list } = await fetchParentDatasources(projectId);
      setDatasources(list);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setLoadError(msg);
    }
  }, [projectId]);

  const loadDatasets = useCallback(
    async (pageNum: number) => {
      if (!getLabelStudioApiGateway()) return;
      setLoading(true);
      setLoadError(null);
      try {
        const sidRaw = sourceFilter ? Number(sourceFilter) : undefined;
        const sourceArg = sidRaw !== undefined && Number.isFinite(sidRaw) ? sidRaw : undefined;
        const { list, total: t0 } = await fetchParentDatasets(pageNum, PAGE_SIZE, sourceArg);
        setRows(list);
        setTotal(t0);
        setPage(pageNum);
        setSelected(null);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setLoadError(msg);
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [sourceFilter],
  );

  useEffect(() => {
    void loadDatasources();
  }, [loadDatasources]);

  useEffect(() => {
    void loadDatasets(1);
  }, [sourceFilter, loadDatasets]);

  const onPickRow = useCallback((row: ParentDatasetRow) => {
    setSelected(row);
  }, []);

  const handleApply = useCallback(() => {
    if (!selected) return;
    const selection: ParentDatasetSelection = {
      datasetId: selected.id,
      datasetName: selected.dataSetName,
      sourceId: selected.sourceId,
      sourceName: selected.sourceName ?? sourceNameById.get(selected.sourceId),
      path: selected.path,
      dataSetType: selected.dataSetType,
      dataSetTypeLabel: selected.dataSetTypeLabel,
    };
    onApply(selection);
    setSelected(null);
  }, [selected, sourceNameById, onApply]);

  const handleCancelPending = useCallback(() => {
    setSelected(null);
  }, []);

  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={clsx(pickerClass.toClassName(), "flex flex-col gap-3")}>
      <div>
        <Typography variant="title" size="small" className={clsx(pickerClass.elem("intro-title").toClassName(), "font-medium")}>
          {t("import.parentDataset.inlineTitle")}
        </Typography>
        <Typography size="small" className={clsx(pickerClass.elem("intro-muted").toClassName(), "mt-1 max-w-[720px] leading-relaxed")}>
          {t("import.parentDataset.modalSubtitle")}
        </Typography>
      </div>

      {committedSelection ? (
        <div className={clsx(pickerClass.elem("committed").toClassName(), "flex flex-wrap items-start justify-between gap-2 px-3 py-2")}>
          <div className="min-w-0">
            <Typography size="small" className="text-neutral-content-subtle">
              {t("import.parentDataset.inlineCommitted")}
            </Typography>
            <Typography size="small" className="font-medium text-neutral-content mt-0.5 truncate">
              {committedSelection.datasetName}
            </Typography>
          </div>
          {onClearCommitted ? (
            <Button size="smaller" variant="negative" look="outlined" onClick={onClearCommitted}>
              {t("import.clearParentSelection")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!baseOk ? (
        <Typography size="small" className="text-negative-content">
          {t("import.parentDataset.baseMissing")}
        </Typography>
      ) : null}
      {loadError ? (
        <Typography size="small" className="text-negative-content whitespace-pre-wrap">
          {loadError}
        </Typography>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-body-small text-neutral-content-subtle shrink-0" htmlFor="parent-ds-source-filter">
          {t("import.parentDataset.sourceFilter")}
        </label>
        <select
          id="parent-ds-source-filter"
          className={pickerClass.elem("source-select").toClassName()}
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          disabled={!baseOk || loading}
        >
          <option value="">{t("import.parentDataset.sourceAll")}</option>
          {datasources.map((d) => (
            <option key={d.id} value={String(d.id)}>
              {d.name}
              {d.databaseType != null ? ` (${d.databaseType})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className={pickerClass.elem("table-wrap").toClassName()}>
        <table className={pickerClass.elem("table").toClassName()}>
          <thead>
            <tr>
              <th>{t("import.parentDataset.colName")}</th>
              <th>{t("import.parentDataset.colSource")}</th>
              <th>{t("import.parentDataset.colPath")}</th>
              <th>{t("import.parentDataset.colType")}</th>
              {/* <th className={pickerClass.elem("col-action").toClassName()}>{t("import.parentDataset.colAction")}</th> */}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className={pickerClass.elem("muted-cell").toClassName()}>
                  {t("import.parentDataset.loading")}
                </td>
              </tr>
            ) : null}
            {!loading &&
              displayRows.map((row) => {
                const isActive = selected?.id === row.id;
                return (
                  <tr
                    key={row.id}
                    className={pickerClass.elem("row").mod({ selected: isActive }).toClassName()}
                    onClick={() => onPickRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onPickRow(row);
                      }
                    }}
                    // biome-ignore lint/a11y/useSemanticElements: 表格行整体可选中；无法在 tbody 内用语义 button 包裹整行
                    role="button"
                    tabIndex={0}
                  >
                    <td className={pickerClass.elem("cell-name").toClassName()}>{row.dataSetName}</td>
                    <td>
                      {row.sourceName?.trim()
                        ? row.sourceName
                        : (sourceNameById.get(row.sourceId) ?? (row.sourceId ? String(row.sourceId) : "—"))}
                    </td>
                    <td className={pickerClass.elem("cell-path").toClassName()}>{row.path}</td>
                    <td>{row.dataSetTypeLabel ?? row.dataSetType ?? "—"}</td>
                    {/* <td className={pickerClass.elem("cell-actions").toClassName()}>
                      <Button
                        size="smaller"
                        look={isActive ? "primary" : "outlined"}
                        className={clsx(!isActive && pickerClass.elem("pick-outline").toClassName())}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPickRow(row);
                        }}
                      >
                        {t("import.parentDataset.choose")}
                      </Button>
                    </td> */}
                  </tr>
                );
              })}
            {!loading && displayRows.length === 0 ? (
              <tr>
                <td colSpan={5} className={pickerClass.elem("muted-cell").toClassName()}>
                  {t("import.parentDataset.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Typography size="small" className={pickerClass.elem("page-meta").toClassName()}>
          {t("import.parentDataset.pageInfo", { page, totalPages: maxPage, total })}
        </Typography>
        <div className="flex gap-2">
          <Button
            size="smaller"
            look="outlined"
            className={pickerClass.elem("page-btn").toClassName()}
            disabled={page <= 1 || loading}
            onClick={() => void loadDatasets(page - 1)}
          >
            {t("import.parentDataset.prev")}
          </Button>
          <Button
            size="smaller"
            look="outlined"
            className={pickerClass.elem("page-btn").toClassName()}
            disabled={page >= maxPage || loading}
            onClick={() => void loadDatasets(page + 1)}
          >
            {t("import.parentDataset.next")}
          </Button>
        </div>
      </div>

      <div className={clsx(pickerClass.elem("footer-bar").toClassName(), "flex flex-wrap items-center justify-between gap-3 pt-3")}>
        <Typography size="small" className={clsx(pickerClass.elem("intro-muted").toClassName(), "min-w-0 font-normal")}>
          {selected
            ? t("import.parentDataset.footerSelected", { name: selected.dataSetName })
            : t("import.parentDataset.footerHint")}
        </Typography>
        <div className={clsx(pickerClass.elem("footer-actions").toClassName(), "flex gap-2 shrink-0")}>
          <Button
            look="outlined"
            type="button"
            className={pickerClass.elem("btn-outline-soft").toClassName()}
            onClick={handleCancelPending}
            disabled={!selected}
          >
            {t("import.parentDataset.discardPending")}
          </Button>
          <Button
            look="primary"
            type="button"
            className={pickerClass.elem("btn-primary-solid").toClassName()}
            disabled={!selected}
            onClick={handleApply}
          >
            {t("import.parentDataset.applySelection")}
          </Button>
        </div>
      </div>
    </div>
  );
}
