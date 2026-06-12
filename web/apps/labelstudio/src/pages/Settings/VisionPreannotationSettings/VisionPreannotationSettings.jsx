import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, SimpleCard, Spinner, ToastType, Typography, useToast } from "@humansignal/ui";
import { createTitleFromSegments, useUpdatePageTitle } from "@humansignal/core";
import { useAPI } from "../../../providers/ApiProvider";
import { ProjectContext } from "../../../providers/ProjectProvider";
import "./VisionPreannotationSettings.scss";

const BACKEND_TITLE = "Grounding DINO 视觉预标注";
const DEFAULT_BACKEND_URL = window.APP_SETTINGS?.grounding_dino_ml_backend_url || "http://localhost:9092";

const inputClass =
  "w-full px-tight py-tight rounded-sm border border-neutral-border bg-neutral-surface text-body-small " +
  "focus:outline-none focus:border-primary-border";

const Field = ({ label, description, required, children }) => (
  <label className="block mb-wide">
    <span className="block text-body-small font-medium mb-tight">
      {label}
      {required && <span className="text-negative-content"> *</span>}
    </span>
    {children}
    {description && <span className="block text-body-smaller text-neutral-content-subtler mt-tight">{description}</span>}
  </label>
);

const splitAliases = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const joinAliases = (value) => (Array.isArray(value) ? value.join(", ") : value || "");

const getRectangleLabels = (project) => {
  const parsed = project?.parsed_label_config ?? {};
  return Object.entries(parsed)
    .filter(([, info]) => info?.type === "RectangleLabels")
    .flatMap(([fromName, info]) => {
      const attrs = info?.labels_attrs ?? {};
      return (info?.labels ?? []).map((label) => {
        const aliases = splitAliases(attrs[label]?.predicted_values);
        return {
          id: `${fromName}:${label}`,
          fromName,
          label,
          enabled: true,
          prompt: aliases[0] || label,
          aliases: aliases.slice(1),
        };
      });
    });
};

const mergeLabels = (templateLabels, configuredLabels = []) => {
  const configuredByLabel = new Map(configuredLabels.map((item) => [item.label, item]));
  return templateLabels.map((item) => ({
    ...item,
    ...(configuredByLabel.get(item.label) ?? {}),
    enabled: configuredByLabel.get(item.label)?.enabled ?? item.enabled,
  }));
};

const emptyState = () => ({
  enabled: true,
  backendUrl: DEFAULT_BACKEND_URL,
  preset: "balanced",
  boxThreshold: 0.3,
  textThreshold: 0.25,
  maxBoxesPerImage: 100,
  isInteractive: true,
  labels: [],
});

const thresholdPresets = {
  recall: { boxThreshold: 0.2, textThreshold: 0.2 },
  balanced: { boxThreshold: 0.3, textThreshold: 0.25 },
  precision: { boxThreshold: 0.45, textThreshold: 0.35 },
};

export const VisionPreannotationSettings = () => {
  const api = useAPI();
  const toast = useToast();
  const { project, fetchProject } = useContext(ProjectContext);
  const [state, setState] = useState(emptyState);
  const [backendId, setBackendId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState(null);

  useUpdatePageTitle(createTitleFromSegments([project?.title, "视觉预标注"]));

  const templateLabels = useMemo(() => getRectangleLabels(project), [project?.parsed_label_config]);
  const generatedPrompt = useMemo(
    () =>
      state.labels
        .filter((item) => item.enabled && item.prompt)
        .map((item) => item.prompt)
        .join(", "),
    [state.labels],
  );

  const update = useCallback((patch) => setState((prev) => ({ ...prev, ...patch })), []);

  const fetchBackend = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    const backends = await api.callApi("mlBackends", { params: { project: project.id } });
    const backend = (backends ?? []).find((item) => item?.extra_params?._vision_preannotation);

    if (backend) {
      const ep = backend.extra_params ?? {};
      const thresholds = ep.thresholds ?? {};
      const policy = ep.prediction_policy ?? {};
      setBackendId(backend.id);
      setState({
        enabled: true,
        backendUrl: backend.url || DEFAULT_BACKEND_URL,
        preset: thresholds.preset || "balanced",
        boxThreshold: thresholds.box_threshold ?? 0.3,
        textThreshold: thresholds.text_threshold ?? 0.25,
        maxBoxesPerImage: policy.max_boxes_per_image ?? 100,
        isInteractive: Boolean(backend.is_interactive),
        labels: mergeLabels(templateLabels, ep.labels ?? []),
      });
    } else {
      setState({ ...emptyState(), labels: templateLabels });
    }
    setLoading(false);
  }, [api, project?.id, templateLabels]);

  useEffect(() => {
    fetchBackend();
  }, [fetchBackend]);

  const updateLabel = useCallback((index, patch) => {
    setState((prev) => ({
      ...prev,
      labels: prev.labels.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    }));
  }, []);

  const onPresetChange = useCallback(
    (preset) => {
      update({ preset, ...(thresholdPresets[preset] ?? {}) });
    },
    [update],
  );

  const buildExtraParams = useCallback(
    () => ({
      _vision_preannotation: true,
      provider: "grounding_dino",
      prompt: {
        mode: "from_label_config",
        joiner: ", ",
      },
      labels: state.labels.map((item) => ({
        label: item.label,
        enabled: item.enabled,
        prompt: item.prompt,
        aliases: item.aliases ?? [],
      })),
      thresholds: {
        preset: state.preset,
        box_threshold: Number(state.boxThreshold),
        text_threshold: Number(state.textThreshold),
      },
      prediction_policy: {
        batch_mode: "empty_only",
        write_target: "prediction",
        unmapped_policy: "discard",
        max_boxes_per_image: Number(state.maxBoxesPerImage),
      },
    }),
    [state],
  );

  const onSave = useCallback(async () => {
    setError(null);
    if (!state.backendUrl) {
      setError("请填写 Grounding DINO 后端服务地址。");
      return;
    }
    if (!state.labels.some((item) => item.enabled && item.prompt)) {
      setError("当前标注模板没有可用检测词，请在标签映射中至少启用一个标签并填写检测词。");
      return;
    }

    setSaving(true);
    const body = {
      project: project.id,
      title: BACKEND_TITLE,
      url: state.backendUrl,
      is_interactive: state.isInteractive,
      auto_update: false,
      extra_params: buildExtraParams(),
    };
    const action = backendId ? "updateMLBackend" : "addMLBackend";
    const response = await api.callApi(action, {
      params: backendId ? { pk: backendId } : {},
      body,
    });
    setSaving(false);

    if (!response || response.error_message || response.$meta?.ok === false) {
      const message = response?.error_message || response?.response?.detail || "保存失败，请确认 Grounding DINO 后端已启动。";
      setError(message);
      toast?.show({ message: "视觉预标注配置保存失败", type: ToastType.error });
      return;
    }

    if (response.id) setBackendId(response.id);
    await api.callApi("updateProject", {
      params: { pk: project.id },
      body: {
        show_collab_predictions: true,
        reveal_preannotations_interactively: state.isInteractive,
        model_version: BACKEND_TITLE,
      },
    });
    fetchProject?.();
    toast?.show({ message: "视觉预标注配置已保存", type: ToastType.info });
  }, [api, backendId, buildExtraParams, fetchProject, project?.id, state, toast]);

  const onTest = useCallback(async () => {
    if (!backendId) {
      toast?.show({ message: "请先保存配置后再测试", type: ToastType.info });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const response = await api.callApi("predictWithML", {
      params: { pk: backendId, random: true },
    });
    setTesting(false);
    setTestResult(response ?? { error: "无响应" });
  }, [api, backendId, toast]);

  const onDelete = useCallback(async () => {
    if (!backendId) return;
    await api.callApi("deleteMLBackend", { params: { pk: backendId } });
    setBackendId(null);
    setState({ ...emptyState(), labels: templateLabels });
    setTestResult(null);
    toast?.show({ message: "已移除视觉预标注配置", type: ToastType.info });
  }, [api, backendId, templateLabels, toast]);

  if (loading) {
    return (
      <section className="max-w-[52rem]">
        <Spinner size={32} />
      </section>
    );
  }

  return (
    <section className="vision-preannotation max-w-[52rem]">
      <Typography variant="headline" size="medium" className="mb-tight">
        视觉预标注
      </Typography>
      <Typography size="small" className="text-neutral-content-subtler mb-wide">
        使用 Grounding DINO 根据图片标注模板自动生成候选框。核心配置会保存为项目 ML Backend，可用于数据管理批量预测和标注页交互式预标注。
      </Typography>

      <SimpleCard title="服务连接" className="mb-wide p-base">
        <Field label="Grounding DINO 后端地址" required description="默认独立服务地址为 http://localhost:9092。">
          <input className={inputClass} value={state.backendUrl} onChange={(e) => update({ backendUrl: e.target.value })} />
        </Field>
        <label className="flex items-center gap-tight cursor-pointer">
          <input
            type="checkbox"
            checked={state.isInteractive}
            onChange={(e) => update({ isInteractive: e.target.checked })}
          />
          <span className="text-body-small">启用标注页交互式预标注</span>
        </label>
      </SimpleCard>

      <SimpleCard title="标签与检测词映射" className="mb-wide p-base">
        {state.labels.length === 0 ? (
          <Typography size="small" className="text-negative-content">
            当前项目标注模板中未找到 RectangleLabels，无法启用 Grounding DINO 视觉预标注。
          </Typography>
        ) : (
          <div className="vision-preannotation__labels">
            <div className="vision-preannotation__label-row vision-preannotation__label-head">
              <span>业务标签</span>
              <span>检测词</span>
              <span>别名</span>
              <span>启用</span>
            </div>
            {state.labels.map((item, index) => (
              <div key={item.id ?? item.label} className="vision-preannotation__label-row">
                <span className="text-body-small font-medium truncate" title={item.label}>
                  {item.label}
                </span>
                <input
                  className={inputClass}
                  value={item.prompt}
                  placeholder="person"
                  onChange={(e) => updateLabel(index, { prompt: e.target.value })}
                />
                <input
                  className={inputClass}
                  value={joinAliases(item.aliases)}
                  placeholder="people, human"
                  onChange={(e) => updateLabel(index, { aliases: splitAliases(e.target.value) })}
                />
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(e) => updateLabel(index, { enabled: e.target.checked })}
                />
              </div>
            ))}
          </div>
        )}
        <Field label="最终生成 Prompt" description="保存后后端会使用这段 Prompt 进行开放词表检测。">
          <textarea className={`${inputClass} min-h-[72px] font-mono`} value={generatedPrompt} readOnly />
        </Field>
      </SimpleCard>

      <SimpleCard title="推理参数" className="mb-wide p-base">
        <Field label="参数模式">
          <select className={inputClass} value={state.preset} onChange={(e) => onPresetChange(e.target.value)}>
            <option value="recall">高召回</option>
            <option value="balanced">均衡</option>
            <option value="precision">高精度</option>
            <option value="custom">自定义</option>
          </select>
        </Field>
        <div className="vision-preannotation__grid">
          <Field label="Box Threshold">
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              className={inputClass}
              value={state.boxThreshold}
              onChange={(e) => update({ boxThreshold: e.target.value, preset: "custom" })}
            />
          </Field>
          <Field label="Text Threshold">
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              className={inputClass}
              value={state.textThreshold}
              onChange={(e) => update({ textThreshold: e.target.value, preset: "custom" })}
            />
          </Field>
        </div>
        <Field label="单图最大框数">
          <input
            type="number"
            min="1"
            step="1"
            className={inputClass}
            value={state.maxBoxesPerImage}
            onChange={(e) => update({ maxBoxesPerImage: e.target.value })}
          />
        </Field>
      </SimpleCard>

      {error && (
        <div className="mb-wide p-base rounded-sm border border-negative-border bg-negative-background">
          <Typography size="small" className="text-negative-content whitespace-pre-wrap">
            {error}
          </Typography>
        </div>
      )}

      <div className="flex items-center gap-tight">
        <Button variant="primary" waiting={saving} onClick={onSave} aria-label="保存视觉预标注配置">
          保存
        </Button>
        <Button variant="neutral" look="outlined" waiting={testing} disabled={!backendId} onClick={onTest}>
          测试请求
        </Button>
        {backendId && (
          <Button variant="negative" look="outlined" onClick={onDelete} className="ml-auto">
            移除配置
          </Button>
        )}
      </div>

      {testResult && (
        <div className="mt-wide">
          <Typography variant="title" size="small" className="mb-tight">
            测试结果
          </Typography>
          <div className="bg-neutral-surface rounded-sm p-tight overflow-y-auto max-h-[360px]">
            <pre className="whitespace-pre-wrap break-words text-body-smaller">
              {JSON.stringify(testResult.response ?? testResult, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
};

VisionPreannotationSettings.title = "视觉预标注";
VisionPreannotationSettings.path = "/vision-preannotation";
