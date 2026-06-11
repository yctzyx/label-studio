import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Button, Typography, Spinner, SimpleCard, useToast, ToastType } from "@humansignal/ui";
import { useUpdatePageTitle, createTitleFromSegments } from "@humansignal/core";
import { useAPI } from "../../../providers/ApiProvider";
import { ProjectContext } from "../../../providers/ProjectProvider";
import {
  LLM_PROVIDERS,
  DEFAULT_PROVIDER,
  getProvider,
  PROMPT_TEMPLATES,
  MODEL_CAPABILITY,
  PIC_TAGS_PROMPT,
} from "./providers";
import "./LLMPreannotationSettings.scss";

const BACKEND_TITLE = "LLM 大模型预标注";
const DEFAULT_BACKEND_URL = window.APP_SETTINGS?.llm_ml_backend_url || "http://localhost:9090";

const emptyState = () => {
  const provider = getProvider(DEFAULT_PROVIDER);
  return {
    backendUrl: DEFAULT_BACKEND_URL,
    provider: provider.value,
    baseUrl: provider.baseUrl,
    apiKey: "",
    apiKeyIsSet: false,
    model: provider.models[0]?.value ?? "",
    modelType: provider.models[0]?.capability ?? MODEL_CAPABILITY.TEXT,
    azureEndpoint: "",
    azureDeployment: "",
    azureApiVersion: "2024-02-15-preview",
    systemPrompt: "",
    promptTemplate: "pic_tags",
    outputMode: "choices_json",
    taskType: "pic_tags",
    prompt: PIC_TAGS_PROMPT,
    temperature: 0,
    isInteractive: true,
    autoUpdate: true,
  };
};

const inferPromptTemplate = (extraParams) => {
  if (extraParams?.prompt_template_id) return extraParams.prompt_template_id;
  const prompt = extraParams?.prompt;
  return PROMPT_TEMPLATES.find((template) => template.prompt === prompt)?.value ?? "";
};

const Field = ({ label, description, required, children }) => (
  <label className="block mb-wide">
    <span className="block text-body-small font-medium mb-tight">
      {label}
      {required && <span className="text-negative-content"> *</span>}
    </span>
    {children}
    {description && (
      <span className="block text-body-smaller text-neutral-content-subtler mt-tight">{description}</span>
    )}
  </label>
);

const inputClass =
  "w-full px-tight py-tight rounded-sm border border-neutral-border bg-neutral-surface text-body-small " +
  "focus:outline-none focus:border-primary-border";

export const LLMPreannotationSettings = () => {
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

  useUpdatePageTitle(createTitleFromSegments([project?.title, "大模型预标注"]));

  const providerDef = useMemo(() => getProvider(state.provider), [state.provider]);

  const update = useCallback((patch) => setState((prev) => ({ ...prev, ...patch })), []);

  const applyBackend = useCallback((backend) => {
    if (!backend) return;
    const ep = backend.extra_params ?? {};
    const provider = getProvider(ep.provider ?? DEFAULT_PROVIDER);
    setBackendId(backend.id);
    setState({
      backendUrl: backend.url ?? DEFAULT_BACKEND_URL,
      provider: provider.value,
      baseUrl: ep.base_url ?? provider.baseUrl,
      apiKey: "",
      apiKeyIsSet: Boolean(ep.api_key),
      model: ep.model ?? provider.models[0]?.value ?? "",
      modelType: ep.model_type ?? MODEL_CAPABILITY.TEXT,
      azureEndpoint: ep.resource_endpoint ?? "",
      azureDeployment: ep.deployment_name ?? "",
      azureApiVersion: ep.api_version ?? "2024-02-15-preview",
      systemPrompt: ep.system_prompt ?? "",
      promptTemplate: inferPromptTemplate(ep),
      outputMode: ep.output_mode ?? "choices_json",
      taskType: ep.task_type ?? "",
      prompt: ep.prompt || PIC_TAGS_PROMPT,
      temperature: ep.temperature ?? 0.2,
      isInteractive: Boolean(backend.is_interactive),
      autoUpdate: backend.auto_update !== false,
    });
  }, []);

  const fetchBackend = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    const backends = await api.callApi("mlBackends", {
      params: { project: project.id },
    });
    const llmBackend = (backends ?? []).find((b) => b?.extra_params?._llm_preannotation);
    if (llmBackend) applyBackend(llmBackend);
    setLoading(false);
  }, [project?.id, api, applyBackend]);

  useEffect(() => {
    fetchBackend();
  }, [fetchBackend]);

  const onProviderChange = useCallback(
    (value) => {
      const provider = getProvider(value);
      const firstModel = provider.models.find((m) => m.capability === state.modelType) ?? provider.models[0];
      update({
        provider: value,
        baseUrl: provider.baseUrl,
        model: firstModel?.value ?? "",
        modelType: firstModel?.capability ?? MODEL_CAPABILITY.TEXT,
      });
    },
    [state.modelType, update],
  );

  const onModelChange = useCallback(
    (value) => {
      const model = providerDef.models.find((m) => m.value === value);
      update({ model: value, modelType: model?.capability ?? state.modelType });
    },
    [providerDef, state.modelType, update],
  );

  const buildExtraParams = useCallback(() => {
    const params = {
      _llm_preannotation: true,
      provider: state.provider,
      model: state.model,
      model_type: state.modelType,
      temperature: Number(state.temperature),
      num_responses: 1,
      system_prompt: state.systemPrompt || "",
      prompt_template_id: state.promptTemplate || "",
      task_type: state.taskType || state.promptTemplate || "",
      prompt: state.prompt || "",
      use_internal_prompt_template: false,
      output_mode: state.outputMode || "choices_json",
      strict_labels: true,
    };
    if (state.outputMode === "anti_fraud_json") {
      Object.assign(params, {
        task_type: "anti_fraud_screenshot",
        image_object_name: "image",
        main_illegal_types_from_name: "main_illegal_types",
        fraud_types_from_name: "fraud_types",
        raw_json_to_name: "raw_json",
      });
    }
    if (state.baseUrl) params.base_url = state.baseUrl;
    // 仅在用户输入了新 Key 时更新；留空表示沿用已保存的 Key
    if (state.apiKey) params.api_key = state.apiKey;
    if (state.provider === "azure") {
      params.resource_endpoint = state.azureEndpoint;
      params.deployment_name = state.azureDeployment;
      params.api_version = state.azureApiVersion;
    }
    return params;
  }, [state]);

  const onSave = useCallback(async () => {
    setError(null);
    setSaving(true);

    // 编辑场景下，需要保留之前已保存的 api_key（后端 extra_params 会被整体覆盖）
    let extraParams = buildExtraParams();
    if (!state.apiKey && backendId) {
      const current = await api.callApi("mlBackend", { params: { pk: backendId } });
      const existingKey = current?.extra_params?.api_key;
      if (existingKey) extraParams = { ...extraParams, api_key: existingKey };
    }

    const body = {
      project: project.id,
      title: BACKEND_TITLE,
      url: state.backendUrl,
      is_interactive: state.isInteractive,
      auto_update: state.autoUpdate,
      extra_params: extraParams,
    };

    const action = backendId ? "updateMLBackend" : "addMLBackend";
    const response = await api.callApi(action, {
      params: backendId ? { pk: backendId } : {},
      body,
    });

    setSaving(false);

    if (!response || response.error_message || response.$meta?.ok === false) {
      const message =
        response?.error_message || response?.response?.detail || "保存失败，请确认大模型后端服务已启动且配置正确。";
      setError(message);
      toast?.show({ message: "大模型预标注配置保存失败", type: ToastType.error });
      return;
    }

    if (response.id) setBackendId(response.id);
    await api.callApi("updateProject", {
      params: { pk: project.id },
      body: {
        show_collab_predictions: true,
        model_version: BACKEND_TITLE,
      },
    });
    fetchProject?.();
    update({ apiKey: "", apiKeyIsSet: Boolean(extraParams.api_key) });
    toast?.show({ message: "大模型预标注配置已保存", type: ToastType.info });
  }, [api, backendId, buildExtraParams, fetchProject, project?.id, state, toast, update]);

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
    setState(emptyState());
    setTestResult(null);
    toast?.show({ message: "已移除大模型预标注配置", type: ToastType.info });
  }, [api, backendId, toast]);

  if (loading) {
    return (
      <section className="max-w-[46rem]">
        <Spinner size={32} />
      </section>
    );
  }

  return (
    <section className="max-w-[46rem]">
      <Typography variant="headline" size="medium" className="mb-tight">
        大模型预标注
      </Typography>
      <Typography size="small" className="text-neutral-content-subtler mb-wide">
        配置大语言模型 / 多模态模型为本项目生成预标注。保存后即可在「数据管理」中批量获取预测，或在标注页交互式生成。
      </Typography>

      <SimpleCard title="模型连接" className="mb-wide p-base">
        <Field label="厂商" required>
          <select className={inputClass} value={state.provider} onChange={(e) => onProviderChange(e.target.value)}>
            {LLM_PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {state.provider !== "azure" && providerDef.baseUrlEditable && (
          <Field label="Base URL" description="OpenAI 兼容接口地址，国内厂商通常已预填。" required>
            <input
              className={inputClass}
              value={state.baseUrl}
              placeholder="https://..."
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
          </Field>
        )}

        {state.provider === "azure" && (
          <>
            <Field label="Azure Endpoint" required>
              <input
                className={inputClass}
                value={state.azureEndpoint}
                placeholder="https://your-resource.openai.azure.com"
                onChange={(e) => update({ azureEndpoint: e.target.value })}
              />
            </Field>
            <Field label="Deployment 名称" required>
              <input
                className={inputClass}
                value={state.azureDeployment}
                onChange={(e) => update({ azureDeployment: e.target.value })}
              />
            </Field>
            <Field label="API Version">
              <input
                className={inputClass}
                value={state.azureApiVersion}
                onChange={(e) => update({ azureApiVersion: e.target.value })}
              />
            </Field>
          </>
        )}

        <Field
          label="API Key"
          required={providerDef.apiKeyRequired}
          description={state.apiKeyIsSet ? "已配置 API Key，留空表示不修改。" : undefined}
        >
          <input
            type="password"
            className={inputClass}
            value={state.apiKey}
            placeholder={state.apiKeyIsSet ? "********（已保存）" : "请输入 API Key"}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </Field>

        <Field label="模型" required>
          {providerDef.models.length > 0 ? (
            <select className={inputClass} value={state.model} onChange={(e) => onModelChange(e.target.value)}>
              {providerDef.models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputClass}
              value={state.model}
              placeholder="填写模型 ID，例如 gpt-4o"
              onChange={(e) => update({ model: e.target.value })}
            />
          )}
        </Field>

        <Field label="模型类型" description="多模态(vision)会把图像直接发送给模型；文本(text)对图像走 OCR 兜底。">
          <select
            className={inputClass}
            value={state.modelType}
            onChange={(e) => update({ modelType: e.target.value })}
          >
            <option value={MODEL_CAPABILITY.TEXT}>文本</option>
            <option value={MODEL_CAPABILITY.VISION}>多模态（图文）</option>
          </select>
        </Field>
      </SimpleCard>

      <SimpleCard title="提示词（Prompt）" className="mb-wide p-base">
        <Field label="从模板填充">
          <select
            className={inputClass}
            value={state.promptTemplate}
            onChange={(e) => {
              const tpl = PROMPT_TEMPLATES.find((t) => t.value === e.target.value);
              const preferredModel = tpl?.capability
                ? (providerDef.models.find((m) => m.capability === tpl.capability) ?? null)
                : null;
              update({
                promptTemplate: e.target.value,
                outputMode: tpl?.outputMode ?? state.outputMode,
                taskType: tpl?.taskType ?? e.target.value,
                modelType: tpl?.capability ?? state.modelType,
                model: preferredModel?.value ?? state.model,
                temperature: tpl?.value === "anti_fraud_screenshot" ? 0.1 : state.temperature,
                prompt: tpl?.prompt ?? state.prompt,
              });
            }}
          >
            <option value="">选择一个内置模板…</option>
            {PROMPT_TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="System 指令（可选）" description="设定模型角色与全局约束。">
          <textarea
            className={`${inputClass} min-h-[72px]`}
            value={state.systemPrompt}
            onChange={(e) => update({ systemPrompt: e.target.value })}
          />
        </Field>

        <Field
          label="Prompt 模板"
          required
          description="使用思路：标注模板定义可回填的标签和字段，Prompt 模板负责指导模型按指定 JSON 输出。{labels}、{image_url}、{text} 以及任务 data 字段会在请求时自动替换；自定义占位符需与标注模板选项或任务 data 字段保持一致。"
        >
          <textarea
            className={`${inputClass} min-h-[140px] font-mono`}
            value={state.prompt}
            placeholder="例如：请判断下面文本的类别：{labels}\n\n文本：{text}"
            onChange={(e) => update({ prompt: e.target.value, promptTemplate: "" })}
          />
        </Field>

        <div className="flex gap-wide">
          <Field label="Temperature">
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              className={inputClass}
              value={state.temperature}
              onChange={(e) => update({ temperature: e.target.value })}
            />
          </Field>
        </div>

        <label className="flex items-center gap-tight mt-tight cursor-pointer">
          <input
            type="checkbox"
            checked={state.isInteractive}
            onChange={(e) => update({ isInteractive: e.target.checked })}
          />
          <span className="text-body-small">启用交互式预标注（标注页修改 Prompt 后实时生成）</span>
        </label>
      </SimpleCard>

      {error && (
        <div className="mb-wide p-base rounded-sm border border-negative-border bg-negative-background">
          <Typography size="small" className="text-negative-content whitespace-pre-wrap">
            {error}
          </Typography>
        </div>
      )}

      <div className="flex items-center gap-tight">
        <Button variant="primary" waiting={saving} onClick={onSave} aria-label="保存大模型预标注配置">
          保存
        </Button>
        <Button
          variant="neutral"
          look="outlined"
          waiting={testing}
          disabled={!backendId}
          onClick={onTest}
          aria-label="发送测试请求"
        >
          测试请求
        </Button>
        {backendId && (
          <Button variant="negative" look="outlined" onClick={onDelete} aria-label="移除配置" className="ml-auto">
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

LLMPreannotationSettings.title = "大模型预标注";
LLMPreannotationSettings.path = "/llm-preannotation";
