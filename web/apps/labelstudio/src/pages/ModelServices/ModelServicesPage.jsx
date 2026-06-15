import { useCallback, useEffect, useState } from "react";
import { useUpdatePageTitle } from "@humansignal/core";
import { Typography } from "@humansignal/ui";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import "./ModelServicesPage.scss";

const SERVICE_KIND = {
  vision: "视觉模型服务",
  llm: "大模型服务",
  custom: "模型服务",
};

const getServiceKind = (service) => {
  return service?.readable_service_type || SERVICE_KIND[service?.service_type] || SERVICE_KIND.custom;
};

const getCapabilities = (service) => (Array.isArray(service?.capabilities) && service.capabilities.length ? service.capabilities : ["批量预测"]);

export const ModelServicesPage = () => {
  const api = useAPI();
  const root = cn("model-services");
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useUpdatePageTitle("模型服务管理");

  const healthyCount = services.filter((item) => item.connectivity_status === "ok").length;
  const unhealthyCount = services.filter((item) => item.connectivity_status === "error").length;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.callApi("systemModelServices");

      if (response?.error) throw new Error(response.error);
      setServices(Array.isArray(response) ? response : []);
    } catch (err) {
      setServices([]);
      setError(err?.message || "模型服务加载失败");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className={root.toClassName()}>
      <div className={root.elem("panel").toClassName()}>
        <div className={root.elem("header").toClassName()}>
          <div>
            <h2 className={root.elem("title").toClassName()}>模型服务管理</h2>
          </div>
          <button type="button" className={root.elem("link-btn").toClassName()} onClick={load} disabled={loading}>
            刷新
          </button>
        </div>

        <div className={root.elem("summary").toClassName()}>
          <span>服务总数 <strong>{services.length}</strong></span>
          <span>正常 <strong>{healthyCount}</strong></span>
          <span>异常 <strong>{unhealthyCount}</strong></span>
        </div>

        {!loading && error && (
          <div className={root.elem("error").toClassName()}>
            <Typography size="small">{error}</Typography>
          </div>
        )}

        {!loading && !error && services.length === 0 && (
          <div className={root.elem("empty").toClassName()}>
            <Typography variant="title" size="medium">
              暂无模型服务
            </Typography>
            <Typography size="small" className="text-neutral-content-subtler mt-tight">
              系统会自动初始化 LLM 大模型预标注服务和 Grounding DINO 视觉预标注服务。
            </Typography>
          </div>
        )}

        {!loading && !error && services.length > 0 && (
          <div className={root.elem("list").toClassName()}>
            {services.map((service) => {
              const connectivity = service.connectivity_status === "ok" ? "ok" : "error";

              return (
                <article key={service.key} className={root.elem("card").toClassName()}>
                  <div className={root.elem("card-head").toClassName()}>
                    <div className={root.elem("title-block").toClassName()}>
                      <div className={root.elem("title-row").toClassName()}>
                        <h3 className={root.elem("service-title").toClassName()}>{service.title || "未命名模型服务"}</h3>
                        <span
                          className={root.elem("status").toClassName()}
                          title={connectivity === "ok" ? "连通性正常" : "连通性异常"}
                        >
                          <span className={root.elem("status-dot").mod({ [connectivity]: true }).toClassName()} />
                        </span>
                      </div>
                      <div className={root.elem("subtitle").toClassName()}>{getServiceKind(service)}</div>
                    </div>
                    <button type="button" className={root.elem("link-btn").toClassName()} onClick={load}>
                      检测
                    </button>
                  </div>

                  <div className={root.elem("url").toClassName()} title={service.url}>
                    {service.url}
                  </div>

                  <div className={root.elem("tags").toClassName()}>
                    {getCapabilities(service).map((item) => (
                      <span key={item} className={root.elem("tag").toClassName()}>
                        {item}
                      </span>
                    ))}
                  </div>

                  {service.description && <p className={root.elem("service-desc").toClassName()}>{service.description}</p>}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

ModelServicesPage.title = "模型服务管理";
ModelServicesPage.path = "/model-services";
